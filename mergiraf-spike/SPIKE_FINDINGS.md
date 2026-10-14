# Phase 1: Mergiraf in a Cloudflare Container

Started 2026-10-06. Mergiraf 0.20.0 (linux x86_64 gnu build), Node 22 image, TypeScript 5, Wrangler 4.147.

## Layout

- `container/`: `Dockerfile` (node:22-slim, linux/amd64, Mergiraf release binary from Codeberg, `typescript`) and `server.mjs` (dependency-free HTTP service: `POST /merge`, `POST /typecheck`, `GET /health`).
- `src/index.ts`: Worker with a `Container` subclass; optional bearer auth via the `SPIKE_KEY` secret.
- `fixtures/{A,B,B2,C,D}`: `base.ts`, `ours.ts`, `theirs.ts`.
- `scripts/run.ts`: runs every fixture against `BASE_URL`; `RUNS=n` repeats; `VERBOSE=1` prints merge output.

## Results (local: container image, and `wrangler dev` Worker -> Container)

| Test | Scenario | Mergiraf | tsc | Verdict |
|------|----------|----------|-----|---------|
| A | alpha edited in one branch, beta in the other | merged | passed | as expected |
| B | both add an import and append a new function at the same spot | **conflict** (imports combined, the two appended functions conflict) | n/a | differs from spec's expectation, see below |
| B2 | both add an import; new functions inserted at different spots | merged (imports combined) | passed | as expected |
| C | both change `alpha()` incompatibly | conflict, 1 hunk, returned with base/ours/theirs parts | n/a | as expected |
| D | A makes `getUser(): User \| undefined`, B adds `getUser().name` consumer | merged | **failed** (`TS2532 Object is possibly 'undefined'`) | the hero result |

5 consecutive local container runs and 3 runs through `wrangler dev` were all as expected. Container warm requests take ~0.1s for merge and ~1.3-3s for `tsc`.

## Findings

1. **Imports combine, but two new top-level declarations inserted at the same position conflict.** Mergiraf cannot order two independently appended functions (test B), so this is a textual-style conflict even though the symbols are disjoint. If both are added at different positions (B2) it merges. For Phases 3-5, agent instructions should say "add new symbols next to related code, not at end of file", or the Workflow should treat this conflict class as retryable (re-run the later change against the new main).
2. **Semantic conflict D is caught by `tsc` only**, exactly as the video needs: leases (different symbols), Git and Mergiraf all pass.
3. Mergiraf's exit code is 0 for merged and 1 for conflict. Conflict markers use diff3 style, which `server.mjs` parses into `conflicts[]`.
4. Container image must be `linux/amd64` for Cloudflare. Building it on Apple Silicon works under emulation.
5. Mergiraf is hosted on Codeberg, not GitHub; the GitHub URL 404s.

6. **Instance size matters for `tsc`.** On the default `lite` instance, `/typecheck` took ~30-60s per call (merge stayed ~0.2s), apart from the very first call. After switching to `instance_type = "standard-1"` it is a steady ~3.5-4.2s through the Worker. The slow runs continued for a while after the first `standard-1` deploy, most likely because the old instance kept serving until it was replaced; I did not isolate that. Keep `standard-1` or larger.
7. Cold start of a fresh container through the Worker: ~15s to the first healthy response.
8. `server.mjs` returns `tscMs`, `load` and `cpus` from `/typecheck` for diagnosing timing.

## Live results (Cloudflare Containers, `https://mergiraf-spike.YOUR-SUBDOMAIN.workers.dev`, bearer-authenticated)

All fixtures behaved as expected on every run: 5 runs on `lite` (25/25 correct, slow tsc) and 3 runs on `standard-1` (15/15 correct, ~4s tsc, ~0.1s merge).

## Gate 1: GREEN

The container handled A, B2 and C reliably, and semantic conflict D passed Mergiraf and failed `tsc` with TS2532. Caveat for the story: two agents appending new declarations at the same spot still conflict (finding 1).

## Open items

- Pool or per-change container instances (the Worker uses one shared instance).
- `SPIKE_KEY` is stored in `.spike-key` (git-ignored) and as a Worker secret.

## Teardown (2026-10-07)

The deployed Worker, container application, Durable Objects, Zebric workflow and D1 database for this phase were deleted. The code and local `.dev.vars`/config remain; redeploying needs a new D1 database id in `wrangler.toml`.
