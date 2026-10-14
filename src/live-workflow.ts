// After Launch: push one final commit to main, wait for Workers Builds to deploy it, then check that every page of the live
// Worker renders, and record the verdict in Zebric. Builds triggered by earlier pushes run concurrently and can finish out of
// order (an older commit deploying last), so only a commit pushed after everything has landed is guaranteed to be the last deploy. A Workflow (not the Launch step) because this waits minutes and calls the Worker's own API.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { clone, commitAndPush } from "./git.js";
import { liveCommit, smokeTest } from "./live.js";
import { command, getEntity } from "./zebric.js";

export interface LiveParams { outcomeId: string }

const RETRY = { retries: { limit: 3, delay: "3 seconds", backoff: "exponential" } } as const;
const POLLS = 36; // x 10 s: Workers Builds queues builds, so the last push can take minutes to go live

export class LiveWorkflow extends WorkflowEntrypoint<Env, LiveParams> {
	async run(event: WorkflowEvent<LiveParams>, step: WorkflowStep) {
		const { outcomeId } = event.payload;
		const env = this.env as Env & { APP_URL: string };
		const title = await step.do("title", RETRY, async () => String((await getEntity(env, "outcomes", outcomeId)).title));
		const sha = await step.do("launch-commit", RETRY, async () => {
			const repoName = String((await getEntity(env, "repositorys", outcomeId)).artifactsRepo);
			using repo = await env.ARTIFACTS.get(repoName);
			const [info, token] = await Promise.all([repo.info(), repo.createToken("write", 600)]);
			const co = await clone(info.remote, token.plaintext);
			return commitAndPush(co, info.remote, token.plaintext, {}, `Launch ${title}`);
		});

		let liveSha: string | null = null;
		for (let i = 0; i < POLLS; i++) {
			liveSha = await step.do(`probe-${i}`, RETRY, () => liveCommit(env.APP_URL));
			if (liveSha === sha) break;
			if (i < POLLS - 1) await step.sleep(`wait-${i}`, "10 seconds");
		}

		const smoke = await step.do("smoke", RETRY, () => smokeTest(env.APP_URL));
		const live = liveSha === sha && smoke.length > 0 && smoke.every((s) => s.ok);
		await step.do("record", RETRY, async () => {
			await command(env, "record_deployment", outcomeId, { detail: JSON.stringify({ outcome: outcomeId, sha, liveSha, live, smoke, url: env.APP_URL }) });
		});
		return { live, sha, liveSha };
	}
}
