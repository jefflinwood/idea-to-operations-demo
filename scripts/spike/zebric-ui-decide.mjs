// Clicks a Decision button on Zebric's own page (localhost only) and checks the command ran and the page updated live.
// Usage: BASE_URL=http://localhost:18791 DECISION=<id> CHANGE=<id> [CHOICE="Return for revision"] node scripts/spike/zebric-ui-decide.mjs
import { readFileSync, mkdirSync } from "node:fs";
import { launch } from "../cdp.mjs";
const B = process.env.BASE_URL ?? "http://localhost:18791";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(B)) throw new Error("local development host only");
const OUT = process.env.OUT ?? new URL("../../results/zebric-ui/", import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const creds = Object.fromEntries(readFileSync(new URL("../../.dev.human", import.meta.url), "utf8").trim().split("\n").map((l) => l.split("=")));
const label = process.env.CHOICE ?? "Return for revision";
let bad = 0; const check = (ok, m) => { console.log(`${ok ? "ok  " : "FAIL"} ${m}`); if (!ok) bad++; };
const status = async () => (await (await fetch(`${B}/api/changes/${process.env.CHANGE}`, { headers: { authorization: `Bearer ${env.SEED_API_KEY}`, "x-agent-run-id": "t" } })).json()).status;

const b = await launch();
await b.go(`${B}/auth/sign-in`);
await b.js(`(() => { const set = (n, v) => { const el = document.querySelector('[name="' + n + '"]'); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
  set("email", ${JSON.stringify(creds.DEMO_HUMAN_EMAIL)}); set("password", ${JSON.stringify(creds.DEMO_HUMAN_PASSWORD)}); document.querySelector("form").requestSubmit(); })()`);
await b.waitFor(`!location.pathname.startsWith("/auth/")`, 15000);
await b.go(`${B}/decisions/${process.env.DECISION}`, 2500);
const hasButton = `[...document.querySelectorAll("button")].some(x => x.textContent.trim() === ${JSON.stringify(label)})`;
check(await b.waitFor(hasButton, 20000), `the "${label}" button is on the page`);
check((await status()) === "needs_decision", "change is waiting for a decision");
await b.js(`window.__dialogs = []; window.alert = (m) => window.__dialogs.push(String(m));`);
await b.js(`[...document.querySelectorAll("button")].find(x => x.textContent.trim() === ${JSON.stringify(label)}).click()`);
// The action runs as a Zebric workflow job, so wait for the real outcome rather than for the button text (the
// form enhancer rewrites it to "Saving..." while submitting).
let final = await status();
for (let i = 0; i < 40 && final === "needs_decision"; i++) { await new Promise((r) => setTimeout(r, 500)); final = await status(); }
check(["revision", "abandoned"].includes(final), `ResolveDecision ran as the signed-in human: change is ${final}`);
const flipped = await b.waitFor(`document.body.innerText.includes("Resolved") && !(${hasButton})`, 20000);
check(flipped, "the page showed the resolution by itself, with the action buttons gone (the test never reloaded it)");
console.log("   dialogs shown:", JSON.stringify(await b.js("window.__dialogs")));
const t = await b.text(); console.log("   page now says:", t.replace(/\s+/g, " ").slice(0, 220));
await b.shot(`${OUT}decision-resolved.png`);
b.close(); console.log(bad ? `${bad} FAILED` : "decision click passed"); process.exit(bad ? 1 : 0);
