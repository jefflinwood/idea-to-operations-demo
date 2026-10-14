// Runs the whole demo end to end against your own deployment, N times, as a repeatability check. Each run: reset, click
// Build Outcome in a real browser, wait for the real Decision, click the recommended option, wait for Ready for launch,
// Launch, Adopt as Level 1, then verify the records. Timings and verdicts go to <out>/runs.json.
//   ALLOW_REMOTE=1 REPEAT=5 node scripts/run-demo.mjs <outDir>
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const B = process.env.BASE_URL ?? "http://localhost:18800";
const env = Object.fromEntries(readFileSync(new URL("../.prod.vars", import.meta.url), "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
if (process.env.ALLOW_REMOTE !== "1" || process.env.CONFIRM_REMOTE !== "1") throw new Error("Set ALLOW_REMOTE=1 CONFIRM_REMOTE=1 to reset and run your deployed demo");
if (!process.env.BASE_URL) throw new Error("BASE_URL must be your deployed demo URL");
const OUT = "vendor-access-expiration", dir = process.argv[2];
mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (e) => (await fetch(`${B}/api/${e}?limit=500`, { headers: { authorization: `Bearer ${env.SEED_API_KEY}` } })).json();
// A fresh browser per click: nothing long-lived to hang, and each click is a real UI click.
// A headless browser occasionally hangs; the click is safe to repeat (a button that already did its job is simply gone), so retry once.
const click = (label, shot) => {
  for (let attempt = 1; ; attempt++) {
    try { return execFileSync("node", ["scripts/click.mjs", `/outcomes/${OUT}`, label, `${dir}/${shot}.png`], { env: { ...process.env, BASE_URL: B, ALLOW_REMOTE: "1" }, timeout: 90000 }).toString().startsWith("clicked: true"); }
    catch (e) { if (attempt >= 2) throw e; }
  }
};
const until = async (what, fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(4000); } throw new Error(`timed out waiting for ${what}`); };

const results = [];
for (let n = 1; n <= Number(process.env.REPEAT ?? 1); n++) {
  const r = { run: n }, t0 = Date.now(), s = () => Math.round((Date.now() - t0) / 1000);
  try {
    try { execFileSync("scripts/reset-demo.sh", { env: { ...process.env, BASE_URL: B }, stdio: "pipe", timeout: 600000 }); } catch (e) { throw new Error(`reset failed: ${String(e.stderr || e.stdout || e.message).slice(-200)}`); } r.resetSeconds = s();
    const tb = Date.now(); const since = () => Math.round((Date.now() - tb) / 1000);
    if (!click("Build Outcome", `run${n}-1-build`)) throw new Error("Build Outcome button not found");
    // Resolve every Decision the swarm raises (the hero conflict, plus any unplanned one an agent's mistake causes) until ready.
    let td = Date.now(), clicks = 0;
    const end = Date.now() + 900000;
    for (;;) {
      if (Date.now() > end) throw new Error("timed out waiting for ready_for_launch");
      if ((await get("outcomes")).find((o) => o.id === OUT)?.status === "ready_for_launch") break;
      if ((await get("decisions")).some((d) => d.status === "pending")) {
        if (r.decisionAtSeconds === undefined) r.decisionAtSeconds = since();
        if (!click("Return for revision", `run${n}-2-decision${++clicks}`)) throw new Error("decision button not found");
        td = Date.now(); await sleep(8000); continue;
      }
      await sleep(4000);
    }
    r.readyAtSeconds = since(); r.decisionClicks = clicks; r.afterLastDecisionSeconds = Math.round((Date.now() - td) / 1000);
    if (!click("Launch", `run${n}-3-launch`) || !click("Adopt as Level 1", `run${n}-4-adopt`)) throw new Error("launch/adopt button not found");
    const [o, tasks, changes, decisions, checks] = await Promise.all(["outcomes", "tasks", "changes", "decisions", "checks"].map(get));
    const out = o.find((x) => x.id === OUT);
    r.final = { status: out.status, level: out.level, tasks: tasks.length, tasksCompleted: tasks.filter((t) => t.status === "completed").length, changes: changes.length, changesCompleted: changes.filter((c) => c.status === "completed").length, decisionsResolved: decisions.filter((d) => d.status === "resolved").length, checks: checks.length, failedChecks: checks.filter((c) => c.outcome === "failed").length };
    r.pass = out.status === "operating" && out.level === 1 && r.final.tasksCompleted === r.final.tasks && r.final.changesCompleted === r.final.changes && r.final.decisionsResolved >= 1;
  } catch (e) { r.pass = false; r.error = String(e.message ?? e).slice(0, 300); }
  r.totalSeconds = s(); results.push(r); console.log(JSON.stringify(r)); writeFileSync(`${dir}/runs.json`, JSON.stringify(results, null, 1));
}
console.log(`${results.filter((r) => r.pass).length}/${results.length} runs passed`);

process.exitCode = results.some((r) => !r.pass) ? 1 : 0;
