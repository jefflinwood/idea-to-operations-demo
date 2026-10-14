// Ordinary Git inside a Worker: isomorphic-git over Artifacts' smart-HTTP remote with Bearer auth and an in-memory fs.
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { Volume, createFsFromVolume } from "memfs";

const AUTHOR = { name: "Swarm Agent", email: "agent@swarm.invalid" };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const DIR = "/repo";

export interface Checkout {
	fs: ReturnType<typeof createFsFromVolume>;
	branch: string;
	files: Record<string, string>;
}

/** Shallow single-branch clone; returns the working tree's text files. */
export async function clone(remote: string, token: string): Promise<Checkout> {
	const fs = createFsFromVolume(new Volume());
	await git.clone({ fs, http, dir: DIR, url: remote, headers: auth(token), singleBranch: true, depth: 1 });
	const branch = (await git.currentBranch({ fs, dir: DIR })) ?? "main";
	const files: Record<string, string> = {};
	for (const path of await git.listFiles({ fs, dir: DIR })) files[path] = fs.readFileSync(`${DIR}/${path}`, "utf8") as string;
	return { fs, branch, files };
}

/** Write files, commit and push. Returns the new head SHA. */
export async function commitAndPush(co: Checkout, remote: string, token: string, edits: Record<string, string>, message: string): Promise<string> {
	for (const [path, content] of Object.entries(edits)) {
		const full = `${DIR}/${path}`;
		co.fs.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
		co.fs.writeFileSync(full, content);
		await git.add({ fs: co.fs, dir: DIR, filepath: path });
	}
	const sha = await git.commit({ fs: co.fs, dir: DIR, message, author: AUTHOR, committer: AUTHOR });
	await git.push({ fs: co.fs, http, dir: DIR, remote: "origin", ref: co.branch, headers: auth(token) });
	return sha;
}

/** Initial commit for a brand-new repo (used to seed the base repo). */
export async function seedRepo(remote: string, token: string, files: Record<string, string>, branch = "main"): Promise<string> {
	const fs = createFsFromVolume(new Volume());
	await git.init({ fs, dir: DIR, defaultBranch: branch });
	await git.addRemote({ fs, dir: DIR, remote: "origin", url: remote });
	for (const [path, content] of Object.entries(files)) {
		const full = `${DIR}/${path}`;
		fs.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
		fs.writeFileSync(full, content);
		await git.add({ fs, dir: DIR, filepath: path });
	}
	const sha = await git.commit({ fs, dir: DIR, message: "Initial demo app", author: AUTHOR, committer: AUTHOR });
	await git.push({ fs, http, dir: DIR, remote: "origin", ref: branch, headers: auth(token) });
	return sha;
}

/**
 * Puts an existing repository's main back to exactly `files`, as a new commit on top of its history (a fast-forward, so no
 * force push). Used to reset the persistent demo repository that Workers Builds deploys from.
 */
export async function resetToFiles(remote: string, token: string, files: Record<string, string>): Promise<string> {
	const co = await clone(remote, token);
	for (const path of Object.keys(co.files)) {
		if (path in files) continue;
		await git.remove({ fs: co.fs, dir: DIR, filepath: path });
		co.fs.unlinkSync(`${DIR}/${path}`);
	}
	return commitAndPush(co, remote, token, files, "Reset demo app");
}
