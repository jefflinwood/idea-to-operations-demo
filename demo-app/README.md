# vendor-access

The internal vendor-access service the Vendor Access Expiration Outcome builds on. It is a small web app: every feature is a
page. Routes are registered in `src/index.ts`; each feature lives in its own file under `src/` and builds its page with
`page(title, body)` from `src/layout.ts`. Vendor data comes from `VendorService` in `src/vendor-service.ts`.
Workers Builds deploys it: every push to `main` runs `npx wrangler deploy` (see `wrangler.toml`), with the build command
`echo "export const COMMIT = '$WORKERS_CI_COMMIT_SHA';" > src/version.ts` so each page footer shows its commit.
`npx tsc -p .` must pass, and every page must render without any query string.
