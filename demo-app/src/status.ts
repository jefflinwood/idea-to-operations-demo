import { COMMIT } from "./version.js";

export function status(_request: Request): Response {
	return Response.json({ service: "vendor-access", state: "running", commit: COMMIT });
}
