export function health(_request: Request): Response {
	return Response.json({ ok: true });
}
