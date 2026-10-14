// DEV ONLY. Replays a build against a *local* Zebric through its real commands, with no Cloudflare agents, so the Outcome
// screens can be checked at each stage. It never runs against a deployed Worker. The real demo uses the real swarm.
//   node scripts/dev-sim.mjs <stage>   stage: build | decision | resolved | ready
// Run scripts/demo-seed.mjs first (SKIP_ARTIFACTS=1).
const B = process.env.BASE_URL ?? "http://localhost:18800";
if (new URL(B).protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(B).hostname)) throw new Error("dev-sim is local only");
const K = { human: process.env.HUMAN_API_KEY, int: process.env.INTEGRATOR_API_KEY, seed: process.env.SEED_API_KEY, ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`a${i}`, process.env[`AGENT${i}_API_KEY`]])) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(key, method, path, body) {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${B}${path}`, { method, headers: { authorization: `Bearer ${K[key]}`, "content-type": "application/json", "x-agent-run-id": "dev-sim", "idempotency-key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    if (r.status < 400) return j;
    if (i === 9) throw new Error(`${method} ${path} ${r.status} ${t.slice(0, 200)}`);
    await sleep(120);
  }
}
const cmd = (key, name, id, input = {}) => api(key, "POST", `/api/commands/${name}/${id}`, input);
const OUT = "vendor-access-expiration";
const stage = process.argv[2] ?? "build";

const tasks = await api("seed", "GET", "/api/tasks?limit=100");
const byTitle = (t) => tasks.find((x) => x.title === t && x.repositoryId === OUT);
const outcome = await api("seed", "GET", `/api/outcomes/${OUT}`);
if (outcome.status === "shaping") await cmd("human", "start_build", OUT);

async function start(agent, title) {
  const t = byTitle(title);
  await cmd(`a${agent}`, "claim_task", t.id);
  const r = await cmd(`a${agent}`, "start_change", t.id);
  const changeId = r.changeId ?? r.result?.changeId ?? (await api("seed", "GET", "/api/tasks/" + t.id)).changeId;
  return { task: t, changeId };
}
async function land(agent, w) {
  await cmd(`a${agent}`, "submit_change", w.changeId, { headSha: Math.random().toString(16).slice(2, 42).padEnd(40, "0") });
  await cmd(`a${agent}`, "submit_task", w.task.id);
  await cmd("int", "begin_integration", w.changeId);
  await cmd("int", "record_check", w.changeId, { stage: "structural_merge", outcome: "passed" });
  await cmd("int", "begin_verification", w.changeId);
  await cmd("int", "record_check", w.changeId, { stage: "typescript", outcome: "passed" });
  await cmd("int", "record_check", w.changeId, { stage: "tests", outcome: "not_run" });
  await cmd("int", "mark_ready", w.changeId);
  await cmd("int", "integrate_change", w.changeId, { integratedSha: Math.random().toString(16).slice(2, 42).padEnd(40, "0") });
  await cmd("int", "complete_task", w.task.id);
  await cmd("int", "complete_change", w.changeId);
}

const A = "Make getVendor return undefined for unknown vendors", Bt = "Add vendor expiration notice page";
const rest = tasks.filter((t) => t.repositoryId === OUT && t.title !== A && t.title !== Bt).map((t) => t.title);
const a = await start(1, A);
await land(1, a);
const b = await start(2, Bt);
const c = await start(3, rest[0]); const d = await start(4, rest[1]); const e = await start(5, rest[2]);
await land(3, c);
await cmd("a2", "submit_change", b.changeId, { headSha: "b".repeat(40) }).catch(() => cmd("a2", "submit_change", b.changeId, { headSha: "b".repeat(40) }));
await cmd("a2", "submit_task", b.task.id);
await cmd("int", "begin_integration", b.changeId);
await cmd("int", "record_check", b.changeId, { stage: "structural_merge", outcome: "passed" });
await cmd("int", "begin_verification", b.changeId);
await cmd("int", "record_check", b.changeId, { stage: "typescript", outcome: "failed", detail: "src/expiration.ts(9,28): error TS18048: 'vendor' is possibly 'undefined'." });
await cmd("int", "request_decision", b.changeId, {
  question: `Reason:\n"${A}" (change ${a.changeId}, commit abc1234) landed on main while this change was in progress and altered code this change depends on. Each passes alone; together TypeScript fails.\n\nEvidence (typescript):\nsrc/expiration.ts(9,28): error TS18048: 'vendor' is possibly 'undefined'.\n\nChange: "${Bt}" (${b.changeId})`,
  options: [
    { id: "return_for_revision", label: "Return for revision", description: "The agent adapts this change to what is on main." },
    { id: "preserve_contract", label: "Preserve old contract", description: "The agent keeps this change self-contained and does not rely on the changed code." },
    { id: "abandon", label: "Abandon change", description: "Drop this change." },
  ],
});
if (stage === "build" || stage === "decision") { console.log("state: building with a pending decision"); process.exit(0); }
const dec = (await api("seed", "GET", "/api/decisions?limit=50")).find((x) => x.changeId === b.changeId);
await cmd("human", "resolve_decision", b.changeId, { decisionId: dec.id, choice: "return_for_revision" });
await cmd("a2", "submit_change", b.changeId, { headSha: "c".repeat(40) });
await cmd("int", "begin_integration", b.changeId).catch(() => {});
if (stage === "resolved") { console.log("state: decision resolved, change revising/resubmitted"); process.exit(0); }
await cmd("int", "record_check", b.changeId, { stage: "typescript", outcome: "passed" }).catch(() => {});
console.log("ready stage is partially simulated; remaining tasks stay unfinished");
