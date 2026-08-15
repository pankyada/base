# Web Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Designs:
> [`web-surface-design.md`](../specs/2026-08-16-web-surface-design.md) (W0 master) ·
> [`web-read-api-design.md`](../specs/2026-08-16-web-read-api-design.md) (W1) ·
> [`analyst-workbench-design.md`](../specs/2026-08-16-analyst-workbench-design.md) (W3) ·
> [`operator-assistant-console-design.md`](../specs/2026-08-16-operator-assistant-console-design.md) (W4/W5)

**Goal:** Turn the Next.js client from a chat window into the harness control
plane with three faces — analyst, operator, assistant — over one runtime, one
token system, and one component kit. Close the 17-message protocol gap, replace
the nine placeholder widgets with a real mark kit, mount generated surfaces, and
expose the accumulated state (telemetry, usage, audit, memory, triggers) that has
never had an HTTP surface.

**Architecture:** Backend gains a read-only HTTP layer (`src/server/read-api.ts`),
an origin policy (`src/server/origin.ts`), a dataset store (`src/datasets/`), and
pure aggregation (`src/telemetry/aggregate.ts`). The agent loop, ACL, workflow,
and memory modules are untouched. The web client gains route shells, a generated
protocol module, a widget kit, and a sandboxed surface host.

**Tech Stack:** TypeScript, Next.js 15 (App Router), React 18, Tailwind 4, Vitest
+ Testing Library (all existing). Charts are hand-rolled SVG — no new runtime
dependency on either side unless an open question resolves otherwise.

## Global Constraints

- **Back-compat.** Existing WS clients (Go TUI, CLI) keep working unchanged
  through every phase. No `ServerMessage` variant is removed or reshaped;
  additions only.
- **Boundary guard.** `scripts/check-boundary.sh` must pass — no product or vendor
  vocabulary in `src/`. "Dataset", "metrics", "audit" are generic; a life-domain or
  vendor noun is not.
- **Read-only backend.** The only new write endpoint in the whole plan is
  `POST /datasets`. Every other new route is a read.
- **One write path for memory.** Memory edits from the browser go through
  `MemoryWrite` tool calls, never REST, so ACL + provenance + audit apply.
- **Security controls are server-authoritative.** No client flag grants a
  capability. `hello.yolo` is ignored from Phase 0 onward.
- **Empty is not broken.** Every panel and endpoint has a defined empty state; a
  fresh install renders as new.
- **Every phase ends green:** `pnpm typecheck && pnpm test && pnpm --filter harness-web typecheck && pnpm --filter harness-web test`.
- Phases ship standalone and in order; each is independently useful if the next
  never lands.

---

# Phase 0 — Transport hardening & read APIs (W1)

No UI. Closes the cross-site WebSocket hole and builds every endpoint the later
phases read. Independently valuable: the hole exists whether or not the web client
is ever used.

### Task 0.1: Origin policy

**Files:**
- Create: `src/server/origin.ts`
- Modify: `src/server/index.ts` (upgrade handler), `src/server/rest.ts:623`
- Test: `tests/server-origin.test.ts`

**Interfaces:**
- Produces: `OriginPolicy { allowed: string[]; allowBrowserless: boolean }`
- Produces: `loadOriginPolicy(env)`, `checkOrigin(origin, policy)`
- `HARNESS_ALLOWED_ORIGINS` default `http://localhost:3000,http://127.0.0.1:3000`

- [ ] **Step 1:** Failing tests — exact-match allow; `http://evil-localhost.com` rejected against a `localhost` entry (no suffix matching); missing `Origin` allowed when `allowBrowserless`; `*` allows and warns; port and scheme mismatches rejected.
- [ ] **Step 2:** Implement `origin.ts`. No regex, no wildcard except the whole-string `*`.
- [ ] **Step 3:** Wire the WS upgrade — reject before the socket is accepted, respond `403`, log the offending origin at `warn`.
- [ ] **Step 4:** Wire REST at the top of `createRestHandler`, before route matching and before the API-key check.
- [ ] **Step 5:** Report the effective policy from `GET /health`.
- [ ] **Step 6:** Verify the Go TUI and CLI still connect (no `Origin` header path). `npx vitest run tests/server-origin.test.ts`

### Task 0.2: Server-authoritative approval mode

**Files:**
- Modify: `src/server/index.ts`, `src/types.ts` (doc comment only)
- Test: `tests/approval-authority.test.ts`

**Interfaces:**
- `hello.yolo` is ignored. Effective mode = `profile.approval_mode ⊓ HARNESS_APPROVAL_MODE ⊓ ceiling(profile.mode)`.
- `set_approval_mode` above the ceiling → `notice { level: 'warn' }`, mode unchanged.

- [ ] **Step 1:** Failing tests — `hello { yolo: true }` against a `strict` profile still prompts; `set_approval_mode: 'yolo'` under `mode: production` is refused with a notice; a permitted change is applied and echoed via `approval_mode_changed`.
- [ ] **Step 2:** Implement resolution; `session_ready.yolo` becomes derived display state.
- [ ] **Step 3:** Confirm no existing test asserted the client-granted path; update any that did, noting the behaviour change.
- [ ] **Step 4:** `npx vitest run tests/approval-authority.test.ts`

### Task 0.3: Telemetry aggregation (pure)

**Files:**
- Create: `src/telemetry/aggregate.ts`
- Test: `tests/telemetry-aggregate.test.ts`

**Interfaces:**
- Produces: `aggregateMetrics(events, opts): MetricsReport` with `tools`, `models`, `stages`, `daily` sections (design W1 §2.1).
- Pure function over `TelemetryEvent[]`; no file IO.

- [ ] **Step 1:** Failing tests — ok-rate, p50/p95, cost sums, day bucketing across a timezone boundary, empty input → empty sections (not throw), events missing optional fields excluded from the sections that need them.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `npx vitest run tests/telemetry-aggregate.test.ts`

### Task 0.4: Read API routes

**Files:**
- Create: `src/server/read-api.ts`
- Modify: `src/server/rest.ts` (mount)
- Test: `tests/read-api.test.ts`

**Interfaces:**
- `GET /metrics`, `/usage`, `/audit`, `/memory`, `/triggers`, `/sessions/:id/messages`, `/stats/routing` (design W1 §2).
- Produces: `encodeCursor`/`decodeCursor` for JSONL-backed pagination.

- [ ] **Step 1:** Failing tests per endpoint — happy path shape; missing source file → `200` with empty result; bad param → `400`; unknown session → `404`; `limit` clamped to 1000; cursor round-trips.
- [ ] **Step 2:** Implement as thin wrappers over `queryEvents`, `readUsage`, `listAudit`, `MemoryProvider.list/query`, the trigger registry, and `aggregateRouting`. No new maths outside Task 0.3.
- [ ] **Step 3:** Truncated final JSONL line must not 500 — add a fixture with a half-written line.
- [ ] **Step 4:** ETag + `Cache-Control` per design §3.
- [ ] **Step 5:** `npx vitest run tests/read-api.test.ts`

### Task 0.5: Dataset store

**Files:**
- Create: `src/datasets/store.ts`, `src/datasets/types.ts`
- Modify: `src/server/read-api.ts`
- Test: `tests/datasets.test.ts`

**Interfaces:**
- `POST /datasets`, `GET /datasets`, `GET /datasets/:id/schema`, `GET /datasets/:id/preview`, `DELETE /datasets/:id`
- Root `~/.harness/datasets/<user>/<id>/`; server-generated id; client filename is metadata only.

- [ ] **Step 1:** Failing tests — path traversal in the filename cannot escape the root; disallowed extension rejected; oversize rejected with `413`; schema sniff on CSV with quoted commas, ragged rows, an all-null column, and a BOM; preview honours `rows`.
- [ ] **Step 2:** Implement store + sniffing (delimited and JSON only; Parquet stores opaque per design open question 2).
- [ ] **Step 3:** Mark dataset-derived content provenance-`untrusted`.
- [ ] **Step 4:** `npx vitest run tests/datasets.test.ts`

### Task 0.6: Docs

- [ ] **Step 1:** `docs/DEPLOYMENT.md` — `HARNESS_ALLOWED_ORIGINS`, `HARNESS_DATASET_MAX_BYTES`, and the approval-authority change as a **breaking behaviour note**.
- [ ] **Step 2:** `docs-site/` — read API reference page.
- [ ] **Step 3:** `docker-compose.yml` + `.env.example` set the origin var.
- [ ] **Step 4:** `pnpm typecheck && pnpm test && ./scripts/check-boundary.sh`

---

# Phase 1 — Protocol parity (W2)

Every `ServerMessage` handled or explicitly ignored with a reason. No new backend.

### Task 1.1: Generated protocol module

**Files:**
- Create: `scripts/gen-web-protocol.mjs`, `web/lib/protocol.ts` (generated)
- Modify: `web/lib/types.ts` (re-export only), `package.json`, CI workflow
- Test: `tests/web-protocol-fresh.test.ts`

**Interfaces:**
- Produces: `web/lib/protocol.ts` emitted from `src/types.ts`, containing the message unions and shared types.

- [ ] **Step 1:** Failing test — regenerating produces no diff; a new variant added to `src/types.ts` makes the freshness check fail.
- [ ] **Step 2:** Write the generator; delete the hand-copied duplicates in `web/lib/types.ts`.
- [ ] **Step 3:** Add the freshness check to CI.
- [ ] **Step 4:** Fix the resulting typecheck fallout in the reducer — this is the point: unhandled variants now surface.

### Task 1.2: Exhaustive reducer

**Files:**
- Modify: `web/components/HarnessApp.tsx` (split reducer into `web/lib/reducer.ts`)
- Test: `web/lib/reducer.test.ts` (extends `web/components/harnessReducer.test.ts`)

**Interfaces:**
- Produces: reducer with a `switch` exhaustive over `ServerMessage['type']`, `never`-checked in the default branch; deliberate ignores are explicit cases with a comment.
- State keyed by `run_id` for lanes.

- [ ] **Step 1:** Failing tests — one per newly handled variant; two concurrent `run_id`s do not interleave into one transcript; an unknown future variant does not crash.
- [ ] **Step 2:** Implement handlers for `turn_start`, `stage`, `plan`, `notice`, `models`, `model_changed`, `approval_mode_changed`, `skills`, `skill_content`, `skill_result`, `commands`, `pending`, `undo_entries`; keep `transcript_partial` and `audio_out_*` as explicit deferred-to-#23 ignores.
- [ ] **Step 3:** Keep `cost_usd`, `context_tokens`, `context_window` from `stats`.
- [ ] **Step 4:** `pnpm --filter harness-web test`

### Task 1.3: Design tokens v2

**Files:**
- Modify: `web/styles/globals.css`
- Create: `web/app/_fixtures/tokens/page.tsx`
- Test: `web/lib/tokens.test.ts`

- [ ] **Step 1:** Failing test — every token defined in the dark block is defined in the light block and vice versa.
- [ ] **Step 2:** Add `--series-1..8`, `--seq-0..5`, `--div-*`, `--st-*`, `--row-h-*`, `--gap-1..6` for both themes.
- [ ] **Step 3:** Fixture page rendering all ramps; check contrast ≥3:1 against `--panel` and deuteranopia distinguishability.

### Task 1.4: Chrome — rail, gauges, stage strip, toasts

**Files:**
- Create: `web/components/chrome/Rail.tsx`, `ContextGauge.tsx`, `CostTicker.tsx`, `web/components/turn/StageStrip.tsx`, `web/components/chrome/Toasts.tsx`
- Modify: `web/components/StatusBar.tsx`, `web/components/TopBar.tsx`

- [ ] **Step 1:** Failing tests — gauge renders percentage from `context_tokens`/`context_window` and degrades when the window is unknown; stage strip shows stage · intensity · tier · cost and marks escalations; toasts stack, dedupe, and auto-dismiss by level.
- [ ] **Step 2:** Implement; wire into the shell.
- [ ] **Step 3:** `pnpm --filter harness-web test`

### Task 1.5: Palette, model switch, cancel, compact

**Files:**
- Modify: `web/components/Palette.tsx`, `web/components/Composer.tsx`
- Test: `web/components/paletteCommands.test.ts`

- [ ] **Step 1:** Failing tests — model list shows availability and price and sends `set_model`; cancel sends `cancel` only while busy; `compact` is offered only when the context gauge is above threshold; slash commands come from `commands`.
- [ ] **Step 2:** Implement, including the approval-mode selector reflecting (not granting) server state.
- [ ] **Step 3:** `pnpm --filter harness-web test`

### Task 1.6: Transcript rehydration

**Files:**
- Create: `web/hooks/useHarnessQuery.ts`
- Modify: `web/lib/reducer.ts`

- [ ] **Step 1:** Failing test — mounting with a `sessionId` loads the last N turns from `GET /sessions/:id/messages` and renders them before any WS event arrives.
- [ ] **Step 2:** Implement with "load earlier" paging.
- [ ] **Step 3:** `pnpm --filter harness-web typecheck && pnpm --filter harness-web test`

---

# Phase 2 — Surfaces & widget kit (W3a)

The highest value-to-effort work: the runtime already produces both payload types.

### Task 2.1: Surface host

**Files:**
- Create: `web/surface/SurfaceHost.tsx`, `web/surface/frame.html`, `web/surface/bridge.ts`
- Modify: `web/lib/reducer.ts` (`ui_render`), `web/components/Workspace.tsx`
- Test: `web/surface/bridge.test.ts`, `web/surface/isolation.test.ts`

**Interfaces:**
- Consumes `SurfaceSpec`; produces `ui_result { id, ok, errors[], stdout, duration_ms, bytes }`.
- `mode: 'patch'` reuses the frame; `'replace'` remounts.

- [ ] **Step 1:** Failing isolation tests (permanent corpus, grows and never shrinks) — parent DOM access, `top.location`, `document.cookie`, `localStorage`, `fetch` to localhost, and form submission all fail from inside the frame.
- [ ] **Step 2:** Failing bridge tests — only allowlisted message names cross; an unknown message is dropped and logged; the host never evaluates frame-supplied code.
- [ ] **Step 3:** Implement with `sandbox="allow-scripts"` (no `allow-same-origin`) and the CSP from design W0 §4.
- [ ] **Step 4:** Render errors captured and returned in `ui_result.errors`; 10s timeout tears the frame down with `ok: false`.
- [ ] **Step 5:** Enforce the 512 KB payload bound client-side.
- [ ] **Step 6:** `pnpm --filter harness-web test`

### Task 2.2: Plot shell

**Files:**
- Create: `web/widgets/Plot.tsx`, `web/widgets/scale.ts`, `web/widgets/format.ts`
- Test: `web/widgets/plot.test.tsx`, `web/widgets/scale.test.ts`

**Interfaces:**
- Produces: `SeriesData` contract (design W3 §2); shared axes, legend, tooltip, empty/error states, a11y table fallback.

- [ ] **Step 1:** Failing tests — linear/time/category scales and tick selection; unit-aware formatting; `null` renders as a gap not zero; >8 series collapse to "other"; malformed data renders a diagnostic instead of throwing.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `pnpm --filter harness-web test`

### Task 2.3: The marks

**Files:**
- Rewrite: `web/widgets/GenWidget.tsx`
- Create: `web/widgets/{MetricTiles,Bar,Line,Area,Scatter,Histogram,Heatmap,Box,Correlation,DataTable,DiffView,FileTree,TermOut,DocView}.tsx`
- Create: `web/widgets/__fixtures__/*.json`
- Test: `web/widgets/widgets.test.tsx`

- [ ] **Step 1:** Failing tests — every kind renders from a fixture; the empty, single-point, all-null, huge (10k rows), and malformed fixtures each render without throwing; bar baselines at zero unless opted out, and opting out draws the axis-break marker; series colours are stable across re-render of the same artifact id.
- [ ] **Step 2:** Implement each mark on the `Plot` shell.
- [ ] **Step 3:** `DataTable` — sort, text filter, column pin, virtualization past 500 rows, CSV export of the filtered view.
- [ ] **Step 4:** Delete the placeholder implementations; assert no `<div>…Widget</div>` string survives.
- [ ] **Step 5:** `pnpm --filter harness-web test`

### Task 2.4: Notebook cells

**Files:**
- Create: `web/components/data/NotebookCell.tsx`
- Modify: `web/components/HarnessPython.tsx`, `web/components/HarnessApp.tsx`
- Test: `web/components/notebookCell.test.tsx`

- [ ] **Step 1:** Failing tests — `ExecutionResult.files` image entries render inline and non-image entries render as download chips (today both are discarded); non-zero `exit_code` stays expanded and uses `--st-error`; long stdout truncates with "show all".
- [ ] **Step 2:** Implement the cell; wire `files` capture.
- [ ] **Step 3:** Fix the Pyodide host — pass the profile's `executor.allowed_packages` instead of the hardcoded `[]` at `HarnessApp.tsx:375`, boot lazily with visible progress, run in a worker.
- [ ] **Step 4:** Re-run re-sends as a fresh `ExecuteCode`; edit-and-run routes through the composer as a user message.
- [ ] **Step 5:** `pnpm --filter harness-web test`

---

# Phase 3 — Analyst workbench (W3b)

### Task 3.1: Dataset drawer

**Files:**
- Create: `web/components/data/DatasetDrawer.tsx`, `SchemaCard.tsx`
- Test: `web/components/datasetDrawer.test.tsx`

- [ ] **Step 1:** Failing tests — upload progress and error surfacing; schema card shows dtype, null %, distinct, and mini distribution per column; selecting a dataset injects the path + shape + column list into the next message; untrusted-provenance badge is shown.
- [ ] **Step 2:** Implement against `/datasets`.
- [ ] **Step 3:** Preview grid reuses `DataTable`.

### Task 3.2: Canvas

**Files:**
- Create: `web/components/data/Canvas.tsx`, `web/lib/canvas.ts`
- Test: `web/components/canvas.test.tsx`

- [ ] **Step 1:** Failing tests — pin stores artifact + provenance (session, tool call, generating code); reorder and resize persist; refresh replaces the payload in place; a failed refresh keeps the last good render and shows a staleness badge.
- [ ] **Step 2:** Implement; resolve design open question 3 (storage) and record the choice in the design doc.
- [ ] **Step 3:** `pnpm --filter harness-web test`

### Task 3.3: Export

**Files:**
- Create: `web/lib/export.ts`
- Test: `web/lib/export.test.ts`

- [ ] **Step 1:** Failing tests — table → CSV escapes quotes, newlines, and leading `=` (formula injection); canvas → PNG at 2× device pixel ratio; session → self-contained HTML bundle with no external references.
- [ ] **Step 2:** Implement.

### Task 3.4: Analyst layout

**Files:**
- Modify: `web/app/page.tsx`, `web/components/Workspace.tsx`
- Create: `web/components/chrome/Shell.tsx`

- [ ] **Step 1:** Failing tests — three-pane layout with collapsible left drawer and right workspace; conversation never disappears; below 900 px the workspace becomes a sheet.
- [ ] **Step 2:** Implement; workspace tabs become Artifacts · Surfaces · Canvas.
- [ ] **Step 3:** `pnpm --filter harness-web typecheck && pnpm --filter harness-web test`

---

# Phase 4 — Operator console (W4)

### Task 4.1: Shell routes

- [ ] **Step 1:** `/ops` and `/home` routes under a shared shell that owns one WS connection surviving route changes.
- [ ] **Step 2:** Failing test — navigating between routes does not reconnect the socket.

### Task 4.2: Run board

**Files:** Create `web/components/ops/RunBoard.tsx`; Test `web/components/runBoard.test.tsx`

- [ ] **Step 1:** Failing tests — rows from `GET /runs` with live overlay from `turn_start`/`stats`/`session_end`; `waiting_input` visually distinct from `running`; cancel issues `DELETE /runs/:id`; lanes separate concurrent `run_id`s.
- [ ] **Step 2:** Implement.

### Task 4.3: Approval centre

**Files:** Modify `web/components/ApprovalModal.tsx`; Create `web/components/ops/ApprovalQueue.tsx`

- [ ] **Step 1:** Failing tests — `risk` and `reason` are displayed (including a provenance-gate quote); `danger` requires a distinct gesture in a distinct position from `safe`; queued approvals are not dropped when a second arrives; "always allow" issues `set_approval_mode` and reports what was actually granted when the server clamps it.
- [ ] **Step 2:** Per-tool argument previews: diff for `Write`/`Edit`, command + cwd for `Bash`, resolved host for network tools.

### Task 4.4: Inbox, undo drawer

- [ ] **Step 1:** Failing tests — inbox lists `pending` with TTL countdown, answers via `pending_answer`, keeps expired questions badged; undo drawer groups by run, marks stale entries, and requires `force` with a stated reason.
- [ ] **Step 2:** Implement.

### Task 4.5: Audit table

- [ ] **Step 1:** Failing tests — virtualized rows; filters push to `/audit` and never filter client-side over everything; `tainted=true` filter works; expansion shows the input digest and undo availability.
- [ ] **Step 2:** Implement.

### Task 4.6: Observability + budget

- [ ] **Step 1:** Failing tests — cost/day stacked by profile, tool volume with ok-rate and p95, model mix, stage funnel, routing efficacy from `/stats/routing`; all drawn with the Phase 2 widget kit.
- [ ] **Step 2:** Budget meter during a run; monthly ledger from `/usage`; budget-exceeded rendered as its own terminal state, not a generic failure.
- [ ] **Step 3:** `pnpm --filter harness-web test`

---

# Phase 5 — Assistant surface (W5)

### Task 5.1: Brief

- [ ] **Step 1:** Failing tests — six cards from their endpoints (design W5 §B1); every card has a deliberate empty state; "nothing is waiting on you" renders as content, not as a blank.
- [ ] **Step 2:** Implement `/home`.

### Task 5.2: Memory explorer

**Files:** Create `web/components/assistant/MemoryTimeline.tsx`, `EntityList.tsx`

- [ ] **Step 1:** Failing tests — facts render as bars across their validity intervals; supersession shows the replaced fact greyed with "was believed until…"; an open `valid_to` renders as an ongoing arrow, never an invented end date; `?at=` filters to an instant; untrusted-provenance badge shown.
- [ ] **Step 2:** Implement against `GET /memory`.
- [ ] **Step 3:** Edits issue a `MemoryWrite` tool call through the session — assert no REST write path exists.

### Task 5.3: Trigger console

- [ ] **Step 1:** Failing tests — cron/watch/poll listed with last fire, next fire, and the fire/skip ratio with skip reasons; a poll that skipped 287 times and fired once reads as healthy, not idle.
- [ ] **Step 2:** Implement read-only against `GET /triggers`.

### Task 5.4: Skills queue + channels

- [ ] **Step 1:** Failing tests — proposed skills list, content view, edit, promote, discard (recoverable), matching TUI semantics; channels show binding state and degraded capabilities.
- [ ] **Step 2:** Implement over the existing `skills_*` protocol messages.

### Task 5.5: Docs + deployment

- [ ] **Step 1:** `docs-site/architecture.md` — update the system map with the read API layer, surface host, and the three faces.
- [ ] **Step 2:** Web deployment story: `vercel.json` currently builds docs only; document (or add) the web build target and note that the web client requires a reachable harness server and an origin allowlist entry.
- [ ] **Step 3:** Screenshots in the docs site for each face.

---

## Validation checklist

- [ ] A third-party page cannot open a usable WS session (origin rejection test).
- [ ] `hello { yolo: true }` grants nothing.
- [ ] The Go TUI and CLI work unchanged against the hardened server.
- [ ] Every `ServerMessage` variant is handled or explicitly ignored; adding a variant breaks the build.
- [ ] No placeholder widget remains; every kind renders from fixtures including malformed input.
- [ ] Generated surfaces fail every escape-attempt test in the corpus.
- [ ] Matplotlib output produced by `ExecuteCode` is visible in the browser.
- [ ] A CSV can be uploaded, profiled, analysed, charted, pinned, and exported without leaving the browser.
- [ ] Reload preserves the transcript.
- [ ] Two concurrent runs render in separate lanes.
- [ ] `/audit?tainted=true` answers "what did it do in a tainted turn".
- [ ] A fresh install renders every panel as empty, not broken.
- [ ] `pnpm typecheck && pnpm test && ./scripts/check-boundary.sh` green; web typecheck and tests green.
