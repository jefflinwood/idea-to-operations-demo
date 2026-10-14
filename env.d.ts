declare module "*.toml" { const content: string; export default content }

declare module "*.html" { const content: string; export default content }

// Secrets (set with `wrangler secret put` or .dev.vars) are not in wrangler.toml, so `wrangler types` cannot see them.
interface Env {
	SPIKE_KEY: string;
	INTEGRATOR_API_KEY: string;
	SEED_API_KEY: string;
	HUMAN_API_KEY: string;
	UI_KEY: string;
	BETTER_AUTH_SECRET: string;
}

declare module "*.liquid" { const content: string; export default content }
declare module "*.css" { const content: string; export default content }
