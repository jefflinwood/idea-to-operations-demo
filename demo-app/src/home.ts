import { esc, page } from "./layout.js";
import { VendorService } from "./vendor-service.js";

const label = (path: string) => path.replace(/^\//, "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/** The landing page: every registered feature, plus the vendor directory. */
export function home(paths: string[]): Response {
	const features = paths.filter((p) => p !== "/health" && p !== "/status");
	const cards = features.map((p) => `<a class="card" href="${esc(p.slice(1))}"><b>${esc(label(p))}</b></a>`).join("");
	const rows = new VendorService().listVendors()
		.map((v) => `<tr><td>${esc(v.name)}</td><td>${esc(v.sponsor)}</td><td>${paths.includes("/expiration") ? `<a href="expiration?id=${esc(v.id)}">Expiry notice</a>` : ""}</td></tr>`)
		.join("");
	return page("Home", `<h1>Vendor Access</h1><p class="muted">Temporary vendor accounts, their sponsors and when access ends.</p>` +
		(cards ? `<h2>Features</h2><div class="cards">${cards}</div>` : `<p class="muted">No features have been added yet.</p>`) +
		`<h2>Vendors</h2><table><thead><tr><th>Vendor</th><th>Sponsor</th><th></th></tr></thead><tbody>${rows}</tbody></table>`);
}
