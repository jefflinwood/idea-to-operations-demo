// Drives the demo UI in headless Chrome through a live hero run, including a real click on the Decision button.
// Usage: BASE_URL=... UI_KEY=... SEED_API_KEY=... [OUT=dir] node scripts/spike/ui-e2e.mjs
// Saves screenshots of the Swarm, Decision (pending), Decision (resolved) and Change screens.
import { spawn, execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const B = process.env.BASE_URL, KEY = process.env.UI_KEY, OUT = process.env.OUT ?? new URL("../../results/ui/", import.meta.url).pathname;
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let problems = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) problems++; };

// --- a minimal Chrome DevTools client
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "uie2e-"))}`, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1280,1400", "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
if (!target) throw new Error("could not reach Chrome");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name, height = 1400) => {
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height, deviceScaleFactor: 1, mobile: false });
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, name), Buffer.from(r.result.data, "base64")); console.log(`  saved ${name}`);
};
const go = async (hash) => { await js(`location.hash = ${JSON.stringify(hash)}`); await sleep(2800); };
const contentHeight = async () => Math.min(2600, Math.max(900, (await js("document.documentElement.scrollHeight")) + 20));

await cdp("Page.enable");
await cdp("Page.navigate", { url: `${B}/ui?key=${KEY}` });
await sleep(2500);
check((await js("document.title")) === "Agent Swarm", "UI loads after sign-in");

// --- start the hero run
const seed = execFileSync("node", ["--experimental-strip-types", new URL("./seed.ts", import.meta.url).pathname], { env: { ...process.env, HERO: "1" }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim().split("\n").pop();
// The long-lived agent stream runs in its own curl process so it cannot stall the polling requests below.
const run = new Promise((resolve) => execFile("curl", ["-sN", "-m", "1800", "-X", "POST", "-H", `authorization: Bearer ${process.env.SEED_API_KEY}`, `${B}/swarm/run?hero=1&leases=1&repositoryId=${seed}`], { maxBuffer: 64 * 1024 * 1024 }, (_e, out) => resolve(String(out))));
run.catch(() => {});
const state = async () => JSON.parse(await js(`fetch("/ui/api/state").then(r => r.text())`));
await js("localStorage.removeItem('repo')");
await sleep(1500);

// Swarm screen while the agents work
let s = await state();
for (let i = 0; i < 40 && !s.tasks?.some((t) => t.status === "working" || t.status === "claimed"); i++) { await sleep(1500); s = await state(); }
await go("#/");
await shot("1-swarm-working.png", await contentHeight());
check((await js("document.body.innerText")).includes("working"), "Swarm screen shows agents working");

// Wait for the Decision, then look at it
let decision;
for (let i = 0; i < 160 && !decision; i++) { s = await state(); decision = s.decisions?.find((d) => d.status === "pending"); if (!decision) await sleep(2000); }
check(Boolean(decision), "a pending decision appeared");
await go("#/");
await shot("2-swarm-paused.png", await contentHeight());
check((await js("document.body.innerText")).includes("Paused for a human"), "Swarm screen shows the paused-for-a-human banner");
await js(`document.querySelector('a.banner').click()`); await sleep(2500);
check((await js("location.hash")).startsWith("#/decision/"), "banner opens the Decision screen");
await shot("3-decision-pending.png", await contentHeight());
const text = await js("document.body.innerText");
for (const needle of ["A human needs to decide", "What interacted", "Why it stopped", "TS18048", "Return for revision", "Preserve old contract", "Abandon change"]) check(text.toLowerCase().includes(needle.toLowerCase()), `Decision screen shows "${needle}"`);

// Hold, then click the real button
await sleep(4000);
await js(`document.querySelector('[data-choose="return_for_revision"]').click()`);
await sleep(3000);
await shot("4-decision-resolving.png", await contentHeight());
const errText = await js(`document.querySelector("#errMsg")?.textContent || ""`);
check((await js("document.body.innerText")).includes("Decision recorded"), `clicking the button records the decision${errText ? " (page said: " + errText + ")" : ""}`);

// Watch it land
let done = false;
for (let i = 0; i < 120 && !done; i++) { s = await state(); done = s.changes?.every((c) => c.status === "completed") && s.changes.length === 2; if (!done) await sleep(2000); }
check(done, "both changes completed after the click");
await sleep(2500);
await shot("5-decision-resolved.png", await contentHeight());
const bId = s.changes.find((c) => s.tasks.find((t) => t.id === c.taskId)?.title === "Add profile endpoint").id;
await go(`#/change/${bId}`);
await shot("6-change.png", await contentHeight());
await go("#/");
await shot("7-swarm-done.png", await contentHeight());
await run.catch(() => {}); // the agents' stream is only informational here; it can time out on long runs
console.log(problems ? `${problems} FAILED` : "UI end-to-end passed");
chrome.kill(); process.exit(problems ? 1 : 0);
