// Does a Zebric page update by itself when data changes? Loads the board, claims a queued task through the API, watches the DOM.
import { readFileSync } from "node:fs";
import { launch } from "../cdp.mjs";
const B = process.env.BASE_URL ?? "http://localhost:18791";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(B)) throw new Error("local development host only");
const env = Object.fromEntries(readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const creds = Object.fromEntries(readFileSync(new URL("../../.dev.human", import.meta.url), "utf8").trim().split("\n").map((l) => l.split("=")));
const b = await launch();
await b.go(`${B}/auth/sign-in`);
await b.js(`(() => { const set = (n, v) => { const el = document.querySelector('[name="' + n + '"]'); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
  set("email", ${JSON.stringify(creds.DEMO_HUMAN_EMAIL)}); set("password", ${JSON.stringify(creds.DEMO_HUMAN_PASSWORD)}); document.querySelector("form").requestSubmit(); })()`);
await b.waitFor(`!location.pathname.startsWith("/auth/")`, 15000);
await b.go(`${B}/runs/${process.env.REPO}`, 2500);
const column = (name) => b.js(`(() => { const cols = [...document.querySelectorAll("[data-board-column], section, div")].filter(e => e.firstElementChild && /^(Queued|Claimed|Working|Submitted|Completed)/.test(e.firstElementChild.innerText || "")); return document.body.innerText.replace(/\\s+/g, " ") })()`);
const before = await column();
const tasks = await (await fetch(`${B}/api/tasks?limit=500`, { headers: { authorization: `Bearer ${env.SEED_API_KEY}`, "x-agent-run-id": "probe" } })).json();
const queued = tasks.filter((t) => t.status === "ready").sort((a, b) => (a.id < b.id ? -1 : 1)).pop();
const r = await fetch(`${B}/api/commands/claim_task/${queued.id}`, { method: "POST", headers: { authorization: `Bearer ${env.AGENT1_API_KEY}`, "content-type": "application/json", "x-agent-run-id": "probe" }, body: "{}" });
console.log("claimed", queued.title, r.status);
let changedAt = null;
for (let i = 1; i <= 20 && changedAt === null; i++) { await new Promise((s) => setTimeout(s, 1000)); if ((await column()) !== before) changedAt = i; }
console.log(changedAt === null ? "page did NOT change on its own within 20s (no real-time updates)" : `page changed by itself after ${changedAt}s`);
console.log("EventSource / live hooks in page:", await b.js(`JSON.stringify({ eventSource: typeof EventSource, scripts: [...document.scripts].map(s => (s.src || "inline:" + s.textContent.length)).slice(0, 12), liveAttr: !!document.querySelector("[data-live],[data-refresh],[hx-trigger]") })`));
b.close();
