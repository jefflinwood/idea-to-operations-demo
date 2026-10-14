# Zebric gaps found building the Agent Swarm UI

Found 2026-10-07 while rebuilding the demo UI (Swarm, Change, Decision) as Zebric blueprint pages, with the goal of
stress-testing the framework, and re-checked on 2026-10-08 against Zebric's own Live Mode
implementation. The demo now depends on the published Zebric 0.9.0 packages. "Verified" means observed in a real browser against `wrangler dev`, or against the deployed Worker where
stated.

## Real-time support: now upstream (Live Mode)

My first version of live pages was superseded by Zebric's own, more complete Live Mode
(`docs/LIVE_MODE_CODING_SPEC.md` in the Zebric repo). The blueprint syntax is the same, `live = true` on a page, so the
spike needed no blueprint changes. What I verified on the new implementation:

| Check | Result |
|---|---|
| Board updates by itself after an API write (`scripts/spike/zebric-live-probe.mjs`) | yes, after 1 s |
| Rows created **inside command handlers** (Check, ChangeEvent) and the command's own status change appear on an open Change page (`scripts/spike/zebric-live-handler-probe.mjs`) | yes, about 300 ms |
| A real click on a Decision button runs the workflow, `ResolveDecision` runs as the signed-in human, and the page shows the resolution with no reload (`scripts/spike/zebric-ui-decide.mjs`) | yes |
| Does the change journal add D1 write conflicts? Deployed, 4 rounds of the contention test (`scripts/spike/gate3.ts`), same code with and without any `live` page (the journal is only written when the blueprint has one) | 11 and 12 `TRANSACTION_CONFLICT` retries with live on; 11 and 12 with live off. No detectable difference (2 runs each, so only a large effect is excluded) |
| Full agent path on the deployed Worker with live on: agents, Workflow, Decision, revision, landing | works (a stalled test run recovered and both changes completed once the decision was resolved) |

## Presentation fixes

These were separate from live updates and missing from the merged Live Mode. They were implemented in Zebric, tested, and documented in `packages/docs/.../building/blueprint.mdx` (new section
"How values are displayed") with a changeset (`.changeset/ui-presentation-fixes.md`, patch).

| # | Gap | Fix |
|---|---|---|
| P1 | LongText and JSON lose line breaks on detail pages | `whitespace-pre-wrap break-words` (JSON also `font-mono text-xs`); the value is emitted with no surrounding template whitespace, which `pre-wrap` would otherwise render |
| P2 | DateTime shows only the date | Shows date, time and **time zone** (`toLocaleString(undefined, { timeZoneName: 'short' })`). Naming the zone is new in this version: Workers render in UTC, and a bare time misled me in my own screenshots. `Date` is unchanged |
| P3 | Activity feeds show "Event" for records without `title`/`summary`/`action`/`timestamp` | Heading falls back to `kind`, `type`, `name`; body from `detail`, `description` or `message` (line breaks kept); time from `timestamp` or `createdAt` |

Regression evidence (all run on `ui-improvements` with these changes):

- New tests: 6 in `component-renderers.test.ts` and 3 in `renderer-utils.test.ts` (plus the existing ones). They cover line
  breaks and wrapping, **HTML escaping inside the new `pre-wrap` elements** (script, img and attribute payloads in LongText,
  JSON and event detail), other field types unchanged, `Date` still date-only, missing values still `-`, field-precedence
  order in the feed, `timestamp` preferred over `createdAt`, and no empty detail line. Mutation check: with the three source
  files reverted, 6 of the new tests fail; with them restored all pass.
- `runtime-core` 567 passed (48 files); `runtime-worker` 389 passed (29 files); `runtime-hono` 26; `agent` 101; `mcp-server`
  42; `runtime-simulator` 21; `react-simulator` 10; `framework-stories` 18; `notifications` 30; `observability` 8;
  `playground` 4; `cli` 10; examples' tests 11. `runtime-node` 474 passed, 8 skipped (the same 8 skipped before).
  Cross-runtime parity (`pnpm test:parity`): 46 of 46 on Node and 46 of 46 on Workers. Lint: 0 errors (1 pre-existing
  warning in `packages/observability/src/hono.ts`). `turbo run build`: all packages build.
- One failure in the first full parallel run: `runtime-node` conformance "MCP mutations invalidate the same live page",
  `Cannot find package '@zebric/agent/runtime'`. It passed alone and passed in a full re-run of the Node suite; the cause is
  parallel tasks rewriting `agent/dist` while another package loads it, unrelated to rendering. Worth knowing for CI.
- Not run: the Playwright browser suites (`runtime-node test:browser`, `playground test:e2e`), because Chromium for Playwright is
  not installed here (only `ffmpeg` is cached) and I did not download browsers. Instead the real pages were rendered in headless
  Chrome and read: the Decision page keeps its reason and evidence on separate lines and shows pretty-printed JSON; the Change
  page's Events list shows each event's kind, detail and a timestamp such as `10/9/2026, 11:00:39 AM UTC`.
- Behavior change to be aware of: any table or list showing a `DateTime` column now includes the time and zone, so those
  cells are wider (called out in the changeset).

## Open (not fixed) — items 1 to 14 from the first pass, minus the two Live Mode now covers (polling cost, Node support)

| # | Gap | Evidence | Suggestion |
|---|---|---|---|
| 1 | **Tables truncate wide cells** (Checks detail, Decision question) with no wrapping or expand. | Change page screenshot. | Wrap by default, or per-column `wrap`/`maxChars`. |
| 2 | **No column config for related lists/tables**, and no explicit `display = "table" \| "feed"` per query. | Needed `kind`/`detail` on events; only name heuristics decide. | `display` and `columns` on page queries. |
| 3 | **Action buttons give no success feedback.** The enhanced form posts JSON, the server answers `{ success, job }`, the client ignores `redirect`/`successMessage`; nothing visibly happens unless the page is live. | Click on "Return for revision": no dialog, no message, no change until the live refresh. | Return `redirect`/`message` from `/actions/:workflow` and surface them; or refresh live pages immediately. |
| 4 | **actionBar title/description are static**, so "A human needs to decide" stays after the decision is resolved. | Resolved Decision screenshot. | Template or `visibleWhen` for the bar text. |
| 5 | **Page `title` is static** (`title = "Change"`), cannot show the record's own title. | Change page. | Interpolation like `title = "{change.title}"`. |
| 6 | **Entity-name heuristics for presentation** (`task`, `event`, `milestone`, `activity` substrings) are fragile and surprising. | Gap fixed #4 above. | Remove in favor of explicit `display`. |
| 7 | **No way to give a signed-in human a role without SQL.** Sign-up always yields `role = "user"` (`input: false`); I had to `UPDATE user SET role = 'decider'` to let a person run `ResolveDecision`. | Local D1. | An admin/role-assignment path, or roles from blueprint seed. |
| 8 | **Sign-up needs a trusted origin.** better-auth rejects `Invalid origin` unless `BETTER_AUTH_URL`/`trustedOrigins` match; the JSON sign-up endpoint also needs a CSRF token the form supplies. | Local sign-up. | Document; default localhost in dev. |
| 9 | **JSON display strips identifier-looking keys.** `formatValue` removes fields named like ids, so `options = [{ id, label }]` showed only labels. | Decision page. | Make it opt-out for JSON fields. |
| 12 | **Boards overflow at five columns on a 1280 px window** (last column cut off, needs horizontal scroll). | Swarm board screenshot. | Shrink or wrap columns. |
| 13 | **Generated command buttons need input the UI cannot collect.** The Change page automatically showed "Resolve decision", but `ResolveDecision` takes `decisionId` and `choice`. Not clicked. | Change page screenshot. | Render a form for command `input`, or allow hiding generated actions per page. |
| 14 | **`/actions/:workflow` accepts browser sessions only**, so an API-key agent cannot trigger a UI action. | Read `engine.ts`. | Probably intended; document. |

## How the Decision page works in Zebric terms

`[page."/decisions/:id"]` is a `detail` page with an `actionBar`: three actions (`workflow = "ResolveDecisionAction"`,
`payload = { choice = ... }`, `visibleWhen = { status = "pending" }`). The workflow has a `command` step
(`ResolveDecision` on the Change, with `decisionId` and `choice` from the page record and payload) followed by a
`service` step (`changeflow.signal_decision`, implemented in `src/bridge.ts`) that wakes the waiting Cloudflare
Workflow. The command runs as the signed-in human, so the same role policy that protects the REST/MCP path applies.
