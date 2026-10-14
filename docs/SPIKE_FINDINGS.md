# Phase 6: Integration Workflow

2026-10-07. `phase6/` is the Phase 5 app (Zebric model, Cloudflare Agents, Workers AI, Artifacts forks) plus a Cloudflare Workflow that integrates every submitted change into **current main**. It is now the main app; later phases build here. Deployed as `zebric-swarm-live` (`https://zebric-swarm-live.YOUR-SUBDOMAIN.workers.dev`, D1 `zebric-swarm-live-db`, Workflow `zebric-swarm-live-change`), calling the Phase 1 container Worker `mergiraf-spike` through a service binding.

## What is built

- `src/change-workflow.ts`: `ChangeWorkflow`, one instance per Change (`change-<id>`). Per attempt: `begin_integration` (or `reopen_integration` when main moved) -> merge against current main -> `Check structural_merge` -> `begin_verification` -> `tsc` in the container -> `Check typescript` + `Check tests (not_run)` -> `mark_ready` -> push to main -> `integrate_change`, repository `mainSha`, `complete_task`, `complete_change`. On a conflict or `tsc` failure: `request_decision`, `waitForEvent("decision")` (up to 7 days); `abandon` ends it, anything else leaves the change in `revision` and the Workflow does `waitForEvent("resubmitted")` and runs another attempt.
- `src/integrate.ts`: clones main, fetches the change's fork, finds the **real merge base with git** (`findMergeBase`, never `Change.baseSha`), merges per file (take the side that changed; if both changed, `POST /merge` to Mergiraf; deletes/non-TS conflicts become conflicts), builds the merged tree, and `typecheck()`s it. `pushToMain` commits the result on top of the main it merged against and pushes.
- **Serialization is Git itself.** Only the final push mutates main, and Git rejects it if main moved after we merged. The Workflow then logs `integration.main_moved`, backs off and re-merges and re-verifies against the new main (`ReopenIntegration` is the one new command, `ready -> integrating`). No queue or lock.
- The Workflow is started and signaled from the Worker boundary (`worker.ts`): every Zebric request (REST and MCP) runs through one wrapper, and after a successful `submit_change` it creates the instance (or sends `resubmitted` if it already exists), and after a successful `resolve_decision` it sends the `decision` event. Zebric core is untouched.
- Each Repository row now owns a uniquely named Artifacts repo (`Repository.artifactsRepo`, created by `POST /admin/seed-repo`); the workspace endpoint and the Workflow read it from Zebric. `RequestDecision` is allowed from `integrating` as well as `verifying`.
- Phase 1 container Worker: requests now spread over a pool of 4 instances (`max_instances = 4`) instead of one shared instance.
- Scripts: `scripts/spike/gate6.ts` (`WORKERS=n PER=n`), `scripts/spike/gate6-decision.ts`.

## Results (deployed)

`gate6.ts` seeds 10 tasks, runs agents, waits for the Workflows, then checks Zebric and clones the final main: every submitted change `completed` with passing `structural_merge`, `typescript` and `tests:not_run` Checks, every task `completed`, final main passes `tsc --strict`, every integrated feature (file and route) is present, history is exactly initial commit + one commit per change, and `Repository.mainSha` equals main HEAD.

| run | changes | agents done | all integrated | main moved under a change | verdict |
|---|---|---|---|---|---|
| 3 agents x 1 | 3 | 31 s | 95 s | 3 | all checks pass |
| 5 agents x 2 | 10 | 141 s | 419 s | 19 | all checks pass |
| 10 agents x 1 (first build) | 10 | 97 s | 484 s | 24 | one check failed (see 2) |
| 10 agents x 1 (final build) | 10 | 109 s | 528 s | 25 | all checks pass |

Decision path (`gate6-decision.ts`): a change with a type error is submitted; the structural merge passes, `tsc` fails with the compiler diagnostic, a Decision is created and the change is `needs_decision`; after 15 s it is still waiting; an agent's attempt to resolve it is rejected (403); the human resolves `return_for_revision`, the change goes to `revision`; the agent pushes a fix and resubmits; the **same Workflow instance** resumes, `tsc` passes, and the change lands. Checks read `typescript: failed, passed`; events include `decision.requested`, `decision.resolved`, `change.integrated`, `change.completed`; the broken first attempt never reached main.

## Gate 6: GREEN

Three (and ten) concurrent changes integrated against a moving main and ended with a valid repository; a failing change waited durably for a human and then landed.

## Findings

1. **Mergiraf merges concurrent route-table edits.** Before building, I tested the real demo files: two and then three agents each adding an import and a route entry merged cleanly. Phase 1's same-position conflict applies to appended top-level functions, not object entries or import blocks. Across all runs no structural conflict occurred; Mergiraf did the work on `src/index.ts` repeatedly while tsc caught nothing, so the structural-merge story is real but conflict-free in this task mix.
2. **Optimistic concurrency is correct but slow under contention.** With 10 simultaneous changes, main moved under a change 24-25 times, so integration finished 6-7 minutes after the agents did (10 changes), versus about 1 minute for 3. Each loser redoes a merge, a container `tsc` (about 4 s) and a clone. It scales roughly quadratically in retries. Possible fixes, none done: jittered backoff, a per-repository lock held only around merge+verify (a queue, which the spec says not to over-build), or skipping re-verification when the new main only touched unrelated files.
3. **Race: change completes before its task.** The agent calls `submit_task` just after `submit_change`, so it can trail the Workflow, and the first version also completed the change before the task. The Workflow now waits for the task to be `submitted`, completes it, then completes the change, so "change completed" implies "task completed".
4. **Artifacts repo names are not reusable right after a delete.** Delete-then-create on the same name failed every other time ("Repository not found", "not ready"), and a freshly created repo can be briefly invisible to `get` and the git remote. Solved by never reusing names (one repo per seeded Repository) and retrying the first push and readiness checks.
5. **An empty `SPIKE_KEY` secret disables the container Worker's auth** (`env.SPIKE_KEY && ...`). I briefly caused this when `.spike-key` was missing; it was fixed within minutes. The Worker should fail closed.
6. Step output is the Workflow's memory: the merged tree (about 15 small files) is passed between steps as JSON, fine here, not for large repos.
7. Tests are recorded as `not_run` because the demo app has none.
8. The container is exercised through `tsc` with `types: ["node"]` and the default DOM lib, while agents' forks are verified locally with WebWorker libs; no discrepancy showed up.

## Open

- Retry churn under contention (finding 2).
- The Workflow only learns about the revision by the `resubmitted` event; nothing yet makes an agent perform the revision (Phase 7).
- Deployments still up: `zebric-swarm-live` (current), `zebric-swarm-agents` (Phase 5, superseded), `mergiraf-spike` (container). Test repos accumulate (`chg-*`, `swarm-demo-*`); `POST /admin/cleanup-forks?confirm=1` removes them.

# Phase 7: Hero semantic conflict (2026-10-07)

Run: `BASE_URL=https://zebric-swarm-live.YOUR-SUBDOMAIN.workers.dev REPEAT=n node --experimental-strip-types scripts/spike/gate7.ts` (deployed; seeds the two hero tasks into a fresh repo, runs two real Workers AI agents, plays the human with the `human` key, then verifies Zebric's records and a clone of final main). `scripts/spike/inspect.ts` prints one run's tasks, events, checks and decision for debugging.

## The scenario

- **A** "Make getUser return undefined for unknown users": `UserService.getUser` becomes `User | undefined`. Lease `src/user-service.ts::UserService.getUser`.
- **B** "Add profile endpoint": `src/profile.ts` reads `user.id/name/email` from `new UserService().getUser(id)`, registered in `src/index.ts`. Lease `src/profile.ts::profile`.
- Both agents fork the same base. B's agent finishes its code, then holds its `submit_change` until A's task is `completed` (`holdUntilTaskCompleted`). This is deliberate choreography ("B's agent is slower") so A always lands first; without it the order is a race and either change could be the one that fails. B is then integrated onto the main that already contains A.

## Results

8 of 8 post-fix runs reproduced the whole scenario (3 + 5 runs, each in a fresh repository): 99-116 s end to end, decision raised about 60-73 s in, B integrated about 25-40 s after the human's choice.

Each run checks: both leases acquired with no denial; A lands with `structural_merge`, `typescript`, `tests` = passed, passed, not_run; B shows `structural_merge: passed` (Git and Mergiraf merge), `typescript: failed` with `error TS18048: 'user' is possibly 'undefined'` naming `profile.ts`, `tests: not_run`; the Decision names the change that landed ("Make getUser return undefined for unknown users", its change id and commit) and shows the compiler evidence; it offers Return for revision / Preserve old contract / Abandon change; B is still `needs_decision` after 10 s (durable wait); an agent trying to resolve it is refused; the human resolves `return_for_revision`; B's agent revises against current main and resubmits; the same Workflow instance resumes, `typescript` goes failed then passed, B lands; final main passes `tsc --strict`, has `getUser(): User | undefined`, B's endpoint still reads `user.name` and handles an unknown user, and main history is initial + A + B.

## Gate 7: GREEN (for this choreography)

## Findings

1. **A first run did not reproduce the conflict, because B's agent dodged it.** The model wrote `Response.json(user)` and never touched `.name`, so it compiled against `User | undefined`. A scenario that depends on an LLM's choices is not deterministic. Fix: tasks can now carry a `Requires:` line (acceptance substrings separated by `;;`) that the agent enforces by re-asking, and B's task pins the dependency (`{ id: user.id, name: user.name, email: user.email }`, `Requires: user.name`). A requires `User | undefined`.
2. **The revising agent silenced the compiler instead of fixing the problem.** It wrote `getUser(id)!`, which compiles but crashes at runtime for an unknown id. The test caught it. Fix: the revision prompt forbids it and tells the agent to answer a missing user with a 404, and the agent rejects replies containing `!` non-null assertions, `as any`/`as unknown` casts or `@ts-` suppressions (`silencesTypeChecker`, with tests for the false-positive cases `!==`, `!x`, `!` in strings). After the fix, all 8 runs handle the missing user properly.
3. **Determinism comes from design, not luck**: fixed ordering (hold the second submit), pinned acceptance criteria, an explicit decision format, and a verifier that checks outcomes rather than trusting "submitted". The model is still nondeterministic in how it writes the code, so keep the verifier, and run the scenario several times before recording.
4. **`preserve_contract` is only a prompt variation** ("keep your change self-contained, don't rely on the changed code"). Making it revise the other change (A, already on main) would need a revert or follow-up change; not built. The hero path uses Return for revision.
5. The human step in the test is a scripted API call with the `human` key; Phase 8 provides the real Decision screen.
6. The new Decision text is plain text ("Reason / Evidence / Change") with options as `[{id,label,description}]`, ready for the UI.

## Not done

- Abandon and preserve-contract paths were not exercised end to end in this run set (abandon ended the Workflow in Phase 6's design but is untested here).
- The order-dependence: if A and B submit in the opposite order, A would be the failing change. Not part of the demo.

# Phase 8: Demo UI (2026-10-07)

Open `https://zebric-swarm-live.YOUR-SUBDOMAIN.workers.dev/ui?key=<UI_KEY>` once (the key is `UI_KEY` in git-ignored `phase6/.dev.vars` and a Worker secret; it sets a cookie). Three screens, one static page (`src/ui.html`, plain HTML/JS, no build) polling one endpoint every 2 s:

- **Swarm** (`#/`): task count, working / verifying / waiting for a human / completed counts with a progress bar, one row per agent (current task, state, latest step, its leased symbols, "N done"), the queued tasks, a "Paused for a human" banner when a Decision is pending, a Main panel (current SHA, changes landed, how often main moved under a change, lease denials) and a live activity feed.
- **Change** (`#/change/<id>`): title and state; Agent, Repository (its own Artifacts repo and fork), Base SHA, Head SHA, "Merged onto" (current main at integration time, noting when it had moved) and "Landed as"; the symbols it declared and their lease state; Checks grouped by attempt (so the failed and the passing verification are both visible); and the timeline from claim to landing.
- **Decision** (`#/decision/<id>`): what interacted (the change that landed meanwhile and this change), why automation stopped, the compiler evidence, and three action buttons (Return for revision, Preserve old contract, Abandon change). After the click it shows a stepper (human decided, agent revises, re-verified, lands on main).

Backend (`src/ui-api.ts`): `GET /ui/api/state` returns an aggregated read-only snapshot of Zebric's records for one repository (reads use the integrator key); `POST /ui/api/decide` runs Zebric's own `ResolveDecision` command with the human key (needs the cookie and an `x-ui` header; retries Zebric's `retryable` conflicts). The browser never holds a Zebric key; Zebric still enforces roles, audit and the Workflow signal. The UI is custom HTML rather than Zebric-generated pages, because the Swarm screen needs live aggregates; every number comes from Zebric records.

## Verification

`scripts/spike/ui-e2e.mjs` drives the deployed UI in headless Chrome through a live hero run: waits for the agents, takes screenshots of each screen (`results/ui/*.png`), opens the Decision screen from the banner, **clicks the real button**, and waits for both changes to complete (17 checks). It passed on a quiet system, and again while a 10-task, 5-agent swarm ran on the same Worker. Screenshots were also taken of a busy 10-task swarm (5 agents, leases, "main moved ... merging again", per-agent rows).

## Findings

1. **Gate 8 cannot be proven by me.** The screens read clearly in screenshots (state colors, plain-language activity, a self-explaining Decision), but "a viewer unfamiliar with Zebric understands it without narration" needs a real viewer. Show someone the Decision screen cold.
2. **The UI exposed a robustness hole, then fixed it.** While a 10-task swarm ran, a hero run stalled: agent 1 claimed task A and never started its change, so A stayed `claimed` and B waited for it forever (the failure was not audited, so the cause is unconfirmed; D1 contention from the concurrent swarm is the likely cause). Agent and Workflow retry budgets for `retryable` errors were raised from 8 to 14 attempts with longer backoff, agent failures are now logged to the Worker console, and the UI's decide endpoint retries conflicts. A repeat under the same load passed. There is still no way for an agent to release a task it claimed but could not start; a failed agent leaves the task `claimed`.
3. A click on the Decision button during heavy load was previously refused with a transient conflict, because the endpoint made a single call. It now retries.
4. Browser extension control was unavailable, so verification used headless Chrome with the DevTools protocol (a real click, real screenshots).
5. The UI is polling (2 s), not push; the page re-renders each poll.

## Not done

- No giant diff viewer (by design). Preserve-contract and Abandon buttons exist but were only clicked in no run; Return for revision is the exercised path.
- Zebric's own generated pages and login are not used for the demo.

# Phase 8b: the UI rebuilt on Zebric's own pages, and a framework stress test (2026-10-07)

The Phase 8 custom page (`/ui`, kept as a fallback) was replaced by blueprint pages rendered by Zebric itself, because
the point of the project is to show and stress-test Zebric, and real-time support is something a framework should
provide. Pages (all `live = true`): **Runs** (`/`, a list), **Swarm** (`/runs/:id`, a board of Tasks by status),
**Changes** (`/runs/:id/changes`, a board of Changes by status), **Change** (`/changes/:id`, detail plus Checks, Events
and Decisions), **Decision** (`/decisions/:id`, detail plus three state-gated action buttons). `Change` gained a `title`
field (board cards need one; migration `0003_change_title.sql`). A person signs in with Zebric's own sign-up/sign-in; a
user with `role = "decider"` can resolve decisions.

## Result

- A real click on "Return for revision" on Zebric's page runs the `ResolveDecisionAction` workflow, which executes
  `ResolveDecision` as the signed-in human (the Change moves to `revision`) and signals the Cloudflare Workflow; the page
  then shows the resolution by itself with no reload (`scripts/spike/zebric-ui-decide.mjs`, local).
- A board changes by itself 1 s after an API write (`scripts/spike/zebric-live-probe.mjs`); before the framework change it did
  not change at all.
- Local only: the pages, sign-in and button were tested on `wrangler dev` (localhost) with a generated test login in the
  git-ignored `.dev.human`. The deployed Worker has not been verified with a human login.

## The framework work

Real-time support was missing, so it was added to Zebric (since superseded by Zebric's own Live Mode, below):
`live = true` on a page, an SSE stream `/_zebric/live` driven by the audit journal, a client that refreshes the page
content, plus four presentation fixes found along the way (line breaks, DateTime, activity feeds, re-runnable form
enhancement). The full list, with what is fixed and what is still open, is in `ZEBRIC_GAPS.md`.

## Not done

- Deployed verification of the Zebric UI (needs a human account on the deployed Worker).
- The open gaps in `ZEBRIC_GAPS.md` (table wrapping, action feedback, static titles, role assignment, and others).
- Node runtime support for live pages.

# Phase 8c: ported to Zebric's own Live Mode (2026-10-08)

Zebric gained a new, more complete Live Mode (`docs/LIVE_MODE_CODING_SPEC.md` in the Zebric repo) that
replaced the `live = true` support I had added. The syntax is
the same, so **the blueprint needed no changes**; the port was picking up the new `runtime-core` and `runtime-worker`, redeploying,
and re-verifying. `ZEBRIC_GAPS.md` is updated.

## Verified on the new implementation

- A board changes by itself 1 s after an API write; an open Change page picks up rows created inside command handlers
  (Check, ChangeEvent) and the command's own status change in about 300 ms; the real Decision button click runs the
  workflow and the page shows the resolution with no reload.
- **Does the change journal add D1 write conflicts?** The journal is only written when the blueprint has a `live` page, so
  I ran the same deployed code both ways: the Phase 3 contention test (4 rounds of 3-way claim and lease races, 2 runs each).
  With live on: 11 and 12 `TRANSACTION_CONFLICT` retries. With no live pages: 11 and 12. No detectable difference; two runs
  each excludes only a large effect.
- The full agent path on the deployed Worker, with live on and the hook re-enabled: hero scenario in 115 s (decision at
  62 s, resolved at 75 s, landed at 113 s), all checks passing.

## What did not carry over

My presentation fixes (line breaks in LongText/JSON, time in DateTime, activity feeds using `kind`/`detail`/`createdAt`)
were separate from live updates and were not in that Live Mode work. On the Decision page this is visible: the reason and the
compiler evidence collapse into one paragraph. They were re-applied to Zebric separately (see `ZEBRIC_GAPS.md`).

## Test-harness lessons (not framework bugs)

Several hero runs stalled for 12 minutes or more. Zebric's own timestamps showed the system had run at normal speed (the
decision was requested at 45 s); my test script held the long agent stream and its polling GETs on one HTTP/2 connection
through Node's built-in `fetch`, and the polling stopped. Running the stream in a separate `curl` process fixed it
(`gate7.ts`, `ui-e2e.mjs`). Two further harness bugs fixed on the way: a helper that turned an unparsable body into `{}`
(so a cut-off response looked like an empty list), and list reads that assumed an array. Killed test runs also leave their
agents polling Zebric for up to 20 minutes, which adds load to the next run; wait or expect noise.

A temporary `DISABLE_WORKFLOW_HOOK` secret was set on the deployed Worker for the contention test (the test fabricates
changes the Workflow cannot process) and has been removed.

## Deployed verification with a real human login (2026-10-08)

Signed up through Zebric's own form on the deployed Worker as a person (not scripted); the account was granted
`role = "decider"` in the deployed D1 (`UPDATE user SET role = 'decider' WHERE email = ...`, the only way to give a person
a role today, see `ZEBRIC_GAPS.md` item 7). I started a hero run with no scripted human so it stopped at the Decision, and
the person clicked "Return for revision" on Zebric's Decision page. Result, confirmed by the person and by Zebric's records:

- With the Swarm and Change pages open in other tabs, both updated by themselves, with no manual refresh (the
  deployed Live Mode, over the real network and D1).
- The click ran `ResolveDecision` as the signed-in person, and the `changeflow.signal_decision` service step woke the
  waiting Cloudflare Workflow: the agent revised against current main, `tsc` passed, B landed, and both tasks and changes
  are `completed`. This is the real signal path (Zebric UI -> Zebric workflow -> service step -> Cloudflare Workflow),
  verified on the deployed Worker for the first time.

Test debris cleaned up on the way: three stale pending decisions left by my killed test runs were abandoned with the
human role so their Workflows ended and they would not clutter the person's Runs list.
