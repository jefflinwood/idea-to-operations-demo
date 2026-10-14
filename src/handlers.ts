// Command handlers. Each lifecycle command mutates only its own record (Zebric rejects protected
// writes to any other record), and handlers add side-effect rows: leases, checks, decisions, events.
import type { CommandHandler } from "@zebric/runtime-core";
import { CommandUnavailableError, ValidationFailureError } from "@zebric/runtime-core";

type Row = Record<string, any>;
const SYMBOL = /^[\w./-]+\.ts::[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?$/;
const DEFAULT_TTL_SECONDS = 600;

const event = (ctx: Parameters<CommandHandler>[0], row: Row) =>
	ctx.db.create("ChangeEvent", { actorId: ctx.actor.id, ...row });

const rows = async (ctx: Parameters<CommandHandler>[0], entity: string, where: Row): Promise<Row[]> => {
	const r = (await ctx.db.query({ entity, where, limit: 200 } as any)) as any;
	return Array.isArray(r) ? r : (r?.data ?? r?.rows ?? []);
};

export const handlers: Record<string, CommandHandler> = {
	// --- Outcome commands. They record the human commitment; the swarm itself is started by the Worker boundary. ---
	async StartBuild(ctx) {
		if (!ctx.record.repositoryId) throw new ValidationFailureError("This Outcome has no prepared workspace to build in");
		await event(ctx, { kind: "outcome.build_started", detail: String(ctx.record.title) });
	},

	async MarkOutcomeReady(ctx) {
		await event(ctx, { kind: "outcome.ready", detail: String(ctx.record.title) });
	},

	async LaunchOutcome(ctx) {
		await event(ctx, { kind: "outcome.launched", detail: String(ctx.record.title) });
	},

	async RecordDeployment(ctx) {
		await event(ctx, { kind: "outcome.deployed", detail: String(ctx.input.detail).slice(0, 4000) });
	},

	async AdoptOutcome(ctx) {
		await event(ctx, { kind: "outcome.adopted", detail: String(ctx.record.title) });
	},

	async RequestTeamPromotion(ctx) {
		await event(ctx, { kind: "outcome.team_promotion_requested", detail: String(ctx.record.title) });
	},
	async ClaimTask(ctx) {
		await event(ctx, { taskId: ctx.record.id, kind: "task.claimed" });
	},

	// Creates the Change in `working`, based on the repository's current main.
	async StartChange(ctx) {
		const repo = (await ctx.db.findById("Repository", String(ctx.record.repositoryId))) as Row | null;
		const change = (await ctx.db.create("Change", {
			taskId: ctx.record.id,
			repositoryId: ctx.record.repositoryId,
			title: ctx.record.title,
			actorId: ctx.actor.id,
			baseSha: repo?.mainSha ?? null,
		})) as Row;
		await event(ctx, { taskId: ctx.record.id, changeId: change.id, kind: "change.started", detail: `base ${repo?.mainSha ?? "none"}` });
		return { changeId: change.id };
	},

	// Coordinates declared intent only: it does not make an edit correct.
	async AcquireSymbolLease(ctx) {
		const symbol = String(ctx.input.symbol);
		if (!SYMBOL.test(symbol)) throw new ValidationFailureError(`Invalid symbol "${symbol}"; expected file.ts::name`);
		const ttl = Number(ctx.input.ttlSeconds ?? DEFAULT_TTL_SECONDS);
		const repositoryId = ctx.record.repositoryId as string;
		const activeKey = `${repositoryId}::${symbol}`;
		const now = Date.now();

		for (const lease of await rows(ctx, "SymbolLease", { activeKey })) {
			if (lease.taskId === ctx.record.id) return; // idempotent re-acquire
			if (new Date(lease.expiresAt).getTime() > now) {
				await event(ctx, { taskId: ctx.record.id, kind: "lease.denied", detail: `${symbol} held by ${lease.actorId}` });
				throw new CommandUnavailableError(`${symbol} is leased by ${lease.actorId} until ${new Date(lease.expiresAt).toISOString()}`, {
					symbol, heldBy: lease.actorId, heldByTask: lease.taskId, expiresAt: lease.expiresAt,
				});
			}
			await ctx.db.update("SymbolLease", lease.id, { activeKey: null }); // expired: free the key
		}
		await ctx.db.create("SymbolLease", {
			repositoryId, taskId: ctx.record.id, actorId: ctx.actor.id, symbol, activeKey,
			expiresAt: new Date(now + ttl * 1000),
		});
		await event(ctx, { taskId: ctx.record.id, changeId: ctx.record.changeId, kind: "lease.acquired", detail: symbol });
	},

	// Records what the Clef decision model said about a lease request. Informational: it never grants or denies a lease.
	async RecordLeaseRisk(ctx) {
		await event(ctx, { taskId: ctx.record.id, changeId: ctx.record.changeId, kind: "lease.risk", detail: String(ctx.input.detail).slice(0, 2000) });
	},

	// Provenance of one agent attempt: instruction, inherited context, per-attempt outputs. Informational; it changes no state.
	// The parent is the latest earlier run on the same change, so a revision points back at the run whose work it builds on.
	async RecordAgentRun(ctx) {
		const i = ctx.input as Row;
		const changeId = ctx.record.changeId as string | null;
		const cap = (v: unknown, n: number) => (v == null ? null : String(v).slice(0, n));
		const prior = changeId ? (await rows(ctx, "AgentRun", { changeId })).sort((a, b) => (a.id < b.id ? -1 : 1)) : [];
		const run = (await ctx.db.create("AgentRun", {
			changeId, taskId: ctx.record.id, actorId: ctx.actor.id, kind: i.kind, parentRunId: prior.length ? prior[prior.length - 1].id : null,
			model: cap(i.model, 200), promptHash: cap(i.promptHash, 64), instruction: cap(i.instruction, 20000), context: cap(i.context, 20000),
			attempts: cap(i.attempts, 60000), summary: cap(i.summary, 2000), headSha: cap(i.headSha, 64), files: cap(i.files, 4000), durationMs: i.durationMs ?? null,
		})) as Row;
		await event(ctx, { taskId: ctx.record.id, changeId, kind: `agent.${i.kind}`, detail: run.id });
	},

	async ReleaseSymbolLease(ctx) {
		await event(ctx, { taskId: ctx.record.taskId, kind: "lease.released", detail: String(ctx.record.symbol) });
		return { activeKey: null }; // frees the unique key so the symbol can be leased again
	},

	async SubmitTask(ctx) {
		await event(ctx, { taskId: ctx.record.id, changeId: ctx.record.changeId, kind: "task.submitted" });
	},

	async SubmitChange(ctx) {
		await event(ctx, { taskId: ctx.record.taskId, changeId: ctx.record.id, kind: "change.submitted", detail: String(ctx.input.headSha) });
	},

	async BeginIntegration(ctx) {
		await event(ctx, { changeId: ctx.record.id, kind: "change.integrating" });
	},

	async BeginVerification(ctx) {
		await event(ctx, { changeId: ctx.record.id, kind: "change.verifying" });
	},

	async RecordCheck(ctx) {
		const { stage, outcome, detail } = ctx.input as Row;
		await ctx.db.create("Check", { changeId: ctx.record.id, stage, outcome, detail: detail ?? null, recordedBy: ctx.actor.id });
		await event(ctx, { changeId: ctx.record.id, kind: `check.${stage}.${outcome}`, detail });
	},

	async MarkReady(ctx) {
		await event(ctx, { changeId: ctx.record.id, kind: "change.ready" });
	},

	// Main moved after this change was verified, so it must be merged and verified again.
	async ReopenIntegration(ctx) {
		await event(ctx, { changeId: ctx.record.id, kind: "change.reintegrating", detail: "main moved before the final push" });
	},

	async RequestDecision(ctx) {
		const d = (await ctx.db.create("Decision", {
			changeId: ctx.record.id, question: ctx.input.question, options: ctx.input.options ?? null,
		})) as Row;
		await event(ctx, { changeId: ctx.record.id, kind: "decision.requested", detail: d.id });
	},

	// Resolves the Decision row and moves the Change: abandon ends it, anything else returns it for revision.
	async ResolveDecision(ctx) {
		const decision = (await ctx.db.findById("Decision", String(ctx.input.decisionId))) as Row | null;
		if (!decision || decision.changeId !== ctx.record.id) throw new ValidationFailureError("Decision does not belong to this change");
		if (decision.status !== "pending") throw new CommandUnavailableError("Decision is already resolved", { decisionId: decision.id });
		const choice = String(ctx.input.choice);
		await ctx.db.update("Decision", decision.id, { status: "resolved", choice, resolvedBy: (ctx.actor.metadata?.name as string | undefined) ?? ctx.actor.delegatedBy ?? ctx.actor.id, resolvedAt: new Date() });
		await event(ctx, { changeId: ctx.record.id, kind: "decision.resolved", detail: choice });
		return { status: choice === "abandon" ? "abandoned" : "revision" };
	},

	async IntegrateChange(ctx) {
		await event(ctx, { changeId: ctx.record.id, kind: "change.integrated", detail: String(ctx.input.integratedSha) });
	},

	async CompleteTask(ctx) {
		await event(ctx, { taskId: ctx.record.id, kind: "task.completed" });
	},

	async CompleteChange(ctx) {
		await event(ctx, { changeId: ctx.record.id, kind: "change.completed" });
	},
};
