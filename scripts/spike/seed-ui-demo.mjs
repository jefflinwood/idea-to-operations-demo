// Seeds a believable mid-run state through Zebric's own commands (no Artifacts, models or Workflows), for UI work.
// Usage: BASE_URL=http://localhost:18791 node scripts/spike/seed-ui-demo.mjs   (needs the Worker's DISABLE_WORKFLOW_HOOK=1)
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const B = process.env.BASE_URL ?? "http://localhost:18791";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(key, method, path, body) {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${B}${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-agent-run-id": "ui-demo", "idempotency-key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if ((r.status === 409 && j?.error?.retryable) || (r.status === 500 && method === "POST" && !path.includes("/commands/"))) { await sleep(80); continue; }
    if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  }
  throw new Error(`${method} ${path} kept failing`);
}
const seeder = (m, p, b) => api(env.SEED_API_KEY, m, p, b);
const agent = (n) => env[`AGENT${n}_API_KEY`];
const integrator = (c, id, input) => api(env.INTEGRATOR_API_KEY, "POST", `/api/commands/${c}/${id}`, input ?? {});
const cmd = (n, c, id, input) => api(agent(n), "POST", `/api/commands/${c}/${id}`, input ?? {});

const repo = await seeder("POST", "/api/repositorys", { name: `ui-demo-${Date.now()}`, artifactsRepo: "swarm-demo-local", mainSha: "3ee718a6200975b131391660eb67f7823aff0a54" });
const titles = [
  ["Make getUser return undefined for unknown users", "Change UserService.getUser so its return type is User | undefined.\nSymbols: src/user-service.ts::UserService.getUser"],
  ["Add profile endpoint", "Add GET /profile?id=<id> using new UserService().getUser(id).\nSymbols: src/profile.ts::profile"],
  ["Add weather endpoint", "Add GET /weather?city=<name>.\nSymbols: src/weather.ts::weather"],
  ["Add search endpoint", "Add GET /search?q=<text>.\nSymbols: src/search.ts::search"],
  ["Add metrics endpoint", "Add GET /metrics.\nSymbols: src/metrics.ts::metrics"],
  ["Add time endpoint", "Add GET /time.\nSymbols: src/time.ts::time"],
  ["Improve health endpoint", "Extend /health.\nSymbols: src/health.ts::health"],
  ["Add version endpoint", "Add GET /version.\nSymbols: src/version.ts::version"],
];
const task = {};
for (const [t, d] of titles) task[t] = await seeder("POST", "/api/tasks", { repositoryId: repo.id, title: t, description: d });
const take = async (n, title) => { await cmd(n, "claim_task", task[title].id); await cmd(n, "start_change", task[title].id); const t = await seeder("GET", `/api/tasks/${task[title].id}`); return t.changeId; };
const lease = (n, title, symbol) => cmd(n, "acquire_symbol_lease", task[title].id, { symbol });
const submit = async (n, title, changeId, sha) => { await cmd(n, "submit_change", changeId, { headSha: sha }); await cmd(n, "submit_task", task[title].id); };

// agent-1: landed
const TA = titles[0][0];
const cA = await take(1, TA); await lease(1, TA, "src/user-service.ts::UserService.getUser");
await submit(1, TA, cA, "c54b24b1111111111111111111111111111111aa");
await integrator("begin_integration", cA);
await integrator("record_check", cA, { stage: "structural_merge", outcome: "passed", detail: "merged onto main 3ee718a (base 3ee718a, fast-forward); structural merge of: none needed" });
await integrator("begin_verification", cA);
await integrator("record_check", cA, { stage: "typescript", outcome: "passed", detail: "tsc --strict passed on merged tree (3155 ms)" });
await integrator("record_check", cA, { stage: "tests", outcome: "not_run", detail: "the demo app has no test suite" });
await integrator("mark_ready", cA);
await integrator("integrate_change", cA, { integratedSha: "a3bcef1222222222222222222222222222222bb" });
await integrator("complete_task", task[TA].id); await integrator("complete_change", cA);
await seeder("PUT", `/api/repositorys/${repo.id}`, { mainSha: "a3bcef1222222222222222222222222222222bb" });

// agent-2: stopped for a human
const TB = titles[1][0];
const cB = await take(2, TB); await lease(2, TB, "src/profile.ts::profile");
await submit(2, TB, cB, "6366cb1333333333333333333333333333333cc");
await integrator("begin_integration", cB);
await integrator("record_check", cB, { stage: "structural_merge", outcome: "passed", detail: "merged onto main a3bcef1 (base 3ee718a, main had moved); structural merge of: none needed" });
await integrator("begin_verification", cB);
await integrator("record_check", cB, { stage: "typescript", outcome: "failed", detail: "src/profile.ts(9,29): error TS18048: 'user' is possibly 'undefined'.\nsrc/profile.ts(9,44): error TS18048: 'user' is possibly 'undefined'." });
await integrator("record_check", cB, { stage: "tests", outcome: "not_run", detail: "the demo app has no test suite" });
await integrator("request_decision", cB, {
  question: `Reason:\n"${TA}" (change ${cA}, commit a3bcef1) landed on main while this change was in progress and altered code this change depends on. Each passes alone; together TypeScript fails.\n\nEvidence (typescript):\nsrc/profile.ts(9,29): error TS18048: 'user' is possibly 'undefined'.\nsrc/profile.ts(9,44): error TS18048: 'user' is possibly 'undefined'.\n\nChange: "${TB}" (${cB})`,
  options: [{ id: "return_for_revision", label: "Return for revision" }, { id: "preserve_contract", label: "Preserve old contract" }, { id: "abandon", label: "Abandon change" }],
});

// agent-3 working, agent-4 verifying, agent-1 on a second task, the rest queued
const TC = titles[2][0]; await take(3, TC); await lease(3, TC, "src/weather.ts::weather");
const TD = titles[3][0]; const cD = await take(4, TD); await lease(4, TD, "src/search.ts::search");
await submit(4, TD, cD, "f02f354444444444444444444444444444444dd"); await integrator("begin_integration", cD);
await integrator("record_check", cD, { stage: "structural_merge", outcome: "passed", detail: "merged onto main a3bcef1 (base 3ee718a, main had moved); structural merge of: none needed" });
await integrator("begin_verification", cD);
const TE = titles[4][0]; await take(1, TE); await lease(1, TE, "src/metrics.ts::metrics");
console.log(JSON.stringify({ repo: repo.id, changeA: cA, changeB: cB, decision: (await seeder("GET", "/api/decisions?limit=50")).find((d) => d.changeId === cB)?.id }));
