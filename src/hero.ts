// The hero scenario: two changes that are each correct, pass Git and Mergiraf together, and fail only in TypeScript.
// A changes a contract; B (written against the old contract) consumes it. Leases do not collide: different symbols.
// When A lands, B breaks against the new main, so the human faces exactly one decision.
// What a person sees once it launches: /expiration?id=<unknown> is a friendly page instead of an error.
export const HERO_A = "Make getVendor return undefined for unknown vendors";
export const HERO_B = "Add vendor expiration notice page";
/** In build order: the first changes the contract and lands first; every other title is held until it has landed. */
export const HERO_TITLES = [HERO_A, HERO_B];

export const HERO_TASKS = [
	{
		title: HERO_A,
		description: `Change VendorService.getVendor in src/vendor-service.ts so that its return type is Vendor | undefined and it returns undefined for an unknown id instead of throwing. Change nothing else.\nSymbols: src/vendor-service.ts::VendorService.getVendor\nRequires: Vendor | undefined`,
	},
	{
		title: HERO_B,
		description: `Add a page GET /expiration?id=<id> in a new file src/expiration.ts exporting function expiration(request). Look the vendor up with new VendorService().getVendor(id) from src/vendor-service.ts and render a notice card (page(...) from src/layout.ts) showing the vendor's name, sponsor, the expiry date, and how many days remain until then counted from REFERENCE_DATE, with a "warn" badge when 14 days or fewer remain and a "bad" badge when the date has passed. getVendor always returns a Vendor (it throws for an unknown id), so do not add null checks or try/catch. Read the fields exactly as vendor.name, vendor.sponsor and vendor.expiresAt. When there is no id in the query, instead show a list of the vendors (new VendorService().listVendors()) each linking to expiration?id=<id>. Register the route in src/index.ts.\nSymbols: src/expiration.ts::expiration\nRequires: vendor.name;; page(`,
	},
];
