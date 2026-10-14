// Gate 7: the hero semantic conflict, end to end, repeatable.
//   A: getUser -> User | undefined      B: profile endpoint using getUser().name
//   expect: leases do not collide, Git merges, Mergiraf merges, TypeScript fails, a Decision explains why,
//           the human returns B for revision, B's agent revises, verification passes, B integrates.
// Usage: BASE_URL=... REPEAT=3 node --experimental-strip-types scripts/spike/gate7.ts
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HERO_A, HERO_B } from "../../src/hero.ts";

const B = process.env.BASE_URL!;
const REPEAT = Number(process.env.REPEAT ?? 1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TSC = new URL("../../node_modules/.bin/tsc", import.meta.url).pathname;
const hdr = (key: string, run: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/json", "x-agent-run-id": run });
async function api(key: string, method: string, path: string, body?: unknown) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${B}${path}`, { signal: AbortSignal.timeout(30_000), method, headers: { ...hdr(key, "gate7"), "idempotency-key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
      const json: any = await r.json().catch(() => ({}));
      if (r.status >= 409 && json?.error?.retryable && i < 8) { await sleep(100 * (i + 1)); continue; }
      return { status: r.status, json };
    } catch (e) { if (i > 4) throw e; await sleep(500); }
  }
}
const seed = (m: string, p: string, b?: unknown) => api(process.env.SEED_API_KEY!, m, p, b);
/** GET a list; retry if the response is not an array (and say what it was). Reads are idempotent. */
async function list(path: string): Promise<any[]> {
  for (let i = 0; i < 8; i++) {
    const r = await seed("GET", path);
    if (Array.isArray(r.json)) return r.json;
    console.log(`  (GET ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 160)}; retrying)`);
    await sleep(500 * (i + 1));
  }
  throw new Error(`GET ${path} never returned a list`);
}
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, ms = 8 * 60_000): Promise<T> {
  const end = Date.now() + ms;
  let polls = 0;
  while (Date.now() < end) {
    if (process.env.DEBUG) console.log(`  [poll ${++polls}] waiting for ${what}`);
    const v = await fn(); if (v) return v; await sleep(3000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function scenario(n: number): Promise<string[]> {
  const problems: string[] = [];
  const check = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

  const REPO = execFileSync("node", ["--experimental-strip-types", new URL("./seed.ts", import.meta.url).pathname], { env: { ...process.env, HERO: "1" }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim().split("\n").pop()!;
  // The agents' stream is long-lived. Run it in its own curl process so it can never share (and stall) the connection
  // that the polling requests below use; Node's built-in fetch multiplexes both onto one HTTP/2 connection.
  const run = new Promise<any[]>((resolve) => {
    execFile("curl", ["-sN", "-m", "1800", "-X", "POST", "-H", `authorization: Bearer ${process.env.SEED_API_KEY}`, `${B}/swarm/run?hero=1&leases=1&repositoryId=${REPO}`], { maxBuffer: 64 * 1024 * 1024 }, (_err, stdout) => {
      let result: any[] = [];
      for (const l of String(stdout).split("\n").filter(Boolean)) { try { const d = JSON.parse(l); if (d.result) result = d.result; } catch { /* partial line */ } }
      resolve(result);
    });
  });
  run.catch(() => {});

  const tasks = async () => (await list("/api/tasks?limit=500")).filter((t) => t.repositoryId === REPO);
  const changes = async () => (await list("/api/changes?limit=500")).filter((c) => c.repositoryId === REPO);
  const changeFor = async (title: string) => { const t = (await tasks()).find((x) => x.title === title); return t && (await changes()).find((c) => c.taskId === t.id); };

  // 1. the conflict: B reaches needs_decision while A has landed
  const decision = await waitFor("a pending decision", async () => {
    const b = await changeFor(HERO_B);
    if (b?.status !== "needs_decision") return undefined;
    return (await list("/api/decisions?limit=500")).find((d) => d.changeId === b.id && d.status === "pending");
  });
  console.log(`  [${at()}] decision raised`);
  const a = (await changeFor(HERO_A))!, b = (await changeFor(HERO_B))!;
  check(a.status === "completed", `A (${HERO_A}) has landed: ${a.status}`);
  check(decision.changeId === b.id && b.status === "needs_decision", "B is waiting for a human");

  const allChecks = (await list("/api/checks?limit=2000"));
  const stages = (id: string) => allChecks.filter((k) => k.changeId === id).sort((x, y) => (x.id < y.id ? -1 : 1)).map((k) => `${k.stage}:${k.outcome}`);
  check(stages(a.id).join() === "structural_merge:passed,typescript:passed,tests:not_run", `A checks: ${stages(a.id).join(", ")}`);
  check(stages(b.id).join() === "structural_merge:passed,typescript:failed,tests:not_run", `B checks (git+Mergiraf pass, tsc fails): ${stages(b.id).join(", ")}`);
  const tsErr = allChecks.find((k) => k.changeId === b.id && k.stage === "typescript")?.detail ?? "";
  check(/error TS\d+/.test(tsErr) && /profile\.ts/.test(tsErr), `TypeScript evidence names the consumer: ${tsErr.split("\n")[0].slice(0, 110)}`);
  check(decision.question.includes(HERO_A) && /Evidence/.test(decision.question) && /Reason/.test(decision.question), "decision explains which change altered the contract and shows the evidence");
  const opts = Array.isArray(decision.options) ? decision.options : JSON.parse(decision.options ?? "[]");
  check(["return_for_revision", "preserve_contract", "abandon"].every((id) => opts.some((o: any) => o.id === id)), `decision offers ${opts.map((o: any) => o.label).join(" / ")}`);
  const ev = (await list("/api/changeevents?limit=2000")).filter((e) => [a.taskId, b.taskId].includes(e.taskId) || [a.id, b.id].includes(e.changeId));
  check(ev.filter((e) => e.kind === "lease.acquired").length === 2 && !ev.some((e) => e.kind === "lease.denied"), "leases: both acquired, none denied");

  // 2. the human decides (after a pause, to show the durable wait)
  await sleep(10_000);
  check(((await seed("GET", `/api/changes/${b.id}`)).json as any).status === "needs_decision", "still waiting after 10s");
  const res = await api(process.env.HUMAN_API_KEY!, "POST", `/api/commands/resolve_decision/${b.id}`, { decisionId: decision.id, choice: "return_for_revision" });
  check(res.status === 200, "human chooses: Return B for revision");
  console.log(`  [${at()}] decision resolved`);

  // 3. B's agent revises; the same Workflow resumes and integrates
  const finalB = await waitFor("B to finish", async () => { const c = (await seed("GET", `/api/changes/${b.id}`)).json; return ["completed", "abandoned", "needs_decision"].includes(c.status) && c.status !== "needs_decision" ? c : undefined; }, 8 * 60_000).catch(async () => (await seed("GET", `/api/changes/${b.id}`)).json);
  console.log(`  [${at()}] B is ${finalB.status}`);
  check(finalB.status === "completed", `B integrated after revision (${finalB.status})`);
  const log = await Promise.race([run, sleep(120_000).then(() => [] as any[])]);
  const events = log.map((s: any) => s.event);
  check(events.includes("revision_requested") && events.includes("resubmitted"), `agent revised and resubmitted (${events.filter((e: string) => /revision|resubmitted/.test(e)).join(", ")})`);

  const bChecks = (await list("/api/checks?limit=2000")).filter((k) => k.changeId === b.id).sort((x, y) => (x.id < y.id ? -1 : 1));
  check(bChecks.filter((k) => k.stage === "typescript").map((k) => k.outcome).join() === "failed,passed", `B typescript: ${bChecks.filter((k) => k.stage === "typescript").map((k) => k.outcome).join(" then ")}`);

  // 4. the repository
  const repoName = (await list("/api/repositorys?limit=500")).find((r) => r.id === REPO).artifactsRepo;
  const tok = await (await fetch(`${B}/admin/main-token?repo=${repoName}`, { method: "POST", headers: hdr(process.env.SEED_API_KEY!, "gate7") })).json() as any;
  const dir = mkdtempSync(join(process.env.SCRATCH ?? tmpdir(), "gate7-"));
  git(dir, "-c", `http.extraHeader=Authorization: Bearer ${tok.token}`, "clone", "-q", tok.remote, "main");
  const main = join(dir, "main");
  let tscOk = true; try { execFileSync(TSC, ["-p", "."], { cwd: main, stdio: "pipe" }); } catch { tscOk = false; }
  const us = readFileSync(join(main, "src/user-service.ts"), "utf8");
  const prof = existsSync(join(main, "src/profile.ts")) ? readFileSync(join(main, "src/profile.ts"), "utf8") : "";
  check(tscOk, "final main passes tsc --strict");
  check(/getUser\([^)]*\)\s*:\s*User\s*\|\s*undefined/.test(us), "A's new contract is on main (getUser returns User | undefined)");
  check(prof.length > 0 && /"\/profile"/.test(readFileSync(join(main, "src/index.ts"), "utf8")) && /user\.name/.test(prof), "B's profile endpoint is on main and still reads user.name");
  check(/if\s*\(\s*!user|user\s*===?\s*(undefined|null)|user\s*==\s*null/.test(prof) && !/[\w)\]]!(?![=])/.test(prof.replace(/"[^"]*"/g, '""')), "B handles an unknown user properly (no non-null assertion)");
  check(git(main, "log", "--format=%s").split("\n").length === 3, "main history: initial + A + B");
  console.log(`  total ${at()}`);
  return problems;
}

let ok = 0; const failures: string[][] = [];
for (let i = 1; i <= REPEAT; i++) {
  console.log(`--- hero run ${i}/${REPEAT}`);
  try { const p = await scenario(i); if (!p.length) ok++; else failures.push(p); } catch (e) { console.log(`  FAIL run aborted: ${(e as Error).message}`); failures.push([(e as Error).message]); }
}
console.log(`${ok}/${REPEAT} hero runs reproduced the full scenario`);
process.exit(ok === REPEAT ? 0 : 1);
