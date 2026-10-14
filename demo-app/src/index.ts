import { health } from "./health.js";
import { home } from "./home.js";
import { notFound } from "./layout.js";
import { status } from "./status.js";

type Handler = (request: Request) => Response | Promise<Response>;

// Every feature registers its route here.
const routes: Record<string, Handler> = {
	"/health": health,
	"/status": status,
};

export default {
	async fetch(request: Request): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (path === "/") return home(Object.keys(routes));
		const handler = routes[path];
		return handler ? handler(request) : notFound("There is no page at this address.");
	},
};
