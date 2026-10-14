import { getAgentByName } from "agents";
import { HERO_TITLES } from "./hero.js";

// The seam between Zebric workflows and the Cloudflare ChangeWorkflow: a Zebric `service` step lands here.
export function createChangeflowServices(env: any) {
	return {
		async invoke(service: string, operation: string, params: Record<string, unknown>): Promise<unknown> {
			if (service !== "changeflow") throw new Error(`Unknown service: ${service}`);
			if (operation === "start_build") {
				// The Outcome id is its Repository id. The Coordinator schedules the build and returns, so this step stays short.
				const coordinator = await getAgentByName(env.COORDINATOR, `build-${String(params.outcomeId)}`);
				await (coordinator as any).kickoff({ origin: env.ORIGIN, repositoryId: String(params.outcomeId), titles: HERO_TITLES, workers: 3, maxTasks: 2 });
				return { started: true };
			}
			if (operation === "signal_decision") {
				try {
					const instance = await env.CHANGE_WORKFLOW.get(`change-${String(params.changeId)}`);
					await instance.sendEvent({ type: "decision", payload: { choice: params.choice, decisionId: params.decisionId } });
					return { signaled: true };
				} catch (e) {
					// The decision is already recorded in Zebric. If no Workflow instance exists (it already finished, or was
					// never started for this change) there is nothing to wake; anything else is a real failure.
					if (!/not[_ ]found/i.test(String((e as Error)?.message ?? e))) throw e;
					console.warn("signal_decision: no ChangeWorkflow instance for", params.changeId);
					return { signaled: false, reason: "no_workflow_instance" };
				}
			}
			if (operation === "verify_live") {
				// After Launch: a Workflow waits for Workers Builds to deploy main, checks every page, and records the verdict.
				const id = String(params.outcomeId);
				await env.LIVE_WORKFLOW.create({ id: `live-${id}-${Date.now()}`, params: { outcomeId: id } });
				return { started: true };
			}
			throw new Error(`Unknown changeflow operation: ${operation}`);
		},
	};
}
