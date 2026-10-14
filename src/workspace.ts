// Artifacts provisioning: the base repo, and a disposable per-change fork with a scoped write token.
import { DEMO_FILES } from "./demo-files.generated.js";
import { resetToFiles, seedRepo } from "./git.js";

export const forkName = (changeId: string) => `chg-${changeId.toLowerCase()}`;

async function waitReady(env: Env, name: string, attempts = 30) {
	for (let i = 0; i < attempts; i++) {
		try {
			using repo = await env.ARTIFACTS.get(name);
			const info = (await repo.info()) as { status?: string };
			if (!info.status || info.status === "ready") return;
		} catch { /* a just-created repo can be briefly invisible; keep polling */ }
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error(`repo ${name} not ready`);
}

/**
 * The base repo Workers Builds deploys from: one persistent repository (env.BASE_REPO), because connecting an Artifacts repo
 * to a Worker is a one-time dashboard step. It is created on first use, and every later reset puts main back to the demo
 * app as a new commit.
 */
async function resetPersistentBaseRepo(env: Env, name: string): Promise<{ name: string; sha: string }> {
	let exists = true;
	try { using r = await env.ARTIFACTS.get(name); await r.info(); } catch { exists = false; }
	if (!exists) {
		const created = await env.ARTIFACTS.create(name, { setDefaultBranch: "main" });
		const sha = await seedRepo(created.remote, created.token, DEMO_FILES, "main");
		await waitReady(env, name);
		return { name, sha };
	}
	using repo = await env.ARTIFACTS.get(name);
	const [info, token] = await Promise.all([repo.info(), repo.createToken("write", 600)]);
	return { name, sha: await resetToFiles(info.remote, token.plaintext, DEMO_FILES) };
}

/** The demo app's base repo: the persistent one when env.BASE_REPO is set, otherwise a fresh uniquely named one per seed. */
export async function createBaseRepo(env: Env): Promise<{ name: string; sha: string }> {
	const persistent = (env as { BASE_REPO?: string }).BASE_REPO;
	if (persistent) return resetPersistentBaseRepo(env, persistent);
	const name = `swarm-demo-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
	const created = await env.ARTIFACTS.create(name, { setDefaultBranch: "main" });
	let sha = "";
	for (let i = 0; ; i++) {
		try { sha = await seedRepo(created.remote, created.token, DEMO_FILES, "main"); break; }
		catch (e) { if (i >= 5) throw e; await new Promise((r) => setTimeout(r, 1500)); } // the git remote can lag repo creation
	}
	await waitReady(env, name);
	return { name, sha };
}

/** Fork the base repo for one change (idempotent) and mint a write token for the fork only. */
export async function createWorkspace(env: Env, changeId: string, baseRepo: string): Promise<{ repo: string; remote: string; token: string; expiresAt: string; mainRemote: string; mainToken: string }> {
	const name = forkName(changeId);
	let exists = true;
	try { using r = await env.ARTIFACTS.get(name); await r.info(); } catch { exists = false; }
	if (!exists) {
		using base = await env.ARTIFACTS.get(baseRepo);
		await base.fork(name, { defaultBranchOnly: true });
	}
	await waitReady(env, name);
	using repo = await env.ARTIFACTS.get(name);
	const info = await repo.info();
	const token = await repo.createToken("write", 3600);
	// A read-only view of current main, so a revising agent can see what it must work with.
	using main = await env.ARTIFACTS.get(baseRepo);
	const [mainInfo, mainToken] = await Promise.all([main.info(), main.createToken("read", 3600)]);
	return { repo: name, remote: info.remote, token: token.plaintext, expiresAt: token.expiresAt, mainRemote: mainInfo.remote, mainToken: mainToken.plaintext };
}
