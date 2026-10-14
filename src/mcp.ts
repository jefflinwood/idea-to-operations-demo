// MCP transport, discovery, redirect handling and tool generation come from Zebric core.
// Calls reach Zebric in-process under each caller's bearer token.
import { createZebricMcpHttpHandler } from "@zebric/mcp-server/http";

type ZebricFetch = (request: Request) => Promise<Response>;
const ALLOWED_MUTATIONS = ["claim_task", "start_change", "acquire_symbol_lease", "release_symbol_lease", "record_lease_risk", "record_agent_run", "submit_change", "submit_task"];

// Retain one handler/discovery cache, while binding upstream execution to each invocation.
const upstreamByRequest = new WeakMap<Request, ZebricFetch>();
let cached: { origin: string; handler: ReturnType<typeof createZebricMcpHttpHandler> } | undefined;

function bearer(request: Request): string | undefined {
	return request.headers.get("authorization")?.match(/^Bearer[ \t]+(\S+)[ \t]*$/i)?.[1];
}

export function handleMcp(request: Request, zebric: ZebricFetch): Promise<Response> {
	const origin = new URL(request.url).origin;
	if (cached?.origin !== origin) {
		cached = {
			origin,
			handler: createZebricMcpHttpHandler({
				applicationUrl: origin,
				fetch: (input, init, caller) => {
					const upstream = upstreamByRequest.get(caller);
					if (!upstream) throw new Error("Missing MCP invocation context");
					return upstream(new Request(input instanceof URL ? input.href : input, init));
				},
				credential: bearer,
				authorize: caller => Boolean(bearer(caller)),
				allowedHosts: [new URL(origin).host],
				allowedMutations: ALLOWED_MUTATIONS,
			}),
		};
	}
	upstreamByRequest.set(request, zebric);
	return cached.handler(request).finally(() => upstreamByRequest.delete(request));
}
