// One Workflow instance per Change. It owns durable execution: integrate against current main, verify,
// then either land on main or ask a human (durable wait) and carry on after the decision.
// Zebric stays the system of record: every transition below is a Zebric command, every stage a Check.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { command, getEntity, zebric } from "./zebric.js";
import { mergeChangeIntoMain, pushToMain, typecheck, type MergeResult } from "./integrate.js";

export interface ChangeParams { changeId: string; headSha: string }
export interface DecisionEvent { choice: string; decisionId: string }
export interface ResubmittedEvent { headSha: string }

const RETRY = { retries: { limit: 3, delay: "3 seconds", backoff: "exponential" } } as const;
const MAX_ATTEMPTS = 12;

type Failure = { stage: "structural_merge" | "typescript"; summary: string };

export class ChangeWorkflow extends WorkflowEntrypoint<Env, ChangeParams> {
	async run(event: WorkflowEvent<ChangeParams>, step: WorkflowStep) {
		const { changeId } = event.payload;
		let headSha = event.payload.headSha;
		const env = this.env;
		const status = async () => (await getEntity(env, "changes", changeId)).status as string;
		const check = (stage: string, outcome: string, detail?: string) => command(env, "record_check", changeId, { stage, outcome, detail });

		const change = await step.do("load-change", RETRY, async () => {
			const c = await getEntity(env, "changes", changeId);
			const t = await getEntity(env, "tasks", c.taskId);
			const r = await getEntity(env, "repositorys", c.repositoryId);
			return { taskId: c.taskId as string, title: t.title as string, repositoryId: c.repositoryId as string, baseRepo: r.artifactsRepo as string };
		});

		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			const n = `a${attempt}`;

			// submitted -> integrating (or ready -> integrating when main moved under us). Idempotent across retries.
			await step.do(`${n}-begin`, RETRY, async () => {
				const s = await status();
				if (s === "submitted") await command(env, "begin_integration", changeId);
				else if (s === "ready") await command(env, "reopen_integration", changeId);
				else if (s !== "integrating") throw new NonRetryableError(`change is ${s}, cannot integrate`);
			});

			// Merge against CURRENT main. The real merge base comes from git, not from Change.baseSha.
			const merged = await step.do(`${n}-merge`, { ...RETRY, timeout: "3 minutes" }, async () => {
				const m = await mergeChangeIntoMain(env, change.baseRepo, changeId, headSha);
				return { ...m, conflicts: m.conflicts };
			}) as MergeResult;

			let failure: Failure | undefined;
			await step.do(`${n}-check-merge`, RETRY, async () => {
				const how = merged.conflicts.length
					? `${merged.conflicts.length} file(s) conflict: ${merged.conflicts.map((c) => c.path).join(", ")}`
					: `merged onto main ${merged.mainSha.slice(0, 7)} (base ${merged.baseSha.slice(0, 7)}${merged.fastForward ? ", fast-forward" : ", main had moved"}); structural merge of: ${merged.mergedByMergiraf.join(", ") || "none needed"}`;
				await check("structural_merge", merged.conflicts.length ? "failed" : "passed", how);
			});
			if (merged.conflicts.length) {
				failure = { stage: "structural_merge", summary: merged.conflicts.map((c) => `${c.path}: ${c.preview.slice(0, 300)}`).join("\n---\n") };
			}

			if (!failure) {
				await step.do(`${n}-verify-start`, RETRY, async () => { if ((await status()) === "integrating") await command(env, "begin_verification", changeId); });
				const tsc = await step.do(`${n}-typescript`, { ...RETRY, timeout: "4 minutes" }, async () => typecheck(env, merged.tree));
				await step.do(`${n}-check-tsc`, RETRY, async () => {
					await check("typescript", tsc.status, tsc.status === "failed" ? tsc.diagnostics.join("\n").slice(0, 1500) : `tsc --strict passed on merged tree (${tsc.tscMs} ms)`);
					await check("tests", "not_run", "the demo app has no test suite");
				});
				if (tsc.status === "failed") failure = { stage: "typescript", summary: tsc.diagnostics.join("\n") };
			}

			if (!failure) {
				await step.do(`${n}-ready`, RETRY, async () => { if ((await status()) === "verifying") await command(env, "mark_ready", changeId); });
				// The only serialized mutation: Git rejects this push if main moved after we merged.
				const pushed = await step.do(`${n}-push`, { ...RETRY, timeout: "3 minutes" }, async () => pushToMain(env, change.baseRepo, merged, `${change.title}\n\nIntegrated change ${changeId} (head ${headSha.slice(0, 7)}) onto main ${merged.mainSha.slice(0, 7)}.`));
				if (pushed.kind === "moved") {
					await step.do(`${n}-moved`, RETRY, async () => {
						await zebric(env, "POST", "/api/changeevents", { changeId, kind: "integration.main_moved", actorId: "integration-workflow", detail: `main advanced to ${pushed.mainNow.slice(0, 7)} while verifying; merging again` });
					});
					await step.sleep(`${n}-backoff`, `${Math.min(attempt, 5) * 2} seconds`);
					continue;
				}
				await step.do(`${n}-land`, RETRY, async () => {
					if ((await status()) === "ready") await command(env, "integrate_change", changeId, { integratedSha: pushed.sha });
					await zebric(env, "PUT", `/api/repositorys/${change.repositoryId}`, { mainSha: pushed.sha });
				});
				// The agent calls submit_task right after submit_change, so it can trail the integration; wait for it.
				await step.do(`${n}-complete`, { ...RETRY, timeout: "3 minutes" }, async () => {
					for (let i = 0; i < 30; i++) {
						const t = await getEntity(env, "tasks", change.taskId);
						if (t.status === "completed") break;
						if (t.status === "submitted") { await command(env, "complete_task", change.taskId); break; }
						await new Promise((r) => setTimeout(r, 3000));
					}
					if ((await status()) === "integrated") await command(env, "complete_change", changeId);
				});
				return { changeId, outcome: "integrated", sha: pushed.sha, attempts: attempt };
			}

			// Failure: ask a human, then wait durably for the answer.
			const decisionId = await step.do(`${n}-request-decision`, RETRY, async () => {
				if ((await status()) !== "needs_decision") {
					// Say what happened: which changes landed on main meanwhile, and the exact compiler/merge evidence.
					const landed: string[] = [];
					for (const l of merged.landed) {
						const lc = await getEntity(env, "changes", l.changeId);
						const lt = lc?.taskId ? await getEntity(env, "tasks", lc.taskId) : undefined;
						landed.push(`"${lt?.title ?? l.subject}" (change ${l.changeId}, commit ${l.sha.slice(0, 7)})`);
					}
					const why = failure!.stage === "typescript"
						? (landed.length ? `${landed.join("; ")} landed on main while this change was in progress and altered code this change depends on. Each passes alone; together TypeScript fails.` : "TypeScript fails on this change integrated onto current main.")
						: `The structural merge of this change with main conflicts${landed.length ? ` after ${landed.join("; ")} landed` : ""}.`;
					await command(env, "request_decision", changeId, {
						question: `Reason:\n${why}\n\nEvidence (${failure!.stage}):\n${failure!.summary.split("\n").slice(0, 6).join("\n")}\n\nChange: "${change.title}" (${changeId})`,
						options: [
							{ id: "return_for_revision", label: "Return for revision", description: "The agent adapts this change to what is on main." },
							{ id: "preserve_contract", label: "Preserve old contract", description: "The agent keeps this change self-contained and does not rely on the changed code." },
							{ id: "abandon", label: "Abandon change", description: "Drop this change." },
						],
					});
				}
				const ds = (await zebric(env, "GET", "/api/decisions?limit=500")).json as Array<{ id: string; changeId: string; status: string }>;
				return ds.filter((d) => d.changeId === changeId && d.status === "pending").map((d) => d.id).pop() as string;
			});
			const decision = await step.waitForEvent<DecisionEvent>(`${n}-wait-decision`, { type: "decision", timeout: "7 days" });
			if (decision.payload.choice === "abandon") return { changeId, outcome: "abandoned", decisionId };

			// The change is now in `revision`; wait for whoever fixes it to push and resubmit.
			const resub = await step.waitForEvent<ResubmittedEvent>(`${n}-wait-resubmit`, { type: "resubmitted", timeout: "7 days" });
			headSha = resub.payload.headSha;
		}
		throw new NonRetryableError(`gave up after ${MAX_ATTEMPTS} integration attempts`);
	}
}
