// Asks Clef whether a task requesting a symbol lease conflicts with the task already holding one.
// Each case runs N times per model; prints mean [min-max] so variance is visible.
//   cd scripts/spike/clef-probe && npx wrangler dev --remote --port 18801   then   node scripts/spike/clef-probe/probe.mjs [url]
const URL_ = process.argv[2] ?? "http://localhost:18801";
const N = Number(process.env.RUNS ?? 5);
const readFile = (await import("node:fs")).readFileSync;
const app = (f) => readFile(new URL(`../../../demo-app/src/${f}`, import.meta.url), "utf8");

// What an agent would attach per symbol: the current source of its file (or "new file").
const SRC = { "src/vendor-service.ts": app("vendor-service.ts"), "src/index.ts": app("index.ts") };
const src = (sym) => SRC[sym.split("::")[0]] ?? "(new file, does not exist yet)";
const task = (title, symbols, plan) => ({ title, plan, symbols, current_source: Object.fromEntries([...new Set(symbols.map((s) => s.split("::")[0]))].map((f) => [f, src(f + "::")])) });

const A = task("Make getVendor return undefined for unknown vendors", ["src/vendor-service.ts::VendorService.getVendor"], "Change return type to Vendor | undefined; return undefined instead of throwing.");
const B = task("Add vendor expiration notice endpoint", ["src/expiration.ts::expiration"], "New file calling new VendorService().getVendor(id) and reading vendor.name, vendor.sponsor, vendor.expiresAt without null checks. Registers route in src/index.ts.");
const RENEW = task("Add sponsor renewal endpoint", ["src/renewals.ts::renewals"], "New file with hard-coded renewals list; registers route in src/index.ts.");
const AUDIT = task("Add access audit log endpoint", ["src/audit.ts::audit", "src/audit.ts::recordAccessEvent"], "New file with in-memory event array; registers route in src/index.ts.");
const POLICY = task("Add expiration policy endpoint", ["src/policy.ts::policy"], "New file returning static policy JSON; registers route in src/index.ts.");
const LIST = task("Add listVendors method", ["src/vendor-service.ts::VendorService.listVendors"], "Add listVendors() to VendorService that maps ids through this.getVendor(id) and returns Vendor[].");
const ROUTE_A = task("Add audit route", ["src/index.ts::routes"], "Add '/audit' entry to the routes object.");
const ROUTE_B = task("Add policy route", ["src/index.ts::routes"], "Add '/policy' entry to the routes object.");
const RENAME = task("Rename Vendor.sponsor to Vendor.owner", ["src/vendor-service.ts::Vendor"], "Rename the sponsor field to owner on the Vendor interface and in the seed data.");
const REMOVE = task("Remove Vendor.expiresAt", ["src/vendor-service.ts::Vendor"], "Delete the expiresAt field from the Vendor interface and seed data; expiry moves to a separate service.");
const ROUTE_RESHAPE = task("Change Handler to take (request, env)", ["src/index.ts::Handler"], "Change the Handler type to (request: Request, env: Env) => Response | Promise<Response> and pass env from fetch.");

const cases = [
	["hero: contract change vs consumer", "HIGH", A, B],
	["new method calls the changed method", "HIGH", A, LIST],
	["interface rename vs consumer", "HIGH", RENAME, B],
	["field removal vs consumer", "HIGH", REMOVE, B],
	["Handler type change vs new route handler", "HIGH", ROUTE_RESHAPE, AUDIT],
	["contract change vs renewals", "LOW", A, RENEW],
	["audit vs policy", "LOW", AUDIT, POLICY],
	["both add a route entry (additive)", "LOW", ROUTE_A, ROUTE_B],
];

const questions = {
	conflict: { type: "noul", instructions: "Could the requesting task's change break, or be broken by, the holder's change once both are merged? Consider callers, consumers, types and contracts, not just identical symbols. Two changes that merely add independent entries to the same list or object do not break each other." },
	severity: { type: "score", instructions: "How severe is the interaction between the two changes?", criteria: ["None: independent", "Low: they touch the same text but are additive or independent, and merge cleanly in meaning", "High: one change relies on code, types or behavior that the other changes or removes"] },
	action: { type: "choice", instructions: "What should the requesting agent do?", criteria: { proceed: "Safe to edit now, independent of the holder", wait: "Wait until the holder's change has landed, then build on it", ask_human: "The two changes assume incompatible behavior; a person should decide" } },
};

const stat = (xs) => `${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)} [${Math.min(...xs).toFixed(2)}-${Math.max(...xs).toFixed(2)}]`;
const ask = (model, holder, req) => fetch(URL_, { method: "POST", body: JSON.stringify({ model, state: { lease_held_by: holder, lease_requested_by: req }, questions }) }).then((x) => x.json());

for (const model of ["clef-flash", "clef"]) {
	console.log(`\n=== ${model} (${N} runs each) ===`);
	console.log("case".padEnd(44), "want".padEnd(5), "conflict".padEnd(18), "P(sev=high)".padEnd(18), "action (proceed/wait/ask)  ms");
	for (const [name, want, holder, req] of cases) {
		const rs = [];
		for (let i = 0; i < N; i++) rs.push(await ask(model, holder, req));
		const ok = rs.filter((r) => r.out?.answers);
		if (!ok.length) { console.log(name.padEnd(44), "ERROR", rs[0].error); continue; }
		const a = ok.map((r) => r.out.answers);
		const act = ["proceed", "wait", "ask_human"].map((k) => a.filter((x) => x.action.choice === k).length).join("/");
		console.log(name.padEnd(44), want.padEnd(5), stat(a.map((x) => x.conflict.noul)).padEnd(18), stat(a.map((x) => x.severity.probabilities["2"])).padEnd(18), act.padEnd(10), Math.round(ok.reduce((s, r) => s + r.ms, 0) / ok.length));
	}
}
