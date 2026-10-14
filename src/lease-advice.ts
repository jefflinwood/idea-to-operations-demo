// Smart leases: before an agent takes a symbol lease, Clef (a Workers AI decision model) judges whether the change it
// is about to make could break, or be broken by, the change of every other task being worked on in the repository.
// Peers are the tasks in "working", not just current lease holders: agents start together and ask before anyone has
// taken a lease, so a lease table alone would usually be empty.
// Advisory only. Zebric still grants leases by exact symbol; this adds a risk signal and, in "wait" mode, a reason to hold off.
// Fails open: any error returns no advice.
export type LeaseAdvice = {
	holderTaskId: string;
	holderTitle: string;
	heldBy: string;
	/** The holder began before the requester. Only earlier peers are ever waited on, so two agents cannot wait on each other. */
	earlier: boolean;
	conflict: number;
	severity: number;
	action: "proceed" | "wait" | "ask_human";
	ms: number;
};

const MODEL = "clef";
export const CONFLICT_THRESHOLD = 0.5;
const MAX_FILE_CHARS = 12_000;

const QUESTIONS = {
	conflict: { type: "noul", instructions: "Could the requesting task's change break, or be broken by, the holder's change once both are merged? Consider callers, consumers, types and contracts, not just identical symbols. Two changes that merely add independent entries to the same list or object do not break each other." },
	severity: { type: "score", instructions: "How severe is the interaction between the two changes?", criteria: ["None: independent", "Low: they touch the same text but are additive or independent, and merge cleanly in meaning", "High: one change relies on code, types or behavior that the other changes or removes"] },
	action: { type: "choice", instructions: "What should the requesting agent do?", criteria: { proceed: "Safe to edit now, independent of the holder", wait: "Wait until the holder's change has landed, then build on it", ask_human: "The two changes assume incompatible behavior; a person should decide" } },
} as const;

const symbolsOf = (t: any): string[] => (String(t.description).match(/Symbols:\s*(.+)/)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const brief = (t: any) => ({ title: t.title, plan: String(t.description).replace(/\n?(Symbols|Requires):.*/g, "").trim(), symbols: symbolsOf(t) });

/** Asks Clef about each other task that is being worked on in the same repository. */
export async function adviseLease(env: Env, list: (entity: string) => Promise<any[]>, task: any, files: Record<string, string>): Promise<LeaseAdvice[]> {
	try {
		const tasks = await list("tasks");
		const started = (t: any) => new Date(t.startedAt ?? t.claimedAt ?? 0).getTime();
		const before = (t: any) => started(t) < started(task) || (started(t) === started(task) && t.id < task.id);
		const holders = new Map<string, any>();
		for (const t of tasks) if (t.repositoryId === task.repositoryId && t.id !== task.id && t.status === "working") holders.set(t.id, { task: t, actorId: t.claimedBy, earlier: before(t) });
		const source = (t: any) => Object.fromEntries([...new Set(symbolsOf(t).map((s) => s.split("::")[0]))].filter((f) => f in files).map((f) => [f, files[f].slice(0, MAX_FILE_CHARS)]));
		const requester = { ...brief(task), current_source: source(task) };
		return (await Promise.all([...holders.values()].map(async ({ task: h, actorId, earlier }): Promise<LeaseAdvice | undefined> => {
			const t0 = Date.now();
			const out: any = await (env.AI as any).run(`@cf/cloudflare/${MODEL}`, {
				model: MODEL,
				state: { lease_held_by: { ...brief(h), current_source: source(h) }, lease_requested_by: requester },
				questions: QUESTIONS,
			});
			const a = out?.answers;
			if (!a) return undefined;
			return { holderTaskId: h.id, holderTitle: h.title, heldBy: actorId, earlier, conflict: a.conflict.noul, severity: a.severity.probabilities?.["2"] ?? 0, action: a.action.choice, ms: Date.now() - t0 };
		}))).filter((x): x is LeaseAdvice => !!x);
	} catch (e) {
		console.error("lease advice failed (failing open)", String((e as Error)?.message ?? e).slice(0, 300));
		return [];
	}
}
