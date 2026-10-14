// Prints the state of one Repository's tasks, changes, events and checks (default: the most recent). For debugging runs.
// Usage: BASE_URL=... [REPO=<id>] node --experimental-strip-types scripts/spike/inspect.ts
const B = process.env.BASE_URL!;
const h = { authorization: `Bearer ${process.env.SEED_API_KEY}`, "x-agent-run-id": "inspect" };
const get = async (p: string) => (await fetch(`${B}${p}`, { headers: h })).json() as Promise<any[]>;
const repos = (await get("/api/repositorys?limit=500")).sort((a, b) => (a.id < b.id ? -1 : 1));
const repo = process.env.REPO ? repos.find((r) => r.id === process.env.REPO)! : repos[repos.length - 1];
console.log("repo", repo.id, repo.artifactsRepo);
const tasks = (await get("/api/tasks?limit=500")).filter((t) => t.repositoryId === repo.id);
const changes = (await get("/api/changes?limit=500")).filter((c) => c.repositoryId === repo.id);
for (const t of tasks) console.log("TASK  ", t.status.padEnd(10), t.claimedBy ?? "-", t.title);
for (const c of changes) console.log("CHANGE", c.status.padEnd(14), c.actorId, c.id, String(c.headSha).slice(0, 7));
const ids = new Set([...changes.map((c) => c.id), ...tasks.map((t) => t.id)]);
for (const e of (await get("/api/changeevents?limit=2000")).sort((a, b) => (a.id < b.id ? -1 : 1))) if (ids.has(e.changeId) || ids.has(e.taskId)) console.log("EVENT ", e.kind, String(e.detail ?? "").slice(0, 110));
for (const k of (await get("/api/checks?limit=2000")).sort((a, b) => (a.id < b.id ? -1 : 1))) if (ids.has(k.changeId)) console.log("CHECK ", k.changeId.slice(-6), k.stage, k.outcome, String(k.detail ?? "").replace(/\n/g, " | ").slice(0, 200));
for (const d of await get("/api/decisions?limit=500")) if (ids.has(d.changeId)) console.log("DECISION", d.status, d.choice ?? "", "\n" + String(d.question).split("\n").map((l) => "    " + l).join("\n"));
