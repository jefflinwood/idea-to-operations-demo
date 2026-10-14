import { createWorkerHandler } from "@zebric/runtime-worker";
import { createWorkflowEntrypoint } from "@zebric/runtime-worker/workflows";
import { BundledTemplateLoader } from "@zebric/runtime-worker";
import { createLiquidEngine } from "@zebric/runtime-core";
import { getAgentByName } from "agents";
import blueprintToml from "./blueprint.toml";
import { handlers } from "./src/handlers.js";
import { adviseLease } from "./src/lease-advice.js";
import { HERO_TITLES } from "./src/hero.js";
import { createChangeflowServices } from "./src/bridge.js";
import { handleMcp } from "./src/mcp.js";
import { project, formatDuration, setAppUrl } from "./src/projection.js";
import { TEMPLATES } from "./src/templates.js";
import { handleUi } from "./src/ui-api.js";
import { createBaseRepo, createWorkspace, forkName } from "./src/workspace.js";

export { Coordinator, WorkerAgent } from "./src/agents.js";
export { ChangeWorkflow } from "./src/change-workflow.js";
export { LiveWorkflow } from "./src/live-workflow.js";

// Page templates get the Outcome projection as a Liquid filter: `{% assign p = outcome | project: data %}`.
const liquid = createLiquidEngine();
liquid.registerFilter("project", (outcome: any, data: any) => project({ outcome, tasks: data?.tasks, changes: data?.changes, checks: data?.checks, decisions: data?.decisions, events: data?.events, runs: data?.runs }));
liquid.registerFilter("duration", (seconds: number) => formatDuration(Number(seconds) || 0));
const templateLoader = new BundledTemplateLoader({ templates: TEMPLATES, engines: new Map([["liquid", liquid]]) });

// Config is a function of env so Zebric's workflow steps can reach our bindings (here: the ChangeWorkflow).
const config = (env?: any) => ({ blueprintContent: blueprintToml, blueprintFormat: "toml" as const, commandHandlers: handlers, templateLoader, ...(env ? { workflowServices: { services: createChangeflowServices(env) } } : {}) });

export class ZebricWorkflow extends createWorkflowEntrypoint(config) {}

const zebric = createWorkerHandler(config);
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Zebric commands that drive the integration Workflow. Runs after the command has succeeded. */
async function onCommand(env: any, name: string, recordId: string, body: any) {
	const id = `change-${recordId}`;
	if (name === "submit_change") {
		// First submission starts the Workflow; a resubmission after a revision resumes the same instance.
		let existing: any;
		try { existing = await env.CHANGE_WORKFLOW.get(id); await existing.status(); } catch { existing = undefined; }
		if (existing) await existing.sendEvent({ type: "resubmitted", payload: { headSha: body?.headSha } });
		else await env.CHANGE_WORKFLOW.create({ id, params: { changeId: recordId, headSha: body?.headSha } });
	} else if (name === "resolve_decision") {
		const instance = await env.CHANGE_WORKFLOW.get(id);
		await instance.sendEvent({ type: "decision", payload: { choice: body?.choice, decisionId: body?.decisionId } });
	}
}

const bearer = (r: Request) => r.headers.get("authorization")?.match(/^Bearer[ \t]+(\S+)[ \t]*$/i)?.[1];

export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext) {
		const url = new URL(request.url);
		setAppUrl(env.APP_URL);
		// All Zebric traffic (REST and MCP) goes through here so successful commands can signal the Workflow.
		const z = async (r: Request) => {
			const m = r.method === "POST" ? new URL(r.url).pathname.match(/^\/api\/commands\/(submit_change|resolve_decision)\/([\w-]+)$/) : null;
			const body = m ? await r.clone().json().catch(() => ({})) : undefined;
			const res = await zebric.fetch(r, env, ctx);
			if (m && res.ok && !env.DISABLE_WORKFLOW_HOOK) ctx.waitUntil(onCommand(env, m[1], m[2], body).catch((e) => console.error("workflow signal failed", m[1], m[2], e)));
			return res;
		};
		if (url.pathname === "/mcp") return handleMcp(request, z);


		const ui = await handleUi(request, env, z);
		if (ui) return ui;

		// An agent asks for the Artifacts fork of its own change. Zebric decides whether it may.
		const ws = url.pathname.match(/^\/workspace\/([\w-]+)$/);
		if (ws && request.method === "POST") {
			const token = bearer(request);
			if (!token) return json({ error: "unauthorized" }, 401);
			const res = await z(new Request(`${url.origin}/api/changes/${ws[1]}`, { headers: { authorization: `Bearer ${token}`, "x-agent-run-id": "workspace" } }));
			if (!res.ok) return json({ error: "change not readable", status: res.status }, 403);
			const change = (await res.json()) as { actorId: string; status: string; repositoryId: string };
			const owner = change.actorId.match(/^agent-(\d+)$/)?.[1];
			if (!owner || env[`AGENT${owner}_API_KEY`] !== token) return json({ error: "not the change owner" }, 403);
			if (change.status !== "working" && change.status !== "revision") return json({ error: `change is ${change.status}` }, 409);
			const repoRes = await z(new Request(`${url.origin}/api/repositorys/${(change as any).repositoryId}`, { headers: { authorization: `Bearer ${token}`, "x-agent-run-id": "workspace" } }));
			const baseRepo = repoRes.ok ? ((await repoRes.json()) as { artifactsRepo?: string }).artifactsRepo : undefined;
			if (!baseRepo) return json({ error: "repository has no artifactsRepo" }, 409);
			return json(await createWorkspace(env, ws[1], baseRepo));
		}

		// An agent asks Clef whether its planned change conflicts with whoever already holds a lease. Advisory; fails open.
		const adv = url.pathname.match(/^\/lease-advice\/([\w-]+)$/);
		if (adv && request.method === "POST") {
			const token = bearer(request);
			if (!token) return json({ error: "unauthorized" }, 401);
			const asAgent = (path: string) => z(new Request(`${url.origin}${path}`, { headers: { authorization: `Bearer ${token}`, "x-agent-run-id": "lease-advice" } }));
			const res = await asAgent(`/api/changes/${adv[1]}`);
			if (!res.ok) return json({ error: "change not readable", status: res.status }, 403);
			const change = (await res.json()) as { actorId: string; taskId: string };
			if (env[`AGENT${change.actorId.match(/^agent-(\d+)$/)?.[1]}_API_KEY`] !== token) return json({ error: "not the change owner" }, 403);
			const tr = await asAgent(`/api/tasks/${change.taskId}`);
			if (!tr.ok) return json({ error: "task not readable" }, 403);
			const list = async (entity: string): Promise<any[]> => {
				const r = await z(new Request(`${url.origin}/api/${entity}?limit=500`, { headers: { authorization: `Bearer ${env.INTEGRATOR_API_KEY}`, "x-agent-run-id": "lease-advice" } }));
				const j: any = await r.json().catch(() => []);
				return Array.isArray(j) ? j : j.data ?? [];
			};
			const { files } = (await request.json().catch(() => ({}))) as { files?: Record<string, string> };
			return json({ advice: await adviseLease(env, list, await tr.json(), files ?? {}) });
		}

		const isSeeder = bearer(request) === env.SEED_API_KEY;
		if (url.pathname === "/admin/seed-repo" && request.method === "POST") {
			if (!isSeeder) return json({ error: "unauthorized" }, 401);
			try { return json(await createBaseRepo(env)); }
			catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
		}

		// Re-runs the Launch check against the live Worker (for an early or failed one). Returns the Workflow instance id.
		if (url.pathname === "/admin/verify-live" && request.method === "POST") {
			if (!isSeeder) return json({ error: "unauthorized" }, 401);
			const outcomeId = url.searchParams.get("outcome") ?? "vendor-access-expiration";
			const instance = await env.LIVE_WORKFLOW.create({ id: `live-${outcomeId}-${Date.now()}`, params: { outcomeId } });
			return json({ started: true, id: instance.id });
		}

		// Verification helper: a short-lived read token for one change's fork (used by scripts/spike/gate5.ts).
		const rt = url.pathname.match(/^\/admin\/fork-token\/([\w-]+)$/);
		if (rt && request.method === "POST") {
			if (!isSeeder) return json({ error: "unauthorized" }, 401);
			using repo = await env.ARTIFACTS.get(forkName(rt[1]));
			const info = await repo.info();
			return json({ remote: info.remote, token: (await repo.createToken("read", 600)).plaintext });
		}

		// Verification helper: read token for the base repo (main).
		if (url.pathname === "/admin/main-token" && request.method === "POST") {
			if (!isSeeder) return json({ error: "unauthorized" }, 401);
			using repo = await env.ARTIFACTS.get(url.searchParams.get("repo") ?? "");
			return json({ remote: (await repo.info()).remote, token: (await repo.createToken("read", 600)).plaintext });
		}

		// Housekeeping: per-change forks are disposable. Dry run unless ?confirm=1; only names starting "chg-" or "swarm-demo-" are touched.
		if (url.pathname === "/admin/cleanup-forks" && request.method === "POST") {
			if (!isSeeder) return json({ error: "unauthorized" }, 401);
			const names: string[] = [], others: string[] = [];
			let cursor: string | undefined;
			do {
				const page = await env.ARTIFACTS.list({ limit: 200, cursor });
				for (const r of page.repos) (/^(chg-|swarm-demo-)/.test(r.name) ? names : others).push(r.name);
				cursor = page.cursor;
			} while (cursor);
			const confirm = url.searchParams.get("confirm") === "1";
			let deleted = 0;
			if (confirm) for (const n of names) if (await env.ARTIFACTS.delete(n)) deleted++;
			return json({ confirm, forks: names.length, deleted, keptOtherRepos: others });
		}

		// Starts the swarm and streams NDJSON heartbeats so proxies don't time out; the last line has the full log.
		if (url.pathname === "/swarm/run" && request.method === "POST") {
			if (!isSeeder) return json({ error: "unauthorized" }, 401);
			const workers = Number(url.searchParams.get("workers") ?? 3);
			const opts = { maxTasks: Number(url.searchParams.get("maxTasks") ?? 1), repositoryId: url.searchParams.get("repositoryId") ?? undefined, leases: url.searchParams.get("leases") === "1" };
			const { readable, writable } = new TransformStream();
			const w = writable.getWriter(), enc = new TextEncoder();
			const line = (o: unknown) => w.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});
			ctx.waitUntil((async () => {
				const beat = setInterval(() => line({ heartbeat: Date.now() }), 10_000);
				try {
					const coordinator = await getAgentByName(env.COORDINATOR, `run-${Date.now()}`);
					if (url.searchParams.get("hero") === "1") line({ result: await (coordinator as any).hero(url.origin, opts.repositoryId, HERO_TITLES, opts.leases) });
					else line({ result: await (coordinator as any).run(url.origin, workers, opts) });
				} catch (e) { line({ error: String((e as Error).message ?? e) }); }
				finally { clearInterval(beat); await w.close().catch(() => {}); }
			})());
			return new Response(readable, { headers: { "content-type": "application/x-ndjson" } });
		}
		return z(request);
	},
	scheduled: zebric.scheduled,
} satisfies ExportedHandler<any>;
