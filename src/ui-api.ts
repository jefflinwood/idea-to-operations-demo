// Demo UI backend. Three screens (Swarm, Change, Decision) are one static page plus two endpoints:
//   GET  /ui/api/state   an aggregated, read-only snapshot of Zebric's records for one repository
//   POST /ui/api/decide  executes Zebric's ResolveDecision command as the human decider
// Reads use the integrator key and the decision uses the human key, both server-side; the browser only holds the demo key.
import uiHtml from "./ui.html";

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
	Response.json(body, { status, headers: { "cache-control": "no-store", ...extra } });

function cookie(request: Request, name: string): string | undefined {
	return request.headers.get("cookie")?.split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1];
}

/** Constant-time-ish comparison; the demo key is the only secret the browser holds. */
function authorized(request: Request, env: any): boolean {
	const key = cookie(request, "ui_key");
	return Boolean(env.UI_KEY) && key === env.UI_KEY;
}

export async function handleUi(request: Request, env: any, zebric: (r: Request) => Promise<Response>): Promise<Response | undefined> {
	const url = new URL(request.url);
	if (url.pathname !== "/ui" && !url.pathname.startsWith("/ui/")) return undefined;

	// ?key=... sets the cookie once and redirects to a clean URL.
	if (url.pathname === "/ui" && url.searchParams.get("key")) {
		if (url.searchParams.get("key") !== env.UI_KEY) return new Response("wrong key", { status: 401 });
		return new Response(null, { status: 302, headers: { location: "/ui", "set-cookie": `ui_key=${env.UI_KEY}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400` } });
	}
	if (!authorized(request, env)) {
		return new Response("Open /ui?key=<demo key> once to sign in.", { status: 401, headers: { "content-type": "text/plain" } });
	}
	if (url.pathname === "/ui") return new Response(uiHtml, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

	const asKey = (key: string, path: string, init: RequestInit = {}) =>
		zebric(new Request(`${url.origin}${path}`, {
			...init,
			headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-agent-run-id": "demo-ui", "idempotency-key": crypto.randomUUID() },
		}));
	const list = async (entity: string): Promise<any[]> => {
		const r = await asKey(env.INTEGRATOR_API_KEY, `/api/${entity}?limit=500`);
		const j: any = await r.json().catch(() => []);
		return Array.isArray(j) ? j : j.data ?? [];
	};

	if (url.pathname === "/ui/api/state" && request.method === "GET") {
		const [repos, tasks, changes, leases, decisions, checks, events, runs] = await Promise.all([
			list("repositorys"), list("tasks"), list("changes"), list("symbolleases"), list("decisions"), list("checks"), list("changeevents"), list("agentruns"),
		]);
		repos.sort((a, b) => (a.id < b.id ? -1 : 1));
		const repo = repos.find((r) => r.id === url.searchParams.get("repo")) ?? repos[repos.length - 1];
		if (!repo) return json({ repos: [], repo: null });
		const myTasks = tasks.filter((t) => t.repositoryId === repo.id);
		const myChanges = changes.filter((c) => c.repositoryId === repo.id);
		const ids = new Set([...myTasks.map((t) => t.id), ...myChanges.map((c) => c.id)]);
		return json({
			now: Date.now(),
			repos: repos.slice(-10).map((r) => ({ id: r.id, artifactsRepo: r.artifactsRepo, createdAt: r.createdAt })),
			repo: { id: repo.id, artifactsRepo: repo.artifactsRepo, mainSha: repo.mainSha, createdAt: repo.createdAt },
			tasks: myTasks,
			changes: myChanges,
			leases: leases.filter((l) => l.repositoryId === repo.id),
			decisions: decisions.filter((d) => ids.has(d.changeId)),
			checks: checks.filter((k) => ids.has(k.changeId)).sort((a, b) => (a.id < b.id ? -1 : 1)),
			runs: runs.filter((r) => ids.has(r.changeId)).sort((a, b) => (a.id < b.id ? -1 : 1)),
			events: events.filter((e) => ids.has(e.changeId) || ids.has(e.taskId)).sort((a, b) => (a.id < b.id ? -1 : 1)),
		});
	}

	if (url.pathname === "/ui/api/decide" && request.method === "POST") {
		if (request.headers.get("x-ui") !== "1") return json({ error: "missing x-ui header" }, 400);
		const body = (await request.json().catch(() => ({}))) as { changeId?: string; decisionId?: string; choice?: string };
		if (!body.changeId || !body.decisionId || !["return_for_revision", "preserve_contract", "abandon"].includes(body.choice ?? "")) return json({ error: "changeId, decisionId and a valid choice are required" }, 400);
		// Goes through Zebric's own command, so policy, audit and the Workflow signal all apply.
		// Under load Zebric can report a transient write conflict (retryable); a human should never see that.
		let res!: Response, out: any;
		for (let attempt = 0; attempt < 14; attempt++) {
			res = await asKey(env.HUMAN_API_KEY, `/api/commands/resolve_decision/${body.changeId}`, { method: "POST", body: JSON.stringify({ decisionId: body.decisionId, choice: body.choice }) });
			out = await res.json().catch(() => ({}));
			if (!(res.status >= 409 && out?.error?.retryable)) break;
			await new Promise((r) => setTimeout(r, 40 * 2 ** Math.min(attempt, 6) * (0.5 + Math.random())));
		}
		return json(out, res.status);
	}
	return json({ error: "not found" }, 404);
}
