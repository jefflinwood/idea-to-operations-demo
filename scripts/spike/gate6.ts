// Gate 6: concurrent changes integrate against a moving main and end with a valid repository.
// Usage: BASE_URL=... WORKERS=3 PER=1 node --experimental-strip-types scripts/spike/gate6.ts
//   seeds 10 tasks, runs WORKERS agents (each up to PER tasks), waits for the integration Workflows, then verifies main.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TASKS } from "../../src/tasks.ts";

const B = process.env.BASE_URL!;
const WORKERS = Number(process.env.WORKERS ?? 3), PER = Number(process.env.PER ?? 1);
const SEED = process.env.SEED_API_KEY!;
const h = { authorization: `Bearer ${SEED}`, "content-type": "application/json", "x-agent-run-id": "gate6" };
const TSC = new URL("../../node_modules/.bin/tsc", import.meta.url).pathname;
const get = async (p: string) => (await fetch(`${B}${p}`, { headers: h })).json() as Promise<any>;
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let fails = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fails++; };

// 1. seed + run agents (they submit; the hook starts one Workflow per submitted change)
const seed = execFileSync("node", ["--experimental-strip-types", new URL("./seed.ts", import.meta.url).pathname], { env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim().split("\n").pop()!;
const REPO = seed;
console.log(`repo ${REPO}: ${WORKERS} agents x up to ${PER} task(s)`);
const t0 = Date.now();
const runRes = await fetch(`${B}/swarm/run?workers=${WORKERS}&maxTasks=${PER}&repositoryId=${REPO}`, { method: "POST", headers: h });
let agentLog: any[] = [];
for (const line of (await runRes.text()).split("\n").filter(Boolean)) { const d = JSON.parse(line); if (d.result) agentLog = d.result; if (d.error) throw new Error(d.error); }
const submitted = agentLog.filter((s) => s.event === "submitted").length;
check(submitted > 0 && Number.isInteger(WORKERS) && Number.isInteger(PER), `at least one change was submitted (${submitted})`);
console.log(`agents done in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${submitted} changes submitted`);

// 2. wait for the Workflows to settle
const TERMINAL = new Set(["completed", "abandoned", "needs_decision"]);
let changes: any[] = [];
const deadline = Date.now() + 10 * 60_000;
while (Date.now() < deadline) {
  changes = ((await get("/api/changes?limit=500")) as any[]).filter((c) => c.repositoryId === REPO);
  if (changes.length >= submitted && changes.every((c) => TERMINAL.has(c.status))) break;
  await new Promise((r) => setTimeout(r, 4000));
}
const total = ((Date.now() - t0) / 1000).toFixed(0);
const by: Record<string, number> = {};
for (const c of changes) by[c.status] = (by[c.status] ?? 0) + 1;
console.log(`after ${total}s: changes`, JSON.stringify(by));

// 3. Zebric's records
const checks = ((await get("/api/checks?limit=1000")) as any[]);
const events = ((await get("/api/changeevents?limit=2000")) as any[]);
const tasks = ((await get("/api/tasks?limit=500")) as any[]).filter((t) => t.repositoryId === REPO);
const done = changes.filter((c) => c.status === "completed");
check(changes.length === submitted && done.length === submitted, `all ${submitted} submitted changes completed (${done.length})`);
for (const c of done) {
  const cs = checks.filter((k) => k.changeId === c.id);
  const has = (st: string, o: string) => cs.some((k) => k.stage === st && k.outcome === o);
  if (!(has("structural_merge", "passed") && has("typescript", "passed") && has("tests", "not_run"))) check(false, `change ${c.id} missing passing checks: ${cs.map((k) => k.stage + ":" + k.outcome).join(",")}`);
}
check(done.every((c) => tasks.find((t) => t.id === c.taskId)?.status === "completed"), "every completed change's task is completed");
const moved = events.filter((e) => e.kind === "integration.main_moved" && changes.some((c) => c.id === e.changeId)).length;
const merged = checks.filter((k) => k.stage === "structural_merge" && changes.some((c) => c.id === k.changeId) && /main had moved/.test(k.detail ?? "")).length;
console.log(`main moved under a change ${moved} time(s) (push rejected/stale); ${merged} merge(s) onto a main that had advanced past the change's base`);

// 4. the repository
const baseRepoName = ((await get("/api/repositorys?limit=500")) as any[]).find((r) => r.id === REPO).artifactsRepo;
const tok = await (await fetch(`${B}/admin/main-token?repo=${baseRepoName}`, { method: "POST", headers: h })).json() as any;
const dir = mkdtempSync(join(process.env.SCRATCH ?? tmpdir(), "gate6-"));
git(dir, "-c", `http.extraHeader=Authorization: Bearer ${tok.token}`, "clone", "-q", tok.remote, "main");
const repo = join(dir, "main");
const log = git(repo, "log", "--format=%s").split("\n");
let tscOk = true; try { execFileSync(TSC, ["-p", "."], { cwd: join(repo), encoding: "utf8", stdio: "pipe" }); } catch (e: any) { tscOk = false; console.log(String(e.stdout).split("\n").slice(0, 5).join("\n")); }
check(tscOk, "final main passes tsc --strict");
const index = readFileSync(join(repo, "src/index.ts"), "utf8");
let missing = 0;
for (const c of done) {
  const t = tasks.find((x) => x.id === c.taskId)!; const spec = TASKS.find((s) => s.title === t.title)!;
  const route = spec.description.match(/GET (\/[\w/]+)/)?.[1];
  if (route && /Register the route/.test(spec.description) && !index.includes(`"${route}"`)) { missing++; console.log(`  route ${route} (${t.title}) missing from main`); }
  const file = spec.description.match(/new file (src\/[\w-]+\.ts)/)?.[1];
  if (file && !existsSync(join(repo, file))) { missing++; console.log(`  ${file} missing from main`); }
}
check(missing === 0, `every integrated feature is present in final main (${done.length} features)`);
check(log.length === 1 + done.length, `main history: ${log.length} commits = initial + ${done.length} integrations`);
const head = git(repo, "rev-parse", "HEAD");
const repoRow = ((await get("/api/repositorys?limit=500")) as any[]).find((r) => r.id === REPO);
check(repoRow?.mainSha === head, `Repository.mainSha in Zebric matches main HEAD (${head.slice(0, 7)})`);
console.log(failsMsg());
function failsMsg() { return fails ? `${fails} FAILED` : "GATE 6 checks all passed"; }
process.exit(fails ? 1 : 0);
