// Gate 5 verifier: every submitted change must be a real, useful commit in its own Artifacts fork.
// Usage: REPO=<repositoryId> node --experimental-strip-types scripts/spike/gate5.ts
// Checks per submitted task: Zebric states, pushed head == recorded headSha, tsc --strict passes, and (for route tasks) the route is registered.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TASKS } from "../../src/tasks.ts";

const B = process.env.BASE_URL ?? "http://localhost:18790";
const h = { authorization: `Bearer ${process.env.SEED_API_KEY}`, "content-type": "application/json", "x-agent-run-id": "gate5" };
const REPO = process.env.REPO!;
const TSC = new URL("../../node_modules/.bin/tsc", import.meta.url).pathname;
const get = async (path: string) => (await fetch(`${B}${path}`, { headers: h })).json() as Promise<any>;
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const tasks = ((await get("/api/tasks?limit=500")) as any[]).filter((t) => t.repositoryId === REPO);
const changes = ((await get("/api/changes?limit=500")) as any[]).filter((c) => c.repositoryId === REPO);
const events = ((await get("/api/changeevents?limit=1000")) as any[]);
const byStatus: Record<string, number> = {};
for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
console.log(`tasks: ${tasks.length}`, JSON.stringify(byStatus));

let good = 0, bad = 0;
const rows: string[] = [];
for (const t of tasks.filter((t) => t.status === "submitted")) {
  const c = changes.find((c) => c.taskId === t.id);
  const problems: string[] = [];
  if (!c || c.status !== "submitted") problems.push(`change status ${c?.status}`);
  if (c && c.actorId !== t.claimedBy) problems.push(`actor ${c.actorId} != claimedBy ${t.claimedBy}`);
  let files = "";
  if (c) {
    const dir = mkdtempSync(join(process.env.SCRATCH ?? tmpdir(), "gate5-"));
    try {
      const tok = await (await fetch(`${B}/admin/fork-token/${c.id}`, { method: "POST", headers: h })).json() as any;
      git(dir, "-c", `http.extraHeader=Authorization: Bearer ${tok.token}`, "clone", "-q", tok.remote, "repo");
      const repo = join(dir, "repo");
      const head = git(repo, "rev-parse", "HEAD");
      if (head !== c.headSha) problems.push(`HEAD ${head.slice(0, 7)} != recorded ${String(c.headSha).slice(0, 7)}`);
      files = git(repo, "diff", "--name-only", "HEAD~1", "HEAD").split("\n").join(",");
      try { execFileSync(TSC, ["-p", "."], { cwd: repo, encoding: "utf8", stdio: "pipe" }); } catch (e: any) { problems.push(`tsc: ${String(e.stdout || e.message).split("\n").slice(0, 2).join(" | ")}`); }
      const spec = TASKS.find((s) => s.title === t.title);
      const route = spec?.description.match(/GET (\/[\w/]+)/)?.[1];
      if (route && /Register the route/.test(spec!.description) && !readFileSync(join(repo, "src/index.ts"), "utf8").includes(`"${route}"`)) problems.push(`route ${route} not registered`);
    } catch (e: any) { problems.push(`verify failed: ${String(e.message).split("\n")[0]}`); }
  }
  problems.length ? bad++ : good++;
  rows.push(`${problems.length ? "BAD " : "ok  "} ${t.title.padEnd(26)} by ${String(t.claimedBy).padEnd(8)} files=${files} ${problems.join("; ")}`);
}
console.log(rows.join("\n"));
const claimed = new Set(tasks.filter((t) => t.status !== "ready").map((t) => t.id));
const dupes = tasks.filter((t) => changes.filter((c) => c.taskId === t.id).length > 1);
console.log(`submitted ok=${good} bad=${bad}; tasks with >1 change: ${dupes.length}; claimed tasks: ${claimed.size}; events: ${events.length}`);
process.exit(bad || good === 0 ? 1 : 0);
