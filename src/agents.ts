// Cloudflare Agents: a Coordinator that only starts workers, and WorkerAgents (facets) that contend for Tasks
// through Zebric over MCP, then do the work with ordinary Git in their own Artifacts fork.
// The coordinator holds no work state; Zebric is the system of record.
import { Agent } from "agents";
import { clone, commitAndPush } from "./git.js";
import { command, zebric } from "./zebric.js";
import { parseEdits, silencesTypeChecker } from "./parse.js";

/** One LLM attempt in a run's trace: what came back and whether it was usable. Outputs are truncated; the pushed commit has the real files. */
type Attempt = { n: number; ms: number; tokens?: number; chars: number; outcome: "accepted" | "rejected"; reason?: string; output: string };
type RunRecord = { kind: "implement" | "revise"; instruction: string; promptHash: string; context: unknown; attempts: Attempt[]; summary: string; headSha: string; files: string[]; startedAt: number };
const sha12 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
const manifest = (source: string, files: Record<string, string>) => ({ source, files: Object.entries(files).filter(([p]) => p.startsWith("src/") || p === "README.md").map(([path, c]) => ({ path, bytes: c.length })) });

export type Step = { t: number; agent: string; event: string; detail?: unknown };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SYSTEM = `You are a coding agent working on a small TypeScript Worker that serves a web app: every feature is an HTML page (strict mode, no dependencies, Web standard Request/Response).
Implement the task by editing or creating files. Reply in EXACTLY this format and nothing else:

===SUMMARY===
<one or two sentences describing the change>
===FILE: src/some-file.ts===
<the complete new contents of the file>
===END===

Repeat the FILE block for every file you create or change; always give the complete file, never a diff. Only touch files under src/. Keep imports using the ".js" extension (e.g. import { x } from "./x.js"). The code must pass "tsc --strict". A feature only counts once it is reachable: if the task adds a route, you MUST also reply with the updated src/index.ts that registers it. Make the smallest change that fully does the task. Do not rewrite unrelated code.
Pages: build every page with page(title, body) from "./layout.js" and escape every dynamic value with esc(). Use the CSS classes documented at the top of src/layout.ts (cards, tables, badges); do not add external resources, scripts or inline JavaScript. Links must be relative (href="expiring?days=14"), never start with "/". Not-found and error responses are pages too: use notFound(what) or page(title, body, status) from "./layout.js", never a bare Response. Every page must render successfully with no query string.`;

export class WorkerAgent extends Agent<any> {
	private log: Step[] = [];
	private agentName = "";
	private note(event: string, detail?: unknown) {
		this.log.push({ t: Date.now(), agent: this.agentName, event, detail });
	}

	/** Drains ready tasks until none are left (or maxTasks done). Returns this agent's event log. */
	async work(index: number, origin: string, opts: { maxTasks?: number; repositoryId?: string; leases?: boolean; only?: string; holdUntilTaskCompleted?: string; watch?: boolean; exclude?: string[]; firstIndex?: number } = {}): Promise<Step[]> {
		this.log = [];
		this.agentName = `agent-${index}`;
		const key = (this.env as any)[`AGENT${index}_API_KEY`] as string;
		const { id: serverId } = await this.addMcpServer(`zebric-${this.agentName}`, `${origin}/mcp`, {
			transport: { headers: { authorization: `Bearer ${key}` } },
		}) as { id: string };

		// Zebric core generates the tools; retry only what Zebric marks retryable.
		const call = async (name: string, args: Record<string, unknown>) => {
			for (let attempt = 0; ; attempt++) {
				const r: any = await this.mcp.callTool({ serverId, name, arguments: args });
				const text: string = r.content?.[0]?.text ?? "";
				const err = r.isError ? (r.structuredContent?.error ?? { message: text }) : undefined;
				if (!err?.retryable || attempt >= 14) return { isError: !!r.isError, data: r.isError ? err : text ? JSON.parse(text) : null };
				this.note("retry", { tool: name, attempt: attempt + 1, code: err.code });
				await sleep(40 * 2 ** Math.min(attempt, 6) * (0.5 + Math.random()));
			}
		};

		let done = 0;
		while (done < (opts.maxTasks ?? 1)) {
			const list = await call("zebric_task_entity_api_list_task", { limit: 500 });
			const ready = ((list.data as any[]) ?? []).filter((t) => t.status === "ready" && (!opts.repositoryId || t.repositoryId === opts.repositoryId) && (!opts.only || t.title === opts.only) && !opts.exclude?.includes(t.title));
			if (!ready.length) { this.note("no_work"); break; }
			const target = ready[Math.floor(Math.random() * ready.length)];
			const claim = await call("zebric_claim_task", { id: target.id });
			if (claim.isError) { this.note("claim_rejected", { task: target.title, code: (claim.data as any).code }); continue; }
			this.note("claimed", target.title);
			try {
				await this.doTask(call, key, origin, target, opts);
				done++;
			} catch (e) {
				console.error("agent task failed", this.agentName, target.title, String((e as Error).message ?? e).slice(0, 400));
				this.note("task_failed", { task: target.title, error: String((e as Error).message ?? e).slice(0, 400) });
				break; // leave the task visible in Zebric in whatever state it reached
			}
		}
		return this.log;
	}

	private async doTask(call: (n: string, a: Record<string, unknown>) => Promise<{ isError: boolean; data: any }>, key: string, origin: string, task: any, opts: { maxTasks?: number; repositoryId?: string; leases?: boolean; only?: string; holdUntilTaskCompleted?: string; watch?: boolean; exclude?: string[]; firstIndex?: number }) {
		const useLeases = !!opts.leases;
		const must = async (name: string, args: Record<string, unknown>) => {
			const r = await call(name, args);
			if (r.isError) throw new Error(`${name} failed: ${JSON.stringify(r.data).slice(0, 300)}`);
			return r.data;
		};
		await must("zebric_start_change", { id: task.id });
		const fresh = await must("zebric_task_entity_api_get_task", { id: task.id });
		const changeId = fresh.changeId as string;
		this.note("change_started", { task: task.title, changeId });

		const ws = await fetch(`${origin}/workspace/${changeId}`, { method: "POST", headers: { authorization: `Bearer ${key}` } });
		if (!ws.ok) throw new Error(`workspace ${ws.status} ${(await ws.text()).slice(0, 200)}`);
		const { repo, remote, token } = await ws.json() as { repo: string; remote: string; token: string };
		this.note("workspace", repo);
		const co = await clone(remote, token);

		// Declared intent: optional leases. If denied, wait; never edit anyway. Clef (when enabled) first judges whether this
		// change could conflict with the changes of whoever already holds a lease, even on different symbols.
		const startedAt = Date.now();
		let leaseAdvice: Array<{ holder: string; conflict: number; action: string }> = [];
		if (useLeases) {
			leaseAdvice = await this.consultClef(call, key, origin, changeId, task, co.files);
			for (const symbol of (String(task.description).match(/Symbols:\s*(.+)/)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
				for (let waited = 0; ; waited += 3000) {
					const r = await call("zebric_acquire_symbol_lease", { id: task.id, symbol });
					if (!r.isError) { this.note("lease_acquired", symbol); break; }
					if (waited >= 240_000) throw new Error(`lease for ${symbol} never granted`);
					this.note("lease_denied", symbol);
					await sleep(3000);
				}
			}
		}

		const repoText = Object.entries(co.files).filter(([p]) => p.startsWith("src/") || p === "README.md")
			.map(([p, c]) => `--- ${p} ---\n${c}`).join("\n");
		const messages: Array<{ role: string; content: string }> = [
			{ role: "system", content: SYSTEM },
			{ role: "user", content: `Repository files:\n\n${repoText}\n\nTask: ${task.title}\n${String(task.description).replace(/\nSymbols:.*/, "")}` },
		];
		const baseSha = ((await call("zebric_change_entity_api_get_change", { id: changeId })).data as any)?.baseSha ?? null;
		const instruction = messages[1].content.slice(messages[1].content.indexOf("Task: "));
		const promptHash = await sha12(messages.map((m) => m.content).join("\n"));
		const attempts: Attempt[] = [];
		let parsed: ReturnType<typeof parseEdits> | undefined;
		for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
			const t0 = Date.now();
			const out: any = await this.env.AI.run(this.env.AGENT_MODEL, { messages, max_tokens: 8000, temperature: 0.2 });
			const text: string = out?.choices?.[0]?.message?.content ?? out?.response ?? "";
			this.note("llm", { ms: Date.now() - t0, chars: text.length, tokens: out?.usage?.completion_tokens });
			const trace: Attempt = { n: attempt + 1, ms: Date.now() - t0, tokens: out?.usage?.completion_tokens, chars: text.length, outcome: "accepted", output: text.slice(0, 6000) };
			attempts.push(trace);
			try {
				parsed = parseEdits(text);
				// The files the task declares it will touch (its Symbols line) must be in the reply, plus
				// src/index.ts when the task registers a route. Files only mentioned for reading are not required.
				const desc = String(task.description);
				const named = new Set((desc.match(/Symbols:\s*(.+)/)?.[1] ?? "").split(",").map((x) => x.trim().split("::")[0]).filter(Boolean));
				if (/Register the route in src\/index\.ts/.test(desc)) named.add("src/index.ts");
				// "Requires:" lists acceptance criteria (separated by ;;) as substrings that must appear in the edited code.
				const requires = (desc.match(/\nRequires:\s*(.+)/)?.[1] ?? "").split(";;").map((x) => x.trim()).filter(Boolean);
				const allCode = Object.values(parsed!.edits).join("\n");
				const silenced = silencesTypeChecker(allCode);
				if (silenced) { parsed = undefined; throw new Error(`the code uses ${silenced}; satisfy the type checker properly instead of silencing it`); }
				const unmet = requires.filter((r) => !allCode.includes(r));
				if (unmet.length) { parsed = undefined; throw new Error(`the task requires the code to contain: ${unmet.map((u) => `"${u}"`).join(", ")}`); }
				const missing = [...named].filter((f) => !(f in parsed!.edits));
				if (missing.length) { const m = missing.join(", "); parsed = undefined; throw new Error(`the task requires changes to ${m} but your reply did not include ${m}`); }
			}
			catch (e) {
				this.note("llm_bad_output", String((e as Error).message));
				trace.outcome = "rejected"; trace.reason = String((e as Error).message).slice(0, 500);
				messages.push({ role: "assistant", content: text.slice(0, 4000) }, { role: "user", content: `Your reply could not be used: ${(e as Error).message}. Reply again in exactly the required format.` });
			}
		}
		if (!parsed) throw new Error("model never produced a usable reply");

		const sha = await commitAndPush(co, remote, token, parsed.edits, `${task.title}\n\n${parsed.summary}`);
		this.note("pushed", { sha, files: Object.keys(parsed.edits) });
		await this.recordRun(call, task.id, {
			kind: "implement", instruction, promptHash, attempts, summary: parsed.summary, headSha: sha, files: Object.keys(parsed.edits), startedAt,
			context: { inherited: [manifest(`fork@${String(baseSha).slice(0, 7)} (main when the change started)`, co.files)], leaseAdvice },
		});
		// Demo choreography: this agent "works slowly" and only submits once the named task has landed, so the two
		// changes were forked from the same base but are integrated one after the other.
		if (opts.holdUntilTaskCompleted) {
			this.note("holding_submit", opts.holdUntilTaskCompleted);
			for (let i = 0; ; i++) {
				const all = (await must("zebric_task_entity_api_list_task", { limit: 500 })) as any[];
				if (all.some((t) => t.repositoryId === task.repositoryId && t.title === opts.holdUntilTaskCompleted && t.status === "completed")) break;
				if (i > 200) throw new Error(`"${opts.holdUntilTaskCompleted}" never completed`);
				await sleep(3000);
			}
		}
		await must("zebric_submit_change", { id: changeId, headSha: sha });
		await must("zebric_submit_task", { id: task.id });
		this.note("submitted", { task: task.title, changeId, sha });
		if (useLeases) {
			const leases = ((await must("zebric_symbollease_entity_api_list_symbollease", { limit: 500 })) as any[]).filter((l) => l.taskId === task.id && l.status === "active");
			for (const l of leases) await call("zebric_release_symbol_lease", { id: l.id });
		}
		if (opts.watch) await this.watchChange(call, key, origin, task, changeId, parsed);
	}

	/** Writes the run's provenance to Zebric. Informational: a failure here never fails the work. */
	private async recordRun(call: (n: string, a: Record<string, unknown>) => Promise<{ isError: boolean; data: any }>, taskId: string, r: RunRecord) {
		try {
			const res = await call("zebric_record_agent_run", {
				id: taskId, kind: r.kind, model: String(this.env.AGENT_MODEL), promptHash: r.promptHash, instruction: r.instruction,
				context: JSON.stringify(r.context), attempts: JSON.stringify(r.attempts), summary: r.summary, headSha: r.headSha,
				files: JSON.stringify(r.files), durationMs: Date.now() - r.startedAt,
			});
			this.note(res.isError ? "agent_run_not_recorded" : "agent_run_recorded", res.isError ? { code: (res.data as any)?.code } : { kind: r.kind, attempts: r.attempts.length });
		} catch (e) {
			this.note("agent_run_not_recorded", String((e as Error)?.message ?? e).slice(0, 200));
		}
	}

	/**
	 * Smart leases. Asks the Worker (which asks Clef) about every other task being worked on in the repository, records the verdict in Zebric,
	 * and in "wait" mode holds off, bounded, until the earlier conflicting tasks have submitted. Never blocks on its own failure.
	 */
	private async consultClef(call: (n: string, a: Record<string, unknown>) => Promise<{ isError: boolean; data: any }>, key: string, origin: string, changeId: string, task: any, files: Record<string, string>): Promise<Array<{ holder: string; conflict: number; action: string }>> {
		const mode = String((this.env as any).CLEF_LEASES ?? "off");
		const seen: Array<{ holder: string; conflict: number; action: string }> = [];
		if (mode !== "advise" && mode !== "wait") return seen;
		try {
			const srcFiles = Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith("src/")));
			const res = await fetch(`${origin}/lease-advice/${changeId}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ files: srcFiles }) });
			if (!res.ok) return seen;
			const { advice } = (await res.json()) as { advice: Array<{ holderTaskId: string; holderTitle: string; earlier: boolean; conflict: number; severity: number; action: string; ms: number }> };
			const risky = advice.filter((a) => a.earlier && a.conflict >= 0.5 && a.action !== "proceed");
			for (const a of advice) {
				const waits = mode === "wait" && risky.includes(a);
				this.note("lease_risk", { holder: a.holderTitle, conflict: a.conflict, action: a.action });
				seen.push({ holder: a.holderTitle, conflict: a.conflict, action: a.action });
				await call("zebric_record_lease_risk", { id: task.id, detail: JSON.stringify({ ...a, mode, waited: waits }) });
			}
			if (mode !== "wait" || !risky.length) return seen;
			for (let waited = 0; waited < 240_000; waited += 3000) {
				const tasks = ((await call("zebric_task_entity_api_list_task", { limit: 500 })).data as any[]) ?? [];
				if (!tasks.some((t) => t.status === "working" && risky.some((a) => a.holderTaskId === t.id))) return seen;
				await sleep(3000);
			}
		} catch (e) {
			this.note("lease_risk_failed", String((e as Error)?.message ?? e).slice(0, 200)); // fail open
		}
		return seen;
	}

	/**
	 * After submitting, stay with the change. If integration fails and a human returns it for revision, redo the work
	 * against current main, using the failing evidence and the decision, then resubmit. Zebric holds the state.
	 */
	private async watchChange(call: (n: string, a: Record<string, unknown>) => Promise<{ isError: boolean; data: any }>, key: string, origin: string, task: any, changeId: string, previous: { summary: string; edits: Record<string, string> }) {
		let revisions = 0;
		let lastHandled = "";
		for (let i = 0; i < 400; i++) { // about 20 minutes
			await sleep(3000);
			const ch = (await call("zebric_change_entity_api_get_change", { id: changeId })).data;
			if (!ch) continue;
			if (ch.status === "completed" || ch.status === "abandoned") { this.note("change_final", { status: ch.status }); return; }
			if (ch.status !== "revision" || revisions >= 3) continue;
			const marker = `${ch.updatedAt}`;
			if (marker === lastHandled) continue;
			lastHandled = marker;
			revisions++;
			previous = await this.revise(call, key, origin, task, changeId, previous);
		}
		this.note("watch_timeout", { changeId });
	}

	private async revise(call: (n: string, a: Record<string, unknown>) => Promise<{ isError: boolean; data: any }>, key: string, origin: string, task: any, changeId: string, previous: { summary: string; edits: Record<string, string> }) {
		const decisions = ((await call("zebric_decision_entity_api_list_decision", { limit: 500 })).data as any[]).filter((d) => d.changeId === changeId && d.status === "resolved").sort((a, b) => (a.id < b.id ? -1 : 1));
		const decision = decisions[decisions.length - 1];
		const checks = ((await call("zebric_check_entity_api_list_check", { limit: 1000 })).data as any[]).filter((c) => c.changeId === changeId).sort((a, b) => (a.id < b.id ? -1 : 1));
		const failed = [...checks].reverse().find((c) => c.outcome === "failed");
		this.note("revision_requested", { choice: decision?.choice, failed: failed?.stage });
		const startedAt = Date.now();

		const ws = await fetch(`${origin}/workspace/${changeId}`, { method: "POST", headers: { authorization: `Bearer ${key}` } });
		if (!ws.ok) throw new Error(`workspace ${ws.status} ${(await ws.text()).slice(0, 200)}`);
		const w = await ws.json() as { remote: string; token: string; mainRemote: string; mainToken: string };
		const [fork, main] = await Promise.all([clone(w.remote, w.token), clone(w.mainRemote, w.mainToken)]);
		const mainText = Object.entries(main.files).filter(([p]) => p.startsWith("src/")).map(([p, c]) => `--- ${p} ---\n${c}`).join("\n");
		const prevText = Object.entries(previous.edits).map(([p, c]) => `--- ${p} ---\n${c}`).join("\n");
		const instruction = decision?.choice === "preserve_contract"
			? "The reviewer chose to PRESERVE THE EXISTING CONTRACT: do not rely on any changed behaviour of shared code; keep your feature self-contained and do not edit code owned by other changes."
			: "The reviewer returned your change for REVISION: adapt your change to the code now on main (including any changed contracts) so it compiles and still delivers your feature. Do not silence the compiler (no ! non-null assertions, no `as` casts, no @ts-ignore): handle the missing case properly, and for an HTTP endpoint answer a missing user with a 404 Response. Do not silence the compiler (no ! non-null assertions, no `as` casts, no @ts-ignore): handle the case properly, and for an HTTP endpoint answer a missing user with a 404 Response.";
		const messages: Array<{ role: string; content: string }> = [
			{ role: "system", content: SYSTEM },
			{ role: "user", content: `Your change was integrated onto the CURRENT main and verification failed.\n\nTask: ${task.title}\n${String(task.description).replace(/\nSymbols:.*/, "")}\n\nVerification failure (${failed?.stage}):\n${failed?.detail ?? "(none)"}\n\n${instruction}\n\nYour previous attempt (files you wrote):\n${prevText}\n\nCurrent main (this is what your change must work with):\n${mainText}\n\nReply with the complete updated contents of every file you need to change so the result compiles with "tsc --strict" on current main. Keep the feature itself.` },
		];
		const userText = messages[1].content;
		const promptHash = await sha12(messages.map((m) => m.content).join("\n"));
		const attempts: Attempt[] = [];
		let parsed: ReturnType<typeof parseEdits> | undefined;
		for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
			const t0 = Date.now();
			const out: any = await this.env.AI.run(this.env.AGENT_MODEL, { messages, max_tokens: 8000, temperature: 0.2 });
			const text: string = out?.choices?.[0]?.message?.content ?? out?.response ?? "";
			this.note("llm", { ms: Date.now() - t0, chars: text.length, revision: true });
			const trace: Attempt = { n: attempt + 1, ms: Date.now() - t0, tokens: out?.usage?.completion_tokens, chars: text.length, outcome: "accepted", output: text.slice(0, 6000) };
			attempts.push(trace);
			try {
				parsed = parseEdits(text);
				const silenced = silencesTypeChecker(Object.values(parsed.edits).join("\n"));
				if (silenced) { parsed = undefined; throw new Error(`the code uses ${silenced}; satisfy the type checker properly instead of silencing it`); }
			}
			catch (e) {
				this.note("llm_bad_output", String((e as Error).message));
				trace.outcome = "rejected"; trace.reason = String((e as Error).message).slice(0, 500);
				messages.push({ role: "assistant", content: text.slice(0, 4000) }, { role: "user", content: `Your reply could not be used: ${(e as Error).message}. Reply again in exactly the required format.` });
			}
		}
		if (!parsed) throw new Error("model never produced a usable revision");
		// The new head is current main plus the revised files, committed on top of the fork's history.
		const tree: Record<string, string> = { ...Object.fromEntries(Object.entries(main.files).filter(([p]) => p.startsWith("src/"))), ...parsed.edits };
		const sha = await commitAndPush(fork, w.remote, w.token, tree, `${task.title} (revision)\n\n${parsed.summary}`);
		this.note("pushed", { sha, files: Object.keys(parsed.edits), revision: true });
		await this.recordRun(call, task.id, {
			kind: "revise", promptHash, attempts, summary: parsed.summary, headSha: sha, files: Object.keys(parsed.edits), startedAt,
			// The instruction omits the repository dumps (they are in the manifest) and keeps what steered this attempt.
			instruction: `Task: ${task.title}\n${instruction}\n\n${userText.slice(userText.indexOf("Verification failure"), userText.indexOf("Your previous attempt")).trim()}`,
			context: {
				decision: decision ? { id: decision.id, choice: decision.choice, resolvedBy: decision.resolvedBy } : null,
				failedCheck: failed ? { id: failed.id, stage: failed.stage } : null,
				inherited: [manifest("previous attempt (files this agent wrote before)", previous.edits), manifest("current main (what the change was rebased onto)", main.files), manifest("fork (history the revision is committed on)", fork.files)],
			},
		});
		const r = await call("zebric_submit_change", { id: changeId, headSha: sha });
		if (r.isError) throw new Error(`resubmit failed: ${JSON.stringify(r.data).slice(0, 300)}`);
		this.note("resubmitted", { changeId, sha });
		return { summary: parsed.summary, edits: { ...previous.edits, ...parsed.edits } };
	}
}

export interface BuildParams { origin: string; repositoryId: string; titles: string[]; workers: number; maxTasks: number }

export class Coordinator extends Agent<any> {
	/** Spawns workers in parallel and nudges them. Assigns nothing. */
	async run(origin: string, workers: number, opts: { maxTasks?: number; repositoryId?: string; leases?: boolean; only?: string; holdUntilTaskCompleted?: string; watch?: boolean; exclude?: string[]; firstIndex?: number } = {}): Promise<Step[]> {
		const logs = await Promise.all(Array.from({ length: workers }, async (_, i) => {
			const stub = await this.dynamicAgents.get(WorkerAgent, `worker-${i + 1 + (opts.firstIndex ?? 0)}-${Date.now().toString(36)}`);
			return stub.work(i + 1 + (opts.firstIndex ?? 0), origin, opts);
		}));
		return logs.flat().sort((a, b) => a.t - b.t);
	}

	/**
	 * The hero scenario: one agent per title, all forked from the same base. The first changes a contract; every other
	 * agent only submits after the first has landed (so they are written against the old contract and break against the
	 * new main, each raising its own decision). All of them stay with their change until it is final.
	 */
	async hero(origin: string, repositoryId: string, titles: string[], leases = true): Promise<Step[]> {
		const common = { repositoryId, maxTasks: 1, leases, watch: true };
		const stamp = Date.now().toString(36);
		const logs = await Promise.all(titles.map(async (title, i) => {
			const stub = await this.dynamicAgents.get(WorkerAgent, `hero-${i + 1}-${stamp}`);
			return stub.work(i + 1, origin, { ...common, only: title, ...(i ? { holdUntilTaskCompleted: titles[0] } : {}) });
		}));
		return logs.flat().sort((x, y) => x.t - y.t);
	}

	/**
	 * The Outcome build: the choreographed hero agents (one per hero title, from agent 1), plus `workers` more agents (after them) draining the
	 * remaining tasks of the same repository. All of them contend through Zebric as usual.
	 */
	async build(origin: string, repositoryId: string, titles: string[], workers: number, maxTasks: number): Promise<Step[]> {
		const [heroLog, restLog] = await Promise.all([
			this.hero(origin, repositoryId, titles, true),
			this.run(origin, workers, { repositoryId, maxTasks, leases: true, watch: true, exclude: titles, firstIndex: titles.length }),
		]);
		return [...heroLog, ...restLog].sort((x, y) => x.t - y.t);
	}

	/** Returns at once; the build runs from an alarm so it outlives the request (and the Zebric workflow step) that started it. */
	async kickoff(p: BuildParams): Promise<{ scheduled: true }> {
		await this.schedule(1, "buildNow", p);
		return { scheduled: true };
	}

	async buildNow(p: BuildParams): Promise<void> {
		await this.schedule(15, "checkReady", { outcomeId: p.repositoryId, tries: 0 });
		await this.keepAliveWhile(() => this.build(p.origin, p.repositoryId, p.titles, p.workers, p.maxTasks));
	}

	/**
	 * Marks the Outcome ready once every one of its Tasks is completed (changes integrated, tasks closed by the Workflow).
	 * Re-schedules itself while work remains, which includes a Workflow durably waiting on a human, for up to an hour.
	 */
	async checkReady(p: { outcomeId: string; tries: number }): Promise<void> {
		const tasks = ((await zebric(this.env, "GET", "/api/tasks?limit=500")).json as Array<{ repositoryId: string; status: string }>).filter((t) => t.repositoryId === p.outcomeId);
		if (tasks.length && tasks.every((t) => t.status === "completed")) { await command(this.env, "mark_outcome_ready", p.outcomeId); return; }
		if (p.tries < 360) await this.schedule(10, "checkReady", { outcomeId: p.outcomeId, tries: p.tries + 1 });
	}
}
