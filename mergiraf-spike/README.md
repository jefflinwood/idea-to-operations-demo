# Mergiraf merge worker

This self-contained Worker runs a pool of Cloudflare Containers with Mergiraf 0.20.0 and TypeScript. The demo calls it through the `MERGERAF` service binding. It comes from the original `phase1` spike and includes its five merge fixtures.

From the repository root:

```sh
pnpm --dir mergiraf-spike install --frozen-lockfile
pnpm setup
pnpm dev:merge
```

Docker must be running. Local service URL: `http://localhost:18802`. `pnpm setup` writes `mergiraf-spike/.dev.vars` with the same `SPIKE_KEY` used by the main Worker. Skip setup if you already ran it.

Deploy before the main Worker:

```sh
pnpm deploy:merge
node --env-file=.prod.vars -e 'process.stdout.write(process.env.SPIKE_KEY)' | pnpm --dir mergiraf-spike exec wrangler secret put SPIKE_KEY
```

To run the fixture checks against the local Worker:

```sh
node --env-file=.dev.vars --input-type=module -e 'process.env.BASE_URL="http://localhost:18802"; process.env.AUTH_TOKEN=process.env.SPIKE_KEY; await import("./mergiraf-spike/scripts/run.ts")'
```

Routes: `GET /health`, `POST /merge` (`base`, `ours`, `theirs`, optional `path`), and `POST /typecheck` (`files`, a path-to-source map). Requests require `Authorization: Bearer <SPIKE_KEY>` when that secret is set. Keep it set on a public deployment.

To test only the container, bypassing Wrangler:

```sh
docker build --platform linux/amd64 -t demo-mergiraf mergiraf-spike/container
docker run --rm -p 127.0.0.1:8080:8080 demo-mergiraf
# In another terminal:
pnpm --dir mergiraf-spike spike
```

The raw container has no authentication. Its Dockerfile targets Linux amd64, including on Apple Silicon. `SPIKE_FINDINGS.md` records historical results, not deployment instructions.
