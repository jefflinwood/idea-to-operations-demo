// Resets the demo to its starting state and seeds it: the live Outcome (Vendor Access Expiration, shaping, with its
// tasks ready but unclaimed) plus two inert portfolio Outcomes for context.
//
//   BASE_URL=http://localhost:18800 SEED_API_KEY=... HUMAN_API_KEY=... INTEGRATOR_API_KEY=... node scripts/demo-seed.mjs
//   SKIP_ARTIFACTS=1 ...   local UI work only: skips the Cloudflare Artifacts base repo (the build cannot run)
//
// Reset deletes every Outcome, Repository, Task, Change, Check, Decision, ChangeEvent, AgentRun and SymbolLease through Zebric's
// own entity API. It does not touch Artifacts forks; run POST /admin/cleanup-forks?confirm=1 for those.
import { TASKS } from "../src/tasks.ts";
import { HERO_TASKS } from "../src/hero.ts";

const B = process.env.BASE_URL ?? "http://localhost:18800";
const KEY = process.env.SEED_API_KEY;
if (!KEY) throw new Error("SEED_API_KEY is required");
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(B).hostname) && process.env.CONFIRM_REMOTE !== "1") throw new Error(`refusing to reset ${B}; set CONFIRM_REMOTE=1 to reset a deployed demo`);
const HUMAN = process.env.HUMAN_API_KEY, INTEGRATOR = process.env.INTEGRATOR_API_KEY;
if (!HUMAN || !INTEGRATOR) throw new Error("HUMAN_API_KEY and INTEGRATOR_API_KEY are required");
const h = { authorization: `Bearer ${KEY}`, "content-type": "application/json", "x-agent-run-id": "demo-seed" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Zebric can lose a D1 transaction under contention and answer with a retryable error, so retry writes.
async function call(method, path, body, ok = [200, 201, 204], key = KEY) {
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`${B}${path}`, { method, headers: { ...h, authorization: `Bearer ${key}`, "idempotency-key": crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (ok.includes(r.status)) return r.status === 204 ? null : r.json().catch(() => null);
    await sleep(150 * (i + 1));
  }
  throw new Error(`${method} ${path} kept failing`);
}

for (const entity of ["agentruns", "changeevents", "checks", "decisions", "symbolleases", "changes", "tasks", "outcomes", "repositorys"]) {
  const rows = await (await fetch(`${B}/api/${entity}?limit=500`, { headers: h })).json();
  for (const row of rows) await call("DELETE", `/api/${entity}/${row.id}`, undefined, [200, 204, 404]);
  console.log(`reset ${entity}: ${rows.length}`);
}

const LIVE_ID = "vendor-access-expiration";
let base = { name: null, sha: null };
if (process.env.SKIP_ARTIFACTS !== "1") {
  for (let i = 0; i < 4 && !base?.name; i++) {
    base = await (await fetch(`${B}/admin/seed-repo`, { method: "POST", headers: h })).json().catch(() => ({}));
    if (!base?.name) await sleep(2000);
  }
  if (!base?.name) throw new Error(`seed-repo failed: ${JSON.stringify(base)}`);
}

// The Outcome and its Repository share an id, so pages can follow Outcome -> work with one route parameter.
await call("POST", "/api/repositorys", { id: LIVE_ID, name: `vendor-access-${Date.now().toString(36)}`, artifactsRepo: base.name, mainSha: base.sha });
await call("POST", "/api/outcomes", {
  id: LIVE_ID,
  title: "Vendor Access Expiration",
  statement: "Temporary vendor access ends automatically unless an internal sponsor renews it.",
  owner: process.env.DEMO_HUMAN_NAME ?? "Demo Operator",
  repositoryId: LIVE_ID,
  idea: "Temporary vendor accounts aren't consistently removed when engagements end. Security wants access to expire automatically unless an internal sponsor renews it.",
  problem: "Vendor accounts created for short engagements outlive the engagements. Nothing forces an end date, so cleanup depends on someone remembering, and Security cannot show that access ended when the contract did.",
  experience: "Every vendor account has an expiration date and a named internal sponsor. Fourteen days before it, the sponsor is warned. A sponsor can renew access with one action, for at most 90 days. Anything not renewed is disabled automatically, and every expiry and renewal is written to an audit log.",
  criteria: [
    "Every vendor record shows an expiration date and its internal sponsor",
    "The sponsor is warned 14 days before access expires",
    "Only the sponsor can renew access, for at most 90 days",
    "Expired accounts are disabled without manual action",
    "Every expiry and renewal is recorded in an audit log",
  ],
  assumptions: [
    "Every vendor account already has a named internal sponsor",
    "The IAM API can disable an account immediately",
    "90 days is the longest renewal Security will accept",
  ],
  questions: [
    "Should expired accounts be deleted, or only disabled?",
    "What should happen when a vendor lookup finds no vendor?",
  ],
  evidence: [
    "Scenario context: vendor access is granted by engagement, but today nothing ends it",
    "Constraint: the vendor-access service is a small TypeScript Worker; changes land on main only if the whole service type-checks",
  ],
  readiness: 82,
});
await call("POST", "/api/outcomes", {
  id: "quarterly-access-review", title: "Quarterly Access Review", statement: "Managers confirm every team member's system access each quarter.",
  owner: process.env.DEMO_HUMAN_NAME ?? "Demo Operator", seeded: true, repositoryId: "quarterly-access-review", healthNote: "Healthy", readiness: 100,
});
// Lifecycle fields are command-only, so the seeded portfolio walks the same commands a person and the integrator would.
for (const [key, name] of [[HUMAN, "start_build"], [INTEGRATOR, "mark_outcome_ready"], [HUMAN, "launch_outcome"], [HUMAN, "adopt_outcome"]]) await call("POST", `/api/commands/${name}/quarterly-access-review`, {}, [200], key);
await call("POST", "/api/outcomes", {
  id: "partner-intake", title: "Partner Intake", statement: "New partners submit one intake form instead of emailing five teams.",
  owner: process.env.DEMO_HUMAN_NAME ?? "Demo Operator", seeded: true, healthNote: "Spec incomplete", readiness: 41,
});
for (const t of [...HERO_TASKS, ...TASKS]) await call("POST", "/api/tasks", { repositoryId: LIVE_ID, title: t.title, description: t.description });
console.log(`seeded ${LIVE_ID} with ${HERO_TASKS.length + TASKS.length} tasks`);
