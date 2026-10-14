// Phase 14: the Outcome projection. Everything the Outcome pages show is derived here, on read, from the records the
// frozen swarm already keeps in Zebric (Task, Change, Check, Decision, ChangeEvent). There is no second state machine:
// nothing in this file writes anything, and the only stored Outcome state is what the human committed to
// (status, level), which the Outcome commands own.
type Row = Record<string, any>;

export interface ProjectionInput {
	outcome: Row;
	tasks?: Row[];
	changes?: Row[];
	checks?: Row[];
	decisions?: Row[];
	events?: Row[];
	runs?: Row[];
	/** Epoch ms; injectable for tests. */
	now?: number;
}

const AGENT_NAMES = ["Atlas", "Nova", "Orion", "Vega", "Lyra", "Ceres", "Rhea", "Juno", "Kepler", "Talos"];
/** agent-3 -> "Orion". Anything that is not a numbered agent keeps a readable name. */
export function agentName(actorId?: string | null): string {
	if (!actorId) return "";
	if (actorId === "integrator" || actorId === "integration-workflow") return "Verifier";
	if (/^human/.test(actorId)) return "You";
	const n = Number(actorId.match(/^agent-(\d+)$/)?.[1]);
	return n ? (AGENT_NAMES[n - 1] ?? `Agent ${n}`) : actorId;
}

const LEVELS = [
	{ label: "Level 0 · Proposed", statement: "An idea to explore." },
	{ label: "Level 1 · Personal", statement: "Used by an individual." },
	{ label: "Level 2 · Team", statement: "Team uses this for shared work." },
	{ label: "Level 3 · Managed", statement: "The organization depends on this, with formal ownership and oversight." },
];

const STATUS_LABEL: Record<string, string> = { shaping: "Shaping", building: "Building", ready_for_launch: "Ready for launch", operating: "Operating" };

const CHANGE_LABEL: Record<string, string> = {
	working: "Being written", submitted: "Submitted", integrating: "Merging with main", verifying: "Verifying", ready: "Ready to land",
	needs_decision: "Needs your decision", revision: "Revising against latest main", integrated: "Landing", deployed: "Landing", completed: "Landed", abandoned: "Abandoned",
};
const CHECK_LABEL: Record<string, string> = { structural_merge: "Merged with current main", typescript: "TypeScript", tests: "Tests" };
const STAGES = [["shape", "Shape"], ["build", "Build"], ["verify", "Verify"], ["launch", "Launch"], ["operate", "Operate"]] as const;

const parseJson = <T>(v: unknown, fallback: T): T => { try { return v ? JSON.parse(String(v)) : fallback; } catch { return fallback; } };

/** The provenance trace of one change: each agent attempt in order, what it was told, what it inherited, what it produced. */
function traceOf(runs: Row[]) {
	const sorted = [...runs].sort((a, b) => (a.id < b.id ? -1 : 1));
	const numberOf = new Map(sorted.map((r, i) => [r.id, i + 1]));
	return sorted.map((r, i) => {
		const ctx = parseJson<Row>(r.context, {});
		const attempts = parseJson<Row[]>(r.attempts, []);
		const inherited = (Array.isArray(ctx.inherited) ? ctx.inherited : []) as Row[];
		const advice = (Array.isArray(ctx.leaseAdvice) ? ctx.leaseAdvice : []) as Row[];
		return {
			number: i + 1, id: r.id, kind: r.kind, kindLabel: r.kind === "revise" ? "Revision" : "First attempt", agent: agentName(r.actorId), model: String(r.model ?? ""),
			promptHash: r.promptHash ?? "", seconds: r.durationMs ? Math.max(1, Math.round(Number(r.durationMs) / 1000)) : 0,
			parent: r.parentRunId && numberOf.get(r.parentRunId) ? `Run ${numberOf.get(r.parentRunId)}` : "",
			instruction: String(r.instruction ?? ""), summary: String(r.summary ?? ""), headSha: short(r.headSha), files: parseJson<string[]>(r.files, []),
			attempts: attempts.map((a) => ({ n: a.n, outcome: a.outcome, reason: a.reason ?? "", seconds: Math.max(1, Math.round((a.ms ?? 0) / 1000)), tokens: a.tokens ?? "" })),
			rejected: attempts.filter((a) => a.outcome === "rejected").length,
			inherited: inherited.map((m) => ({ source: m.source, count: Array.isArray(m.files) ? m.files.length : 0, files: Array.isArray(m.files) ? m.files.map((f: Row) => f.path).join(", ") : "" })),
			decision: ctx.decision ? { choice: String(ctx.decision.choice ?? "").replace(/_/g, " "), by: agentName(ctx.decision.resolvedBy) || String(ctx.decision.resolvedBy ?? "") } : null,
			failedCheck: ctx.failedCheck ? (CHECK_LABEL[ctx.failedCheck.stage] ?? ctx.failedCheck.stage) : "",
			advice: advice.filter((a) => a.conflict >= 0.5).map((a) => `${Math.round(a.conflict * 100)}% conflict risk with ${a.holder}: ${a.action}`),
		};
	});
}

const ms = (v: unknown) => { const t = v ? new Date(v as string).getTime() : NaN; return Number.isNaN(t) ? undefined : t; };
const short = (sha?: string | null) => (sha ? String(sha).slice(0, 7) : "");

export function project(input: ProjectionInput) {
	const { outcome } = input;
	const now = input.now ?? Date.now();
	const live = !outcome.seeded && !!outcome.repositoryId;
	const tasks = live ? (input.tasks ?? []).filter((t) => t.repositoryId === outcome.repositoryId) : [];
	const changes = live ? (input.changes ?? []).filter((c) => c.repositoryId === outcome.repositoryId) : [];
	const changeIds = new Set(changes.map((c) => c.id));
	const taskById = new Map(tasks.map((t) => [t.id, t]));
	const changeById = new Map(changes.map((c) => [c.id, c]));
	const checks = (input.checks ?? []).filter((c) => changeIds.has(c.changeId));
	const decisions = (input.decisions ?? []).filter((d) => changeIds.has(d.changeId));
	const pending = decisions.filter((d) => d.status === "pending");
	const titleOf = (e: Row) => (e.changeId && changeById.get(e.changeId)?.title) || (e.taskId && taskById.get(e.taskId)?.title) || "";

	// Events are attributable to an Outcome only through its tasks and changes (outcome.* events have no task or change).
	const events = live ? (input.events ?? []).filter((e) => (e.changeId && changeIds.has(e.changeId)) || (e.taskId && taskById.has(e.taskId)) || (String(e.kind).startsWith("outcome.") && (e.detail === outcome.title || (e.kind === "outcome.deployed" && String(e.detail).includes(`"outcome":"${outcome.id}"`))))) : [];

	const completed = tasks.filter((t) => t.status === "completed").length;
	const queued = tasks.filter((t) => t.status === "ready").length;
	const inFlight = tasks.length - completed - queued;
	const counts = {
		total: tasks.length, completed, queued, inFlight, decisions: pending.length,
		changes: changes.length, landed: changes.filter((c) => c.status === "completed").length,
		checksPassed: checks.filter((c) => c.outcome === "passed").length, checksFailed: checks.filter((c) => c.outcome === "failed").length, checksTotal: checks.length,
	};
	const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : outcome.status === "operating" ? 100 : 0;

	// ---- lifecycle presentation (not the Idea-to-Operations level, and not a stored state) ----
	const settled = tasks.length > 0 && tasks.every((t) => t.status === "completed" || t.status === "submitted");
	const stage = outcome.status === "shaping" ? "shape"
		: outcome.status === "building" ? (settled ? "verify" : "build")
		: outcome.status === "ready_for_launch" ? "launch" : "operate";
	const at = STAGES.findIndex(([k]) => k === stage);
	const stages = STAGES.map(([key, label], i) => ({ key, label, state: i < at ? "done" : i === at ? "current" : "todo" }));

	// ---- changes ("Artifacts"): one row per Change, numbered in creation order ----
	const ordered = [...changes].sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0));
	const changeRows = ordered.map((c, i) => {
		const cs = checks.filter((k) => k.changeId === c.id).sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0));
		// The latest result per stage is the current verification state; earlier failures stay in the activity feed.
		const latest = new Map<string, Row>();
		for (const k of cs) latest.set(k.stage, k);
		const reintegrations = events.filter((e) => e.changeId === c.id && (e.kind === "change.reintegrating" || e.kind === "integration.main_moved")).length;
		return {
			id: c.id, number: i + 1, title: c.title ?? taskById.get(c.taskId)?.title ?? "Change", agent: agentName(c.actorId),
			status: c.status, statusLabel: CHANGE_LABEL[c.status] ?? c.status,
			tone: c.status === "completed" ? "done" : c.status === "needs_decision" ? "decision" : c.status === "abandoned" ? "muted" : "active",
			workspace: c.forkRepo ?? `chg-${String(c.id).toLowerCase()}`, baseSha: short(c.baseSha), headSha: short(c.headSha), landedSha: short(c.integratedSha),
			checks: [...latest.values()].map((k) => ({ stage: k.stage, label: CHECK_LABEL[k.stage] ?? k.stage, outcome: k.outcome, detail: k.detail ?? "" })),
			mainMoved: reintegrations > 0, reintegrations,
			trace: traceOf((input.runs ?? []).filter((r) => r.changeId === c.id)),
		};
	});

	// ---- agents: derived from who holds unfinished work ----
	const agents = new Map<string, Row>();
	for (const t of tasks) {
		if (!t.claimedBy || t.status === "completed") continue;
		const ch = t.changeId ? changeById.get(t.changeId) : undefined;
		const waitingOnHuman = ch?.status === "needs_decision";
		const verifying = ch && ["integrating", "verifying", "ready", "integrated"].includes(ch.status);
		agents.set(t.claimedBy, {
			id: t.claimedBy, name: agentName(t.claimedBy), task: t.title,
			state: waitingOnHuman ? "waiting" : verifying ? "verifying" : "working",
			stateLabel: waitingOnHuman ? "Waiting for you" : verifying ? "Change being verified" : ch?.status === "revision" ? "Revising" : "Building",
			since: ms(t.startedAt) ?? ms(t.claimedAt),
			elapsed: (() => { const t0 = ms(t.startedAt) ?? ms(t.claimedAt); return t0 ? formatDuration(Math.max(0, Math.round((now - t0) / 1000))) : ""; })(),
		});
	}
	const latestBy = new Map<string, Row>();
	for (const e of events) if (e.actorId && !latestBy.has(e.actorId)) latestBy.set(e.actorId, e); // events arrive newest first
	const agentRows: Row[] = [...agents.values()].map((a) => ({ ...a, latest: latestBy.has(a.id) ? sentence(latestBy.get(a.id)!, titleOf(latestBy.get(a.id)!)) : "" }));
	// The verifier is the integration Workflow, shown only while it is checking something.
	const verifying = changes.filter((c) => c.status === "integrating" || c.status === "verifying");
	if (verifying.length) {
		const first = ordered.findIndex((c) => c.id === verifying[0].id) + 1;
		agentRows.push({ id: "integrator", name: "Verifier", task: `Checking Change ${first}${verifying.length > 1 ? ` and ${verifying.length - 1} more` : ""}`, state: "verifying", stateLabel: "Verifying", since: undefined, latest: "" });
	}
	const activeAgents = agentRows.filter((a) => a.id !== "integrator").length;

	// ---- the human's pending decision, with its options ----
	let pendingDecision: Row | null = null;
	if (pending.length) {
		const d = pending[0];
		const [reasonPart, ...rest] = String(d.question ?? "").split(/\n\nEvidence/);
		const options = (Array.isArray(d.options) ? d.options : []).map((o: Row) => ({ ...o, recommended: o.id === "return_for_revision" }));
		pendingDecision = {
			id: d.id, changeId: d.changeId, title: changeById.get(d.changeId)?.title ?? "A change",
			headline: `How should we proceed with “${changeById.get(d.changeId)?.title ?? "this change"}”?`,
			reason: reasonPart.replace(/^Reason:\s*/, "").replace(/ \(change [0-9A-Z]+, commit [0-9a-f]+\)/g, "").trim(), evidence: rest.length ? `Evidence${rest.join("\n\nEvidence")}`.trim() : "", options,
			count: pending.length,
		};
	}

	const timeline = events.slice(0, 40).map((e) => ({ at: e.createdAt, ...describe(e, titleOf(e)) })).filter((e) => e.text);

	const startedAt = ms(outcome.buildStartedAt);
	const endedAt = ms(outcome.readyAt) ?? now;
	const elapsedSeconds = startedAt ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : 0;
	const contributors = new Set(changes.map((c) => c.actorId)).size;

	const deployed = events.find((e) => e.kind === "outcome.deployed");
	return {
		deployment: deployed ? parseDeployment(String(deployed.detail)) : null,
		liveUrl: live ? appUrl : "",
		id: outcome.id, title: outcome.title, statement: outcome.statement, owner: outcome.owner, seeded: !!outcome.seeded, live,
		status: outcome.status, statusLabel: STATUS_LABEL[outcome.status] ?? outcome.status, level: outcome.level ?? 0,
		levelLabel: (LEVELS[outcome.level ?? 0] ?? LEVELS[0]).label, levelStatement: (LEVELS[outcome.level ?? 0] ?? LEVELS[0]).statement,
		healthNote: outcome.healthNote ?? "", readiness: outcome.readiness ?? 0,
		level2: level2Readiness(outcome, changes, counts.changes),
		stage, stages, counts, progress, agents: agentRows, activeAgents, pendingDecision, activity: timeline, changes: changeRows,
		elapsedSeconds, buildStartedAt: outcome.buildStartedAt ?? null,
		summary: {
			elapsed: formatDuration(elapsedSeconds), tasks: counts.completed, changes: counts.landed, agents: contributors,
			decisions: decisions.filter((d) => d.status === "resolved").length, checks: counts.checksTotal,
		},
	};
}

/** The Level 2 readiness preview. Every line is derived from what is recorded; nothing here is a governance system. */
function level2Readiness(outcome: Row, changes: Row[], changeCount: number) {
	const assumptions = Array.isArray(outcome.assumptions) ? outcome.assumptions.length : 0;
	return [
		{ ok: true, label: "Authentication configured" },
		{ ok: changeCount > 0 && changes.every((c) => c.status === "completed"), label: changeCount ? "Every change landed and verified" : "No verified changes on record" },
		{ ok: !!outcome.owner, label: "Owner identified" },
		{ ok: false, label: "Secondary owner required" },
		...(assumptions ? [{ ok: false, label: `${assumptions} assumption${assumptions === 1 ? " is" : "s are"} still unconfirmed` }] : []),
	];
}

/** "17 min", "1 h 04 min", "45 s". */
export function formatDuration(totalSeconds: number): string {
	if (totalSeconds < 90) return `${totalSeconds} s`;
	const m = Math.round(totalSeconds / 60);
	return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

function sentence(e: Row, title: string): string {
	return describe(e, title).text;
}

/** One ChangeEvent as a plain sentence. Only real events are described; unknown kinds are skipped, not invented. */
export function describe(e: Row, title: string): { text: string; tone: string; actor: string } {
	const who = agentName(e.actorId);
	const t = title ? `“${title}”` : "a change";
	const kind = String(e.kind);
	const detail = e.detail ? String(e.detail) : "";
	const mk = (text: string, tone = "neutral") => ({ text, tone, actor: who });
	const check = kind.match(/^check\.([a-z_]+)\.([a-z_]+)$/);
	if (check) {
		const label = CHECK_LABEL[check[1]] ?? check[1];
		const [, , res] = check;
		return mk(res === "passed" ? `${label} passed for ${t}` : res === "failed" ? `${label} failed for ${t}` : `${label} not run for ${t}`, res === "passed" ? "good" : res === "failed" ? "bad" : "neutral");
	}
	switch (kind) {
		case "task.claimed": return mk(`${who} claimed ${t}`);
		case "change.started": return mk(`${who} started work on ${t}`, "active");
		case "lease.acquired": return mk(`${who} reserved ${detail.split("::")[1] ?? detail}`);
		case "lease.denied": return mk(`${who} waited: ${detail}`);
		case "lease.risk": {
			const r = parseRisk(detail);
			if (!r || r.conflict < 0.5) return { text: "", tone: "neutral", actor: who };
			return mk(`${who}: ${Math.round(r.conflict * 100)}% chance this conflicts with ${r.holderTitle}`, "decision");
		}
		case "lease.released": return { text: "", tone: "neutral", actor: who };
		case "task.submitted": return { text: "", tone: "neutral", actor: who };
		case "change.submitted": return mk(`${who} submitted ${t}`, "active");
		case "change.integrating": return mk(`Merging ${t} with the latest main`, "active");
		case "change.verifying": return mk(`Verifier is checking ${t}`, "active");
		case "change.ready": return mk(`${t} is ready to land`, "good");
		case "change.reintegrating":
		case "integration.main_moved": return mk(`Main changed while ${t} was waiting. Merging and verifying again against the latest main`, "active");
		case "change.integrated": return mk(`${t} landed on main${detail ? ` (${short(detail)})` : ""}`, "good");
		case "decision.requested": return mk(`Your decision is needed for ${t}`, "decision");
		case "decision.resolved": return mk(`You chose “${detail.replace(/_/g, " ")}”. ${t} resumes`, "good");
		case "task.completed": return { text: "", tone: "neutral", actor: who };
		case "change.completed": return mk(`${t} is complete`, "good");
		case "outcome.build_started": return mk("Build started", "active");
		case "outcome.ready": return mk("Every task is complete. Ready for launch", "good");
		case "outcome.launched": return mk("Launched", "good");
		case "outcome.deployed": { const d = parseDeployment(detail); return d?.live ? mk(`Verified live on Workers (${d.smokeOk} of ${d.smokeTotal} pages checked)`, "good") : mk("Launched, but the live app did not match main yet", "decision"); }
		case "outcome.adopted": return mk("You adopted this Outcome as Level 1", "good");
		case "outcome.team_promotion_requested": return mk("Level 2 promotion requested", "neutral");
		default: return { text: "", tone: "neutral", actor: who };
	}
}

function parseRisk(detail: string): { conflict: number; holderTitle: string } | undefined {
	try { const r = JSON.parse(detail); return typeof r.conflict === "number" ? r : undefined; } catch { return undefined; }
}

/** Where the launched app lives. It is its own Worker, deployed by Workers Builds; set once per request from env.APP_URL. */
let appUrl = "";
export const setAppUrl = (url: string | undefined) => { appUrl = url ?? ""; };

/** What Launch verified, from the outcome.deployed event: the Worker's URL, the commit on main, whether it is live, and the page checks. */
function parseDeployment(detail: string): { url: string; sha: string; liveSha: string; live: boolean; smokeOk: number; smokeTotal: number; pages: Array<{ path: string; ok: boolean }> } | undefined {
	try {
		const d = JSON.parse(detail);
		const smoke: Array<{ path: string; ok: boolean }> = Array.isArray(d.smoke) ? d.smoke : [];
		return { url: String(d.url), sha: short(d.sha), liveSha: short(d.liveSha), live: !!d.live, smokeOk: smoke.filter((s) => s.ok).length, smokeTotal: smoke.length, pages: smoke.map((s) => ({ path: s.path, ok: !!s.ok })) };
	} catch { return undefined; }
}
