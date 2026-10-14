import { COMMIT } from "./version.js";

// Shared page chrome. Every page is built with page(title, body). No external resources: the app runs with no network.
// Classes available in `body`:
//   <h1>, <h2>, <p class="muted">, <div class="card">, <div class="cards"> (a responsive grid of cards)
//   <table> with <thead>/<tbody>, <span class="badge ok|warn|bad|info">text</span>, <a class="button" href="...">text</a>
// Anything that is not a normal page (a missing vendor, a bad request) must still be a page: use notFound(what) or page(title, body, status).
// Links inside a page must be relative (href="expiring?days=14"), never start with "/": the app is served under a path prefix.

export const esc = (value: unknown): string =>
	String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const CSS = `
:root{--bg:#f6f7f9;--panel:#fff;--ink:#16181d;--muted:#656d7a;--line:#e3e6eb;--brand:#f6821f;--ok:#177a3c;--ok-bg:#e3f4e9;--warn:#9a5b00;--warn-bg:#fdf0d5;--bad:#b3261e;--bad-bg:#fce8e6;--info:#1f5fbf;--info-bg:#e5eefb}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header.top{background:var(--panel);border-bottom:1px solid var(--line)}header.top div{max-width:960px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:10px}
header.top a{color:var(--ink);text-decoration:none;font-weight:700;font-size:18px}header.top i{width:12px;height:12px;border-radius:50%;background:var(--brand);display:inline-block}
main{max-width:960px;margin:0 auto;padding:28px 20px 60px}h1{font-size:28px;margin:0 0 6px}h2{font-size:18px;margin:28px 0 10px}
.muted{color:var(--muted)}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin:16px 0}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:11px 16px;border-bottom:1px solid var(--line)}th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:#fafbfc}tr:last-child td{border-bottom:0}
.badge{display:inline-block;font-size:12.5px;font-weight:600;padding:2px 10px;border-radius:99px}.badge.ok{color:var(--ok);background:var(--ok-bg)}.badge.warn{color:var(--warn);background:var(--warn-bg)}.badge.bad{color:var(--bad);background:var(--bad-bg)}.badge.info{color:var(--info);background:var(--info-bg)}
a{color:var(--info)}.foot{max-width:960px;margin:0 auto;padding:0 20px 40px;color:var(--muted);font-size:13px}a.card{text-decoration:none;color:var(--ink)}a.card:hover{border-color:#c9ced6}a.button{display:inline-block;background:var(--ink);color:#fff;text-decoration:none;padding:8px 16px;border-radius:8px;font-weight:600;font-size:15px}
`;

export function page(title: string, body: string, status = 200): Response {
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Vendor Access</title><style>${CSS}</style></head>` +
		`<body><header class="top"><div><i></i><a href="./">Vendor Access</a></div></header><main>${body}</main><footer class="foot">Deployed from commit ${esc(COMMIT.slice(0, 7))}</footer></body></html>`;
	return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** A friendly "not found" page (HTTP 404) that names what was missing and links home. */
export function notFound(what: string): Response {
	return page("Not found", `<h1>Not found</h1><div class="card"><p>${esc(what)}</p><p class="muted">Check the address, or start from the home page.</p><a class="button" href="./">Back to Vendor Access</a></div>`, 404);
}
