// Gate 6, decision path: a change that fails tsc raises a Decision, the Workflow waits durably, a human resolves it,
// the agent revises and resubmits, and the same Workflow instance resumes and integrates.
// Usage: BASE_URL=... node --experimental-strip-types scripts/spike/gate6-decision.ts   (creates its own base repo)
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const B = process.env.BASE_URL!;
const seederH = { authorization: `Bearer ${process.env.SEED_API_KEY}`, "content-type": "application/json", "x-agent-run-id": "gate6-decision" };
const hdr = (key: string, run: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/json", "x-agent-run-id": run });
const TSC = new URL("../../node_modules/.bin/tsc", import.meta.url).pathname;
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) fails++; };
async function api(key: string, run: string, method: string, path: string, body?: unknown) {
  for (let i = 0; ; i++) {
    const r = await fetch(`${B}${path}`, { method, headers: { ...hdr(key, run), "idempotency-key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json: any = await r.json().catch(() => ({}));
    if (r.status >= 409 && json?.error?.retryable && i < 8) { await sleep(100 * (i + 1)); continue; }
    return { status: r.status, json };
  }
}
const seeder = (m: string, p: string) => api(process.env.SEED_API_KEY!, "gate6-decision", m, p);
const AGENT = process.env.AGENT1_API_KEY!, HUMAN = process.env.HUMAN_API_KEY!;
async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, ms = 6 * 60_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(3000); }
  throw new Error(`timed out waiting for ${what}`);
}

const REPO = execFileSync("node", ["--experimental-strip-types", new URL("./seed.ts", import.meta.url).pathname], { env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim().split("\n").pop()!;
const task = ((await seeder("GET", "/api/tasks?limit=500")).json as any[]).find((t) => t.repositoryId === REPO && t.title === "Add time endpoint")!;

// The agent claims, starts, gets its fork, and pushes a change that does not compile.
for (const c of ["claim_task", "start_change"]) check((await api(AGENT, "agent-1", "POST", `/api/commands/${c}/${task.id}`, {})).status === 200, c);
const changeId = (await seeder("GET", `/api/tasks/${task.id}`)).json.changeId as string;
const ws = await (await fetch(`${B}/workspace/${changeId}`, { method: "POST", headers: { authorization: `Bearer ${AGENT}` } })).json() as any;
const dir = mkdtempSync(join(process.env.SCRATCH ?? tmpdir(), "gate6d-"));
const repo = join(dir, "fork");
const gitAuth = ["-c", `http.extraHeader=Authorization: Bearer ${ws.token}`];
git(dir, ...gitAuth, "clone", "-q", ws.remote, "fork");
git(repo, "config", "user.email", "agent@swarm.invalid"); git(repo, "config", "user.name", "Agent 1");
const register = (s: string) => s.replace(`import { status } from "./status.js";`, `import { status } from "./status.js";\nimport { time } from "./time.js";`).replace(`\t"/status": status,\n`, `\t"/status": status,\n\t"/time": time,\n`);
writeFileSync(join(repo, "src/index.ts"), register(readFileSync(join(repo, "src/index.ts"), "utf8")));
const broken = `export function time(_request: Request): Response {\n\tconst epochMs: number = new Date().toISOString();\n\treturn Response.json({ iso: new Date().toISOString(), epochMs });\n}\n`;
const fixed = `export function time(_request: Request): Response {\n\tconst now = new Date();\n\treturn Response.json({ iso: now.toISOString(), epochMs: now.getTime() });\n}\n`;
writeFileSync(join(repo, "src/time.ts"), broken);
git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "Add time endpoint (first attempt)");
git(repo, ...gitAuth, "push", "-q", "origin", "HEAD");
const head1 = git(repo, "rev-parse", "HEAD");
check((await api(AGENT, "agent-1", "POST", `/api/commands/submit_change/${changeId}`, { headSha: head1 })).status === 200, "submit_change (broken)");
await api(AGENT, "agent-1", "POST", `/api/commands/submit_task/${task.id}`, {});

// The Workflow integrates, tsc fails, a Decision appears and the Workflow waits.
const decision = await waitFor("a pending decision", async () => {
  const c = (await seeder("GET", `/api/changes/${changeId}`)).json;
  if (c.status !== "needs_decision") return undefined;
  return ((await seeder("GET", "/api/decisions?limit=500")).json as any[]).find((d) => d.changeId === changeId && d.status === "pending");
});
console.log(`decision: ${decision.question}`);
let checks = ((await seeder("GET", "/api/checks?limit=1000")).json as any[]).filter((k) => k.changeId === changeId);
const stage = (s: string, o: string) => checks.some((k) => k.stage === s && k.outcome === o);
check(stage("structural_merge", "passed") && stage("typescript", "failed") && stage("tests", "not_run"), `checks explain the failure: ${checks.map((k) => `${k.stage}:${k.outcome}`).join(", ")}`);
check(/TS2322|not assignable/.test(checks.find((k) => k.stage === "typescript")?.detail ?? ""), "typescript check carries the compiler diagnostic");

// Hold the Workflow in its durable wait for a while, then the human decides.
await sleep(15_000);
check(((await seeder("GET", `/api/changes/${changeId}`)).json as any).status === "needs_decision", "still waiting for the human after 15s");
const wrong = await api(AGENT, "agent-1", "POST", `/api/commands/resolve_decision/${changeId}`, { decisionId: decision.id, choice: "return_for_revision" });
check(wrong.status >= 400, `an agent cannot resolve the decision (${wrong.status})`);
const res = await api(HUMAN, "human", "POST", `/api/commands/resolve_decision/${changeId}`, { decisionId: decision.id, choice: "return_for_revision" });
const afterResolve = ((await seeder("GET", `/api/changes/${changeId}`)).json as any).status;
check(res.status === 200 && afterResolve === "revision", `human resolves: change is ${afterResolve}`);

// The agent fixes the code and resubmits; the same Workflow instance resumes.
writeFileSync(join(repo, "src/time.ts"), fixed);
git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "Fix time endpoint types");
git(repo, ...gitAuth, "push", "-q", "origin", "HEAD");
const head2 = git(repo, "rev-parse", "HEAD");
check((await api(AGENT, "agent-1", "POST", `/api/commands/submit_change/${changeId}`, { headSha: head2 })).status === 200, "submit_change (fixed)");
const final = await waitFor("completion", async () => { const c = (await seeder("GET", `/api/changes/${changeId}`)).json; return ["completed", "needs_decision", "abandoned"].includes(c.status) ? c : undefined; });
check(final.status === "completed", `change ${final.status} after the revision`);

checks = ((await seeder("GET", "/api/checks?limit=1000")).json as any[]).filter((k) => k.changeId === changeId).sort((a, b) => (a.id < b.id ? -1 : 1));
check(checks.filter((k) => k.stage === "typescript").map((k) => k.outcome).join() === "failed,passed", `typescript: failed then passed (${checks.filter((k) => k.stage === "typescript").map((k) => k.outcome).join()})`);
const kinds = ((await seeder("GET", "/api/changeevents?limit=2000")).json as any[]).filter((e) => e.changeId === changeId).map((e) => e.kind);
for (const k of ["decision.requested", "decision.resolved", "change.integrated", "change.completed"]) check(kinds.includes(k), `event ${k}`);
check(((await seeder("GET", `/api/tasks/${task.id}`)).json as any).status === "completed", "task completed");

const baseRepoName = ((await seeder("GET", "/api/repositorys?limit=500")).json as any[]).find((r) => r.id === REPO).artifactsRepo;
const tok = await (await fetch(`${B}/admin/main-token?repo=${baseRepoName}`, { method: "POST", headers: seederH })).json() as any;
git(dir, "-c", `http.extraHeader=Authorization: Bearer ${tok.token}`, "clone", "-q", tok.remote, "main");
let tscOk = true; try { execFileSync(TSC, ["-p", "."], { cwd: join(dir, "main"), stdio: "pipe" }); } catch { tscOk = false; }
check(tscOk && readFileSync(join(dir, "main/src/index.ts"), "utf8").includes('"/time"') && readFileSync(join(dir, "main/src/time.ts"), "utf8").includes("getTime"), "main contains the fixed feature and compiles");
check(!readFileSync(join(dir, "main/src/time.ts"), "utf8").includes("toISOString(); \n") && !readFileSync(join(dir, "main/src/time.ts"), "utf8").includes("const epochMs: number"), "the broken first attempt never reached main");
console.log(fails ? `${fails} FAILED` : "GATE 6 decision path passed");
process.exit(fails ? 1 : 0);
