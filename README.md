# Idea to operations demo

Created by Jeff Linwood, author of this repository and of Zebric, which powers the outcome, task and decision layer of this demo.

A working demo of a human guiding an agent team from an idea to a running application. It uses Zebric for the outcome, tasks, decisions and agent provenance; Cloudflare Agents and Workers AI to write code; Artifacts repositories for isolated Git workspaces; and a Mergiraf container to merge and type-check changes before they land.

The scenario is **Vendor Access Expiration**. Two agents start from the same code: one changes a lookup contract, the other builds against its old behavior. Their code merges, but TypeScript catches the semantic conflict. The human chooses a revision, the agent adapts, and the team finishes the remaining tasks. The UI walks through **Build Outcome → Decision → Launch → Adopt**.

Everything needed is in this repository, including `mergiraf-spike/`. No original author's Cloudflare account, database, deployment or credentials are required. You use your own Cloudflare account. GitHub hosts this source; the repositories agents modify are separate Cloudflare Artifacts repositories.

## Prerequisites

- Node.js **22.18 or newer** and pnpm **10**.
- A Cloudflare account with access to **Artifacts**, **Workers AI**, **D1**, **Workflows**, and **Containers**. The full demo requires a Workers Paid plan for Containers and can incur AI/container charges.
- Docker running, with support for Linux amd64 images.
- Optional: Google Chrome for the browser verification scripts. On Linux/Windows or with a nonstandard installation, set `CHROME` to its executable path.

Relevant Cloudflare guides: [Artifacts setup](https://developers.cloudflare.com/artifacts/get-started/workers/), [Containers](https://developers.cloudflare.com/containers/get-started/), and [Artifacts in Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/).

## Install and create your credentials

Clone this repository, then run from its root:

```sh
pnpm install --frozen-lockfile
pnpm --dir mergiraf-spike install --frozen-lockfile
pnpm setup
pnpm types
pnpm typecheck
```

`pnpm setup` generates random keys for the human, seeder, integrator, ten agents, session authentication and merge service. It creates ignored files with permissions `0600`:

| File | Purpose |
| --- | --- |
| `.dev.vars` | Wrangler local secrets |
| `.prod.vars` | Credentials for deployed reset/verification scripts |
| `.prod.secrets.json` | Same secrets, ready for Wrangler bulk upload |
| `.dev.human` | Demo user's name, email and password |
| `mergiraf-spike/.dev.vars` | Shared merge-service secret |

Setup refuses to overwrite existing credentials. `.dev.vars.example` and `.dev.human.example` document the format. Never commit the generated files. Read `.dev.human` privately to obtain the login password; these credentials do not create a user until you sign up.

## Run the UI locally

Wrangler may require Cloudflare login for the AI binding even when you only explore the UI. This is the fastest way to explore the screens. It seeds records without creating Artifacts repositories; the agent build and live launch require the full deployed setup below.

```sh
pnpm exec wrangler login
pnpm db:migrate
pnpm dev
```

In another terminal, from the repository root:

```sh
SKIP_ARTIFACTS=1 pnpm seed:local
```

Open **http://localhost:18800/auth/sign-up** and create the user using the email/password in `.dev.human`. Then open **http://localhost:18800/outcomes**.

To allow this user to resolve Decisions, run:

```sh
pnpm exec wrangler d1 execute DB --local --command "UPDATE user SET role='decider' WHERE email='demo.human@example.test'"
```

Use your chosen email if you changed `.dev.human`. Sign out and back in after assigning the role. Zebric currently has no user role-assignment UI.

For a local replay through the real Zebric commands, restart `pnpm dev` with `DISABLE_WORKFLOW_HOOK=1` added to `.dev.vars`, seed again, and run:

```sh
node --env-file=.dev.vars scripts/dev-sim.mjs decision
```

This simulates the agents and checks; it does not run AI or deploy the vendor app. Remove `DISABLE_WORKFLOW_HOOK` before running the actual demo. To develop the merge service locally, run `pnpm dev:merge` in another terminal with Docker running; Wrangler connects it through the service binding. See [the merge worker README](mergiraf-spike/README.md).

## Deploy the complete demo to your account

### 1. Authenticate and create a database

```sh
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm exec wrangler d1 create outcomes-demo-db
```

Replace the all-zero `database_id` in `wrangler.toml` with the new database ID. If you have several accounts, set `CLOUDFLARE_ACCOUNT_ID` to the account you intend to use for every command. Choose an Artifacts namespace available to that account; the configuration uses `default`.

### 2. Set your deployment URLs

Edit `[vars]` in `wrangler.toml`:

```toml
BASE_REPO = "vendor-access"
APP_URL = "https://vendor-access.YOUR-SUBDOMAIN.workers.dev"
BETTER_AUTH_URL = "https://outcomes-demo.YOUR-SUBDOMAIN.workers.dev"
ORIGIN = "https://outcomes-demo.YOUR-SUBDOMAIN.workers.dev"
```

Use your Workers subdomain or your own custom domains. The checked-in values target localhost. `BETTER_AUTH_URL` and `ORIGIN` must exactly match the demo origin, or sign-up/sign-in can fail origin validation. You can change Worker names; if you rename `mergiraf-spike`, also change the `MERGERAF` service's `service` value in the root configuration. If you rename the vendor app, change `demo-app/wrangler.toml`, `APP_URL`, and the Workers Builds project name together, then run `pnpm pack-demo`.

The persistent `BASE_REPO` is reset to the starter app on each reset. Use a dedicated repository name and Artifacts namespace for this demo.

### 3. Deploy both Workers and upload secrets

Deploy the merge Worker first so the main Worker's service binding can resolve it:

```sh
pnpm deploy:merge
node --env-file=.prod.vars -e 'process.stdout.write(process.env.SPIKE_KEY)' | pnpm --dir mergiraf-spike exec wrangler secret put SPIKE_KEY
pnpm db:migrate:prod
pnpm deploy
pnpm exec wrangler secret bulk .prod.secrets.json
```

The same `SPIKE_KEY` must be configured on both Workers. The other API keys are internal to this demo; they are not Cloudflare API tokens. `pnpm types` regenerates the ignored Worker binding types; `pnpm typecheck` checks both Workers.

### 4. Create the demo human and seed the scenario

Open `https://outcomes-demo.YOUR-SUBDOMAIN.workers.dev/auth/sign-up` and sign up using `.dev.human`. Then run:

```sh
BASE_URL=https://outcomes-demo.YOUR-SUBDOMAIN.workers.dev CONFIRM_REMOTE=1 pnpm reset
```

Reset creates/reseeds the Artifacts starter repository, six tasks and three Outcomes, and assigns the signed-up user the `decider` role. Sign out and back in afterward. Always specify the deployment URL: the script has no default remote account.

Reset removes all demo records and Artifacts repositories whose names start with `chg-` or `swarm-demo-`, and rewrites `BASE_REPO`. Use this command only in a dedicated demo deployment/namespace. It does not cancel already-running agents or Workflows; let a run finish before resetting.

### 5. Connect the vendor app to Workers Builds

The agents build a separate Worker, `vendor-access`. Connect its persistent Artifacts repository once in the Cloudflare dashboard:

1. **Workers & Pages → Create application → Artifacts**; choose your namespace and `vendor-access` repository (`BASE_REPO`). The reset above must have created it first.
2. Set the project name to `vendor-access` and the root directory to the repository root.
3. Set the build command to:

   ```sh
   echo "export const COMMIT = '$WORKERS_CI_COMMIT_SHA';" > src/version.ts
   ```

4. Set the deploy command to `npx wrangler deploy`.
5. Wait for a successful initial build. Visit `APP_URL`; the footer should display its Git commit.

This connection is a manual dashboard step. Builds deploy every push to `main`, including resets; **Launch verifies the deployed commit**, rather than initiating deployment. If the first reset ran before the Builds connection existed, trigger the initial build in the dashboard or reset again.

### 6. Run the scenario

Open `/outcomes`, select **Vendor Access Expiration**, and click **Build Outcome**. When a Decision appears, choose **Return for revision**. Wait for **Ready for launch**, click **Launch**, wait for live verification, and click **Adopt as Level 1**. The other two seeded Outcomes provide portfolio context.

Changes show each agent's instruction, model attempts, files, commit, inherited context, checks and revision history. Additional Decisions can appear if an AI-generated change fails a check.

## Repeat or verify

Reset a completed run with the same `BASE_URL=... CONFIRM_REMOTE=1 pnpm reset` command.

For automated browser runs (requires Chrome and a signed-up demo human):

```sh
BASE_URL=https://outcomes-demo.YOUR-SUBDOMAIN.workers.dev \
  ALLOW_REMOTE=1 CONFIRM_REMOTE=1 REPEAT=1 \
  node scripts/run-demo.mjs results/repeatability
```

The runner resets before each run, clicks the real UI and writes screenshots plus `runs.json`. For MCP verification:

```sh
BASE_URL=https://outcomes-demo.YOUR-SUBDOMAIN.workers.dev node scripts/verify-zebric-mcp.mjs
```

## Repository layout and limitations

- `worker.ts`, `src/`, `blueprint.toml`, `templates/`: demo UI, policies, agents and integration Workflows.
- `demo-app/`: starter vendor application; `pnpm pack-demo` refreshes its embedded source after edits.
- `mergiraf-spike/`: merge/type-check Worker, Dockerfile and fixture checks, with its own dependency lockfile.
- `migrations/`: D1 schema, including authentication and agent provenance.
- `scripts/`: setup, seed/reset, simulation and browser verification.
- `docs/`: [scenario design](docs/DEMO_CODING_SPEC.md), [known Zebric gaps](docs/ZEBRIC_GAPS.md), and historical spike findings.

The scripts in `scripts/spike/` and the spike findings describe earlier experiments and can assume older routes or configurations. Use this README for setup. Local UI mode has no AI build or real launch. The full demo needs Artifacts/model availability in your account, a working Containers deployment, and the manual Workers Builds connection.

If Build fails, inspect Workflows/Worker logs and check the AI model and Artifacts namespace. A merge `401` means the shared `SPIKE_KEY` differs. If Launch verification waits or fails, check Workers Builds and confirm `APP_URL` serves the commit on Artifacts `main`. The demo currently type-checks generated code; it does not provide behavioral test coverage for agent-written features.

## License

This project is released under the [MIT License](LICENSE). Copyright (c) 2026 Jeff Linwood.

## Credits and acknowledgements

This demo is written by [Jeff Linwood](https://www.jefflinwood.com/). [Zebric](https://www.zebric.dev) is Jeff's own project. It also builds on the work of others:

- **[Mergiraf](https://mergiraf.org)**: the syntax-aware Git merge driver that the merge service runs in a container (downloaded at image build time, v0.20.0) to combine agent changes. Mergiraf is a separate program with its own license (GPL-3.0); it is not bundled into this repository's source. Thanks to its author and contributors.
- **Zebric** (`@zebric/runtime-core`, `@zebric/runtime-worker`, `@zebric/mcp-server`): Agent-native, declarative web application framework that runs on Cloudflare and Node.
- **[Cloudflare](https://www.cloudflare.com)** Workers, D1, Workflows, Containers, Workers AI and Artifacts, plus the [`agents`](https://github.com/cloudflare/agents) SDK, [`@cloudflare/containers`](https://github.com/cloudflare/containers) and [Wrangler](https://github.com/cloudflare/workers-sdk).
- **[isomorphic-git](https://isomorphic-git.org)** and **[memfs](https://github.com/streamich/memfs)**: Git operations over in-memory file systems.
- **[TypeScript](https://www.typescriptlang.org)**: used to type-check merged code.
- **[Better Auth](https://www.better-auth.com)**: sign-in, as used through the Zebric runtime.

Each dependency remains under its own license; see its package for details.

**Note on Mergiraf's license:** Mergiraf is GPL-3.0. This repository contains only source code (MIT) and a Dockerfile that downloads the Mergiraf release binary when you build the image yourself; no Mergiraf code or binary is included or linked into this source. The project does not publish container images. If you build an image and distribute it to others, that image contains the Mergiraf binary, so GPL-3.0 obligations for that binary (such as offering its source) apply to your distribution.
