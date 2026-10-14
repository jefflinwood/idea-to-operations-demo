// Integration of one change into CURRENT main (not the change's base SHA).
//   1. clone main, fetch the change's fork, find the real merge base with git
//   2. per file: take whichever side changed; if both changed, ask Mergiraf (container) for a structural merge
//   3. typecheck the merged tree in the container
//   4. commit and push to main; Git rejects the push if main moved, which is the only serialization we need
import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { Volume, createFsFromVolume } from "memfs";
import { forkName } from "./workspace.js";

const DIR = "/repo";
const AUTHOR = { name: "Swarm Integrator", email: "integrator@swarm.invalid" };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const dec = new TextDecoder();

export interface MergeResult {
	mainSha: string;
	baseSha: string;
	headSha: string;
	/** Complete merged source tree (paths -> text). */
	tree: Record<string, string>;
	/** Paths whose merged content differs from main. null = deleted. */
	changed: Record<string, string | null>;
	mergedByMergiraf: string[];
	conflicts: Array<{ path: string; hunks: number; preview: string }>;
	fastForward: boolean;
	/** Changes that landed on main after this change's base: the likely cause of a conflict. */
	landed: Array<{ changeId: string; sha: string; subject: string }>;
}

async function mergiraf(env: Env, path: string, base: string, ours: string, theirs: string) {
	const res = await env.MERGERAF.fetch("https://mergiraf/merge", {
		method: "POST",
		headers: { authorization: `Bearer ${env.SPIKE_KEY}`, "content-type": "application/json" },
		body: JSON.stringify({ base, ours, theirs, path }),
	});
	if (!res.ok) throw new Error(`mergiraf ${res.status}: ${(await res.text()).slice(0, 200)}`);
	return (await res.json()) as { status: "merged" | "conflict" | "error"; result: string; conflicts: Array<{ ours: string; theirs: string }>; stderr?: string };
}

async function readAt(fs: any, oid: string, path: string): Promise<string | null> {
	try { return dec.decode((await git.readBlob({ fs, dir: DIR, oid, filepath: path })).blob); } catch { return null; }
}

export async function mergeChangeIntoMain(env: Env, baseRepo: string, changeId: string, headSha: string): Promise<MergeResult> {
	const fs = createFsFromVolume(new Volume());
	using base = await env.ARTIFACTS.get(baseRepo);
	using fork = await env.ARTIFACTS.get(forkName(changeId));
	const [baseInfo, forkInfo, baseTok, forkTok] = await Promise.all([base.info(), fork.info(), base.createToken("read", 600), fork.createToken("read", 600)]);

	await git.clone({ fs, http, dir: DIR, url: baseInfo.remote, headers: auth(baseTok.plaintext), singleBranch: true, noCheckout: true });
	const branch = (await git.currentBranch({ fs, dir: DIR })) ?? "main";
	const mainSha = await git.resolveRef({ fs, dir: DIR, ref: `refs/remotes/origin/${branch}` });

	await git.addRemote({ fs, dir: DIR, remote: "fork", url: forkInfo.remote });
	await git.fetch({ fs, http, dir: DIR, remote: "fork", singleBranch: true, tags: false, headers: auth(forkTok.plaintext) });
	// The recorded head is what the agent submitted; later pushes to the fork are not part of this change.
	const [baseSha] = await git.findMergeBase({ fs, dir: DIR, oids: [mainSha, headSha] });
	if (!baseSha) throw new Error("no common ancestor between main and the change");

	const listAt = async (oid: string) => new Set(await git.listFiles({ fs, dir: DIR, ref: oid }));
	const [bFiles, mFiles, cFiles] = await Promise.all([listAt(baseSha), listAt(mainSha), listAt(headSha)]);
	const paths = [...new Set([...bFiles, ...mFiles, ...cFiles])].sort();

	const tree: Record<string, string> = {};
	const changed: Record<string, string | null> = {};
	const mergedByMergiraf: string[] = [];
	const conflicts: MergeResult["conflicts"] = [];

	for (const path of paths) {
		const [b, m, c] = await Promise.all([readAt(fs, baseSha, path), readAt(fs, mainSha, path), readAt(fs, headSha, path)]);
		let out: string | null;
		if (c === m) out = m;                 // same on both sides (or untouched by the change)
		else if (b === m) out = c;            // only the change touched it
		else if (b === c) out = m;            // only main moved
		else if (m === null || c === null) {  // one side deleted what the other edited
			conflicts.push({ path, hunks: 1, preview: m === null ? "deleted on main, edited by the change" : "deleted by the change, edited on main" });
			out = m;
		} else {
			const r = await mergiraf(env, path, b ?? "", m, c);
			if (r.status === "merged") { out = r.result; mergedByMergiraf.push(path); }
			else {
				conflicts.push({ path, hunks: r.conflicts?.length ?? 1, preview: (r.result || r.stderr || "").slice(0, 600) });
				out = m;
			}
		}
		if (out !== null) tree[path] = out;
		if (out !== m) changed[path] = out;
	}
	const landed: MergeResult["landed"] = [];
	if (baseSha !== mainSha) {
		for (const c of await git.log({ fs, dir: DIR, ref: mainSha, depth: 50 })) {
			if (c.oid === baseSha) break;
			const id = c.commit.message.match(/Integrated change (\w{26})/)?.[1];
			if (id) landed.push({ changeId: id, sha: c.oid, subject: c.commit.message.split("\n")[0] });
		}
	}
	return { mainSha, baseSha, headSha, tree, changed, mergedByMergiraf, conflicts, fastForward: baseSha === mainSha, landed };
}

export async function typecheck(env: Env, tree: Record<string, string>) {
	const files = Object.fromEntries(Object.entries(tree).filter(([p]) => p.endsWith(".ts")));
	const res = await env.MERGERAF.fetch("https://mergiraf/typecheck", {
		method: "POST",
		headers: { authorization: `Bearer ${env.SPIKE_KEY}`, "content-type": "application/json" },
		body: JSON.stringify({ files }),
	});
	if (!res.ok) throw new Error(`typecheck ${res.status}: ${(await res.text()).slice(0, 200)}`);
	return (await res.json()) as { status: "passed" | "failed"; diagnostics: string[]; tscMs: number };
}

export type PushOutcome = { kind: "integrated"; sha: string } | { kind: "moved"; mainNow: string };

/** Commits the merged result on top of the main it was merged against and pushes. Git rejects the push if main has moved. */
export async function pushToMain(env: Env, baseRepo: string, m: MergeResult, message: string): Promise<PushOutcome> {
	const fs = createFsFromVolume(new Volume());
	using base = await env.ARTIFACTS.get(baseRepo);
	const [info, tok] = await Promise.all([base.info(), base.createToken("write", 600)]);
	await git.clone({ fs, http, dir: DIR, url: info.remote, headers: auth(tok.plaintext), singleBranch: true, depth: 1 });
	const branch = (await git.currentBranch({ fs, dir: DIR })) ?? "main";
	const now = await git.resolveRef({ fs, dir: DIR, ref: branch });
	if (now !== m.mainSha) return { kind: "moved", mainNow: now };

	for (const [path, content] of Object.entries(m.changed)) {
		const full = `${DIR}/${path}`;
		if (content === null) { await git.remove({ fs, dir: DIR, filepath: path }); continue; }
		fs.mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
		fs.writeFileSync(full, content);
		await git.add({ fs, dir: DIR, filepath: path });
	}
	const sha = await git.commit({ fs, dir: DIR, message, author: AUTHOR, committer: AUTHOR });
	try {
		await git.push({ fs, http, dir: DIR, remote: "origin", ref: branch, headers: auth(tok.plaintext) });
	} catch (e) {
		// A rejected push means someone else advanced main between our read and our write.
		const latest = await git.fetch({ fs, http, dir: DIR, remote: "origin", ref: branch, singleBranch: true, depth: 1, headers: auth(tok.plaintext) }).catch(() => undefined);
		const mainNow = latest?.fetchHead ?? "unknown";
		if (mainNow !== m.mainSha) return { kind: "moved", mainNow };
		throw e;
	}
	return { kind: "integrated", sha };
}
