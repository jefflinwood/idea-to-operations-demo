// Scratch Worker: forwards a Clef request to Workers AI and reports latency. Run with `wrangler dev --remote`.
export default {
	async fetch(request: Request, env: { AI: any }): Promise<Response> {
		const { model, state, questions } = (await request.json()) as any;
		const t0 = Date.now();
		try {
			const out = await env.AI.run(`@cf/cloudflare/${model}`, { model, state, questions });
			return Response.json({ ms: Date.now() - t0, out });
		} catch (e) {
			return Response.json({ ms: Date.now() - t0, error: String((e as Error)?.message ?? e) }, { status: 500 });
		}
	},
};
