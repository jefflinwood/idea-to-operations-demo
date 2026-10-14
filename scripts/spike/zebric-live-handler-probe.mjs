// Do rows created INSIDE a command handler (Check, ChangeEvent) make an open Change page update by itself?
// Usage: BASE_URL=http://localhost:18791 REPO=<run id> node scripts/spike/zebric-live-handler-probe.mjs   (localhost only)
import { readFileSync } from "node:fs";
import { launch } from "../cdp.mjs";
const B = process.env.BASE_URL ?? "http://localhost:18791";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(B)) throw new Error("local development host only");
const env = Object.fromEntries(readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const creds = Object.fromEntries(readFileSync(new URL("../../.dev.human", import.meta.url), "utf8").trim().split("\n").map((l) => l.split("=")));
const api = async (key, method, path, body) => { const r = await fetch(`${B}${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-agent-run-id": "probe", "idempotency-key": crypto.randomUUID() }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const tasks = (await api(env.SEED_API_KEY, "GET", "/api/tasks?limit=500")).json.filter((t) => t.repositoryId === process.env.REPO);
const verifying = (await api(env.SEED_API_KEY, "GET", "/api/changes?limit=500")).json.find((c) => c.repositoryId === process.env.REPO && c.status === "verifying");
if (!verifying) throw new Error("need a change in `verifying` (run scripts/spike/seed-ui-demo.mjs)");
const b = await launch();
await b.go(`${B}/auth/sign-in`);
await b.js(`(() => { const set = (n, v) => { const el = document.querySelector('[name="' + n + '"]'); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }; set("email", ${JSON.stringify(creds.DEMO_HUMAN_EMAIL)}); set("password", ${JSON.stringify(creds.DEMO_HUMAN_PASSWORD)}); document.querySelector("form").requestSubmit(); })()`);
await b.waitFor(`!location.pathname.startsWith("/auth/")`, 15000);
await b.go(`${B}/changes/${verifying.id}`, 3000);
const text = () => b.js("document.body.innerText.replace(/\\s+/g, ' ')");
const before = await text();
const eventRows = () => b.js(`(document.body.innerText.match(/(^|\\n)(Event|[a-z]+\\.[a-z_.]+)\\n/g) || []).length`);
const rowsBefore = await eventRows();
console.log("before: typescript check on page?", /typescript\s+passed/.test(before), "| tsc event on page?", before.includes("check.typescript.passed"));
// record_check's handler creates a Check row AND a ChangeEvent row; then MarkReady adds a ChangeEvent.
const r1 = await api(env.INTEGRATOR_API_KEY, "POST", `/api/commands/record_check/${verifying.id}`, { stage: "typescript", outcome: "passed", detail: "tsc --strict passed on merged tree (live probe)" });
const r2 = await api(env.INTEGRATOR_API_KEY, "POST", `/api/commands/mark_ready/${verifying.id}`, {});
console.log("commands:", r1.status, r2.status);
const t0 = Date.now();
const gotCheck = await b.waitFor(`/typescript\\s+passed/.test(document.body.innerText.replace(/\\s+/g, " "))`, 15000);
const gotEvent = await b.waitFor(`(document.body.innerText.match(/(^|\\n)(Event|[a-z]+\\.[a-z_.]+)\\n/g) || []).length >= ${rowsBefore + 2}`, 15000);
const gotStatus = await b.waitFor(`/Status\\s+ready/i.test(document.body.innerText.replace(/\\s+/g, " "))`, 15000);
console.log(`Check row created by a handler appeared by itself: ${gotCheck}`);
console.log(`ChangeEvent rows created by handlers appeared by itself (${rowsBefore} -> ${await eventRows()}): ${gotEvent}`);
console.log(`Change status (command mutation) updated by itself: ${gotStatus}  (${Date.now() - t0} ms)`);
b.close();
process.exit(gotCheck && gotEvent && gotStatus ? 0 : 1);
