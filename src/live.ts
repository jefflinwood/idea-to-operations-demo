// The launched app is its own Worker, deployed by Workers Builds whenever main of the Artifacts repository changes.
// Launch only verifies what is live: does the Worker serve the commit on main, and does every page render?
export type Smoke = { path: string; status: number; ok: boolean };

const withSlash = (appUrl: string) => appUrl.replace(/\/$/, "") + "/";
const linksOf = (html: string) => [...new Set([...html.matchAll(/href="([\w][\w./?=&%-]*)"/g)].map((m) => m[1]).filter((h) => !/^(https?:|mailto:)/.test(h)))];

async function get(base: string, path: string): Promise<{ status: number; text: string }> {
	const res = await fetch(`${base}${path}`, { headers: { "cache-control": "no-cache" } });
	return { status: res.status, text: await res.text() };
}

/** The commit the live Worker reports from /status, or null if it cannot be reached. */
export async function liveCommit(appUrl: string): Promise<string | null> {
	try { return (JSON.parse((await get(withSlash(appUrl), "status")).text) as { commit?: string }).commit ?? null; } catch { return null; }
}

/** Requests the home page and every page it links to. */
export async function smokeTest(appUrl: string): Promise<Smoke[]> {
	const base = withSlash(appUrl);
	const smoke: Smoke[] = [];
	try {
		const home = await get(base, "");
		smoke.push({ path: "/", status: home.status, ok: home.status === 200 });
		for (const link of linksOf(home.text)) {
			try { const r = await get(base, link); smoke.push({ path: `/${link}`, status: r.status, ok: r.status === 200 }); }
			catch { smoke.push({ path: `/${link}`, status: 0, ok: false }); }
		}
	} catch { smoke.push({ path: "/", status: 0, ok: false }); }
	return smoke;
}
