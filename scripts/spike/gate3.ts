// Gate 3: three independent clients contend over tasks and leases without corrupting state.
// Env: BASE_URL, SEED_API_KEY, AGENT1..3_API_KEY, INTEGRATOR_API_KEY, HUMAN_API_KEY. ROUNDS=n repeats the races.
const B = process.env.BASE_URL ?? "http://localhost:18789";
const K = {
  seed: process.env.SEED_API_KEY!, int: process.env.INTEGRATOR_API_KEY!, human: process.env.HUMAN_API_KEY!,
  a: [1, 2, 3].map((i) => process.env[`AGENT${i}_API_KEY`]!),
};
const rounds = Number(process.env.ROUNDS ?? 5);
let failures = 0;
const retries: string[] = []; // retryable responses seen (any status), reported at the end
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures++; };

async function call(key: string, method: string, path: string, body?: unknown, run = "gate3") {
  for (let attempt = 0; ; attempt++) {
    // A reset connection is a client transport failure (seen against workers.dev); an idempotency key makes the retry safe.
    const idem = crypto.randomUUID();
    let r: Response, text: string;
    try {
      r = await fetch(`${B}${path}`, {
        method, body: body === undefined ? undefined : JSON.stringify(body),
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-agent-run-id": run, "idempotency-key": idem },
      });
      text = await r.text();
    } catch (e) {
      if (attempt < 4) { await new Promise((s) => setTimeout(s, 200 * (attempt + 1))); continue; }
      throw e;
    }
    let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    const code = json?.error?.code ?? json?.code;
    // Only retry what Zebric marks retryable (transient write conflicts).
    if (r.status >= 409 && (json?.error?.retryable ?? json?.retryable) && attempt < 6) { retries.push(`${r.status}/${code}`); await new Promise((s) => setTimeout(s, 20 + Math.random() * 80 * (attempt + 1))); continue; }
    return { status: r.status, json, code, attempts: attempt + 1 };
  }
}
const cmd = (key: string, name: string, id: string, input: object = {}, run?: string) => call(key, "POST", `/api/commands/${name}/${id}`, input, run);
// Entity POST reports a D1 transaction conflict as an opaque 500 ("Create failed"), unlike commands (409, retryable).
// Seeding retries it; see SPIKE_FINDINGS.md.
const create = async (entity: string, body: object) => {
  for (let i = 0; ; i++) {
    const r = await call(K.seed, "POST", `/api/${entity}`, body);
    if (r.status === 201 || i >= 8) { if (r.status !== 201) check(false, `create ${entity} -> ${r.status}`); return r.json; }
    await new Promise((s) => setTimeout(s, 30 + Math.random() * 100));
  }
};
const get = async (entity: string, id: string) => (await call(K.seed, "GET", `/api/${entity}/${id}`)).json;
const list = async (entity: string) => { const j = (await call(K.seed, "GET", `/api/${entity}?limit=500`)).json; return Array.isArray(j) ? j : j.data ?? j.items ?? []; };

const repo = await create("repositorys", { name: `demo-${Date.now()}`, mainSha: "base0" });
const mkTask = async (title: string) => create("tasks", { repositoryId: repo.id, title });

// 1. Task contention: three agents race one task.
for (let r = 0; r < rounds; r++) {
  const t = await mkTask(`race ${r}`);
  const res = await Promise.all(K.a.map((k, i) => cmd(k, "claim_task", t.id, {}, `a${i + 1}`)));
  const wins = res.map((x, i) => (x.status === 200 ? i + 1 : 0)).filter(Boolean);
  const final = await get("tasks", t.id);
  check(wins.length === 1 && final.claimedBy === `agent-${wins[0]}` && final.status === "claimed", `claim round ${r}: winners=${wins} claimedBy=${final.claimedBy}; losers ${res.filter((x) => x.status !== 200).map((x) => x.code).join(",")}`);
}

// 2. Lease contention: three agents each hold a task and race the same symbol.
for (let r = 0; r < rounds; r++) {
  const tasks = await Promise.all([0, 1, 2].map((i) => mkTask(`lease ${r}.${i}`)));
  for (let i = 0; i < 3; i++) {
    await cmd(K.a[i], "claim_task", tasks[i].id, {}, `a${i + 1}`);
    const s = await cmd(K.a[i], "start_change", tasks[i].id, {}, `a${i + 1}`);
    if (s.status !== 200) check(false, `start_change ${s.status} ${JSON.stringify(s.json)}`);
  }
  const symbol = `src/user-service.ts::UserService${r}`;
  const res = await Promise.all(tasks.map((t, i) => cmd(K.a[i], "acquire_symbol_lease", t.id, { symbol }, `a${i + 1}`)));
  const wins = res.filter((x) => x.status === 200);
  const active = (await list("symbolleases")).filter((l: any) => l.activeKey === `${repo.id}::${symbol}`);
  check(wins.length === 1 && active.length === 1, `lease round ${r}: winners=${wins.length} activeRows=${active.length}; losers ${res.filter((x) => x.status !== 200).map((x) => `${x.status}/${x.code}`).join(",")}`);
  if (r === 0) {
    // Loser replans to a different symbol; holder releases and a loser can then take the original.
    const loserIdx = res.findIndex((x) => x.status !== 200), holderIdx = res.findIndex((x) => x.status === 200);
    const other = await cmd(K.a[loserIdx], "acquire_symbol_lease", tasks[loserIdx].id, { symbol: "src/other.ts::helper" }, "replan");
    check(other.status === 200, "denied agent replans to a different symbol");
    const lease = active[0];
    const wrong = await cmd(K.a[loserIdx], "release_symbol_lease", lease.id);
    check(wrong.status >= 400, `non-holder cannot release (${wrong.status})`);
    const rel = await cmd(K.a[holderIdx], "release_symbol_lease", lease.id);
    const again = await cmd(K.a[loserIdx], "acquire_symbol_lease", tasks[loserIdx].id, { symbol }, "retake");
    check(rel.status === 200 && again.status === 200, `release then re-acquire (${rel.status}, ${again.status})`);
    const bad = await cmd(K.a[0], "acquire_symbol_lease", tasks[0].id, { symbol: "not a symbol" });
    check(bad.status === 400 || bad.status === 422, `malformed symbol rejected (${bad.status})`);
  }
}

// 3. Command-only enforcement and role checks.
{
  const t = await mkTask("guard");
  const direct = await call(K.a[0], "PUT", `/api/tasks/${t.id}`, { status: "completed" });
  check(direct.status >= 400, `generic update of lifecycle field rejected (${direct.status})`);
  const seedDirect = await call(K.seed, "PUT", `/api/tasks/${t.id}`, { status: "completed" });
  check(seedDirect.status >= 400, `even seeder cannot bypass command-only (${seedDirect.status})`);
  await cmd(K.a[0], "claim_task", t.id);
  const steal = await cmd(K.a[1], "start_change", t.id);
  check(steal.status >= 400, `non-claimant cannot start change (${steal.status})`);
  const noRole = await cmd(K.a[0], "complete_task", t.id);
  check(noRole.status >= 400, `worker cannot call integrator command (${noRole.status})`);
}

// 4. Full lifecycle for one change, including a decision.
{
  const t = await mkTask("lifecycle");
  const a = K.a[0];
  await cmd(a, "claim_task", t.id);
  await cmd(a, "start_change", t.id);
  const task = await get("tasks", t.id);
  const ch = task.changeId;
  const step = async (key: string, name: string, id: string, input?: object) => { const r = await cmd(key, name, id, input); if (r.status !== 200) check(false, `${name} -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); return r; };
  await step(a, "acquire_symbol_lease", t.id, { symbol: "src/user-service.ts::UserService.getUser" });
  await step(a, "submit_change", ch, { headSha: "head1" });
  await step(a, "submit_task", t.id);
  await step(K.int, "begin_integration", ch);
  await step(K.int, "record_check", ch, { stage: "structural_merge", outcome: "passed" });
  await step(K.int, "begin_verification", ch);
  await step(K.int, "record_check", ch, { stage: "typescript", outcome: "failed", detail: "getUser() possibly undefined" });
  await step(K.int, "record_check", ch, { stage: "tests", outcome: "not_run" });
  await step(K.int, "request_decision", ch, { question: "Resolve type conflict", options: ["return_for_revision", "preserve_contract", "abandon"] });
  const decision = (await list("decisions")).find((d: any) => d.changeId === ch);
  const early = await cmd(K.human, "resolve_decision", ch, { decisionId: "nope", choice: "abandon" });
  check(early.status >= 400, `bogus decision id rejected (${early.status})`);
  const workerResolve = await cmd(a, "resolve_decision", ch, { decisionId: decision.id, choice: "abandon" });
  check(workerResolve.status >= 400, `worker cannot resolve decisions (${workerResolve.status})`);
  await step(K.human, "resolve_decision", ch, { decisionId: decision.id, choice: "return_for_revision" });
  check((await get("changes", ch)).status === "revision", "decision moves change to revision");
  await step(a, "submit_change", ch, { headSha: "head2" });
  await step(K.int, "begin_integration", ch);
  await step(K.int, "begin_verification", ch);
  await step(K.int, "mark_ready", ch);
  await step(K.int, "integrate_change", ch, { integratedSha: "main1" });
  await step(K.int, "complete_change", ch);
  await step(K.int, "complete_task", t.id);
  const events = (await list("changeevents")).filter((e: any) => e.changeId === ch || e.taskId === t.id).map((e: any) => e.kind);
  const checks = (await list("checks")).filter((c: any) => c.changeId === ch);
  check((await get("changes", ch)).status === "completed" && (await get("tasks", t.id)).status === "completed", "change and task completed");
  check(checks.length === 3 && events.includes("decision.resolved") && events.includes("check.typescript.failed"), `checks=${checks.length}, events=${events.length}`);
}

// 5. Invariant: never two active unexpired leases on one key.
const leases = (await list("symbolleases")).filter((l: any) => l.activeKey);
check(new Set(leases.map((l: any) => l.activeKey)).size === leases.length, `active lease keys unique (${leases.length})`);
console.log(`retryable responses retried: ${retries.length} ${JSON.stringify(Object.entries(retries.reduce((m: any, k) => (m[k] = (m[k] ?? 0) + 1, m), {})))}`);
console.log(failures ? `${failures} FAILED` : "GATE 3 checks all passed");
process.exit(failures ? 1 : 0);
