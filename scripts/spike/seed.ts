// Seeds one Repository and the ten tasks. Prints the repository id. Env: BASE_URL, SEED_API_KEY.
import { TASKS } from "../../src/tasks.ts";
import { HERO_TASKS } from "../../src/hero.ts";
const B = process.env.BASE_URL ?? "http://localhost:18790";
const h = { authorization: `Bearer ${process.env.SEED_API_KEY}`, "content-type": "application/json", "x-agent-run-id": "seed" };
// Entity POST can lose a D1 transaction conflict as an opaque 500 (phase3 findings), so retry.
async function post(path: string, body: unknown) {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${B}${path}`, { method: "POST", headers: { ...h, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
    if (r.status === 201) return r.json() as Promise<any>;
    await new Promise((s) => setTimeout(s, 100));
  }
  throw new Error(`POST ${path} kept failing`);
}
let base: any;
for (let i = 0; i < 4 && !base?.name; i++) { base = await (await fetch(`${B}/admin/seed-repo`, { method: "POST", headers: h })).json().catch(() => ({})); if (!base?.name) await new Promise((r) => setTimeout(r, 2000)); }
if (!base?.name) throw new Error(`seed-repo failed: ${JSON.stringify(base)}`);
const repo = await post("/api/repositorys", { name: `swarm-${Date.now()}`, artifactsRepo: base.name, mainSha: base.sha ?? null });
for (const t of process.env.HERO === "1" ? HERO_TASKS : TASKS) await post("/api/tasks", { repositoryId: repo.id, title: t.title, description: t.description });
console.log(repo.id);
