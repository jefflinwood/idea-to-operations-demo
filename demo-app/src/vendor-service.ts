export interface Vendor {
	id: string;
	name: string;
	sponsor: string;
	expiresAt: string;
}

/** "Today" for this service. Fixed so the pages read the same every time they are opened. */
export const REFERENCE_DATE = "2026-11-01";

const VENDORS: Vendor[] = [
	{ id: "1", name: "Northwind Contractors", sponsor: "dana.reyes@zebric.example", expiresAt: "2026-12-31" },
	{ id: "2", name: "Fabrikam Analytics", sponsor: "li.chen@zebric.example", expiresAt: "2026-11-15" },
	{ id: "3", name: "Tailspin Security", sponsor: "dana.reyes@zebric.example", expiresAt: "2026-11-09" },
	{ id: "4", name: "Wingtip Facilities", sponsor: "omar.haddad@zebric.example", expiresAt: "2026-10-28" },
	{ id: "5", name: "Adatum Cloud Services", sponsor: "li.chen@zebric.example", expiresAt: "2027-02-15" },
];

export class VendorService {
	getVendor(id: string): Vendor {
		const vendor = VENDORS.find((v) => v.id === id);
		if (!vendor) throw new Error(`vendor ${id} not found`);
		return vendor;
	}

	listVendors(): Vendor[] {
		return VENDORS.map((v) => ({ ...v }));
	}
}
