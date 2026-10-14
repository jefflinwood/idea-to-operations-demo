// Calls into Zebric as the integrator. Every state change goes through a command; retry only what Zebric marks retryable.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function zebric(env: Env, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${env.ORIGIN}${path}`, {
			method, body: body === undefined ? undefined : JSON.stringify(body),
			headers: { authorization: `Bearer ${env.INTEGRATOR_API_KEY}`, "content-type": "application/json", "x-agent-run-id": "integration-workflow", "idempotency-key": crypto.randomUUID() },
		});
		const text = await res.text();
		let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
		if (res.status >= 409 && json?.error?.retryable && attempt < 14) { await sleep(40 * 2 ** Math.min(attempt, 6) * (0.5 + Math.random())); continue; }
		return { status: res.status, json };
	}
}

/** Runs a command; throws on failure so a Workflow step can retry or surface it. */
export async function command(env: Env, name: string, id: string, input: object = {}) {
	const r = await zebric(env, "POST", `/api/commands/${name}/${id}`, input);
	if (r.status !== 200) throw new Error(`${name} ${id}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
	return r.json;
}

export const getEntity = async (env: Env, entity: string, id: string) => (await zebric(env, "GET", `/api/${entity}/${id}`)).json;
