# Workflow execution map plan

Date: 2026-09-23. Planning/specification: PT-084. Implementation and local acceptance: PT-085.
Primary feature: CORE-11. Affected: CORE-06, TUI-05, CHAT-04, OPS-03/04; roadmap #31 client visibility follow-up.

## Approved design and boundary

Show a conditional live map of observed workflow execution. TUI shows a compact path with keyboard-expand details; Web Chat shows a collapsible map attached to its turn; Ops expands the selected run. Reuse current stage-strip typography, status colors, turn cards, Ops evidence workbench and TUI overlay conventions. No new UI framework or graph package. This is the already approved UX; no further visual approval gate is required unless implementation materially changes it.

Nodes represent observed stage attempts, with playbook, stage, attempt, state, tier/model and known cost. Solid connections represent observed execution order; retry, fail-back and reroute branches appear only when executed. Shadow route/edge/claim recommendations appear as clearly labeled advice, never solid executed paths. Skips and fallbacks remain explicit. Unknown fields stay unknown. Missing workflow activity means no map; configured workflow alone is insufficient. Preserve existing clarification/approval controls; the map is read-only.

Keep routing aggregates distinct from a run map: profile/time-window statistics, sample counts and threshold suggestions belong in Ops evidence details with their actual query scope. Suggestions have no apply control. Existing legacy aggregate clients continue working.

## Source grounding

- `src/workflow/runner.ts` owns actual pass/stage/retry/reroute decisions. Existing stage telemetry carries task/stage IDs and attempts, while `events.onStage` and WS `stage` lack these identities. `Session.workflow_route` can contain a shadow recommendation, so cannot establish actual execution.
- `src/types.ts`, `src/server/turn-runner.ts`, `src/server/session-runtime.ts` and runtime projection/replay provide the transport/lifecycle integration seams. Add observation here; do not introduce a second execution engine or derive a run graph from unrelated global telemetry.
- `src/analysis/routing.ts` already provides `aggregateRouteGraph` and threshold suggestions. `src/server/read-api.ts` currently serves only legacy routing aggregation.
- `web/components/turn/StageStrip.tsx`, `web/lib/reducer.ts`, `web/app/ops/page.tsx`, `tui/internal/protocol/msg.go` and `tui/internal/ui/` are existing presentation seams.
- ADR-22–27 preserve independent stage/intensity/tier, evidence-driven promotion, artifact handoff and recon gate. ADR-88 preserves the existing runner and shadow-first routing. New observation must not alter routing decisions, prompts, providers, budgets or execution authority.

## Preconditions and sequencing

1. Finish the PT-084 acceptance specification before code. It freezes wire/snapshot names, exact retention limits, unsupported/unavailable/empty states and acceptance IDs. The implementation must use its named additive contract; it must not invent a parallel execution engine or durable history store.
2. Record current dirty files and baseline checks. Preserve all PT-082 edits, profile shadow settings and `.DS_Store`; do not reset, stage, commit, push, deploy or invoke paid providers.
3. Read current shared protocol, schema, loop, tool registry, memory interface and session path contracts before modifying their seams. Reuse generated protocol mirrors and source protocol version.
4. TDD: add a failing behavior test for each meaningful increment, then implement. Independent Web and TUI work can start once the shared contract is frozen; integration remains sequential.

## Sprint 1 — Truthful Core observations and bounded recovery

Demo: deterministic workflow emits a scoped map; flat-loop request emits none; snapshot survives an in-process reconnect.

### 1.1 Shared contract and pure bounded projection

Locations: `src/types.ts`, existing runtime projection modules, generated Web/Studio mirrors, new focused projection tests.

Define optional additive workflow observation/snapshot state, identified by run/session/profile plus task/pass and unique attempt/event IDs. Include monotonic sequence/revision, terminal state and explicit truncation/partial-history metadata. Set finite per-run events/nodes and retained-run limits in the spec and test overflow. A snapshot is authoritative for its revision; duplicates and older events are idempotent, unrelated scopes are rejected, and out-of-order gaps trigger recovery or visible partial state. Never silently join two runs or reconstruct removed edges as facts.

Recovery uses existing run ownership and replay/resync machinery where possible. Persist projection only if existing run persistence can do so without inventing a parallel history store. Otherwise explicitly report history unavailable after restart; do not show stale running state or promise durable replay. Old persisted runs and old servers remain usable without maps.

### 1.2 Emit executed path and decision annotations

Locations: `src/workflow/runner.ts`, event interfaces/adapters, `src/server/turn-runner.ts`, focused runner and mounted server tests.

Emit actual pass start, stage start/end/skip, executed transition and terminal outcome at the owning control-flow sites. Capture original IDs before asynchronous callbacks. Report route, edge and claim advice with mode, applied/action distinction, fallback/skip and bounded safe summary. Exclude separate shadow comparison telemetry; keep real executions at exploratory tiers in the actual path with an explicit label. Every abort, failure, budget exit and claim retry closes or explicitly interrupts the current attempt. Bounded structured facts only: no prompt, tool output, credential, raw claim evidence or arbitrary provider error payload.

### 1.3 Transport and recovery integration

Locations: `src/server/session-runtime.ts`, runtime attach/replay paths, generated protocol, server tests.

Wire observations into the same owning run lifecycle as existing stage events. Scoped snapshots/reattach must work for selected Ops runs and chat reconnect without creating a second socket. Verify same run ID with wrong session/profile fails closed; old socket and late completed-run frames cannot alter a new turn. Unknown additive fields/messages remain safe for older clients. Preserve existing stage frames and generic input controls.

Validation: pure red/green projection tests; mounted fake-provider workflow, flat loop, shadow/enforce, retries, reroutes, sequential domains, skip/fallback, cancel/error/budget tests; reconnect, replay overflow, duplicate/out-of-order and cross-scope tests. Regenerate mirrors and run freshness check.

## Sprint 2 — Scoped routing aggregates

Demo: Ops receives legacy statistics plus truthful route-graph aggregates and read-only suggestions from deterministic telemetry.

Locations: `src/server/read-api.ts`, `src/analysis/routing.ts`, Web API types/client and read-API tests. Depends on stable shared types, otherwise independent of UI implementation.

Extend the existing read response additively, preserving legacy keys. Filter using authoritative caller/profile/time scope before aggregation; return explicit scope, sample counts and availability. Session/run selection must not relabel profile-wide aggregates as selected-run data. Test two profiles, time bounds, empty data, insufficient suggestion samples and old response shapes. Do not loosen scope resolution or change existing threshold policy.

## Sprint 3 — Web Chat and Ops map

Demo: production browser shows compact per-turn map and expanded selected-run map for the same fixture; narrow viewport remains readable.

Locations: `web/lib/reducer.ts`, current socket lifecycle and scoped reads, turn components adjacent to `StageStrip.tsx`, `web/app/ops/page.tsx`, Web tests and browser fixtures. Depends on Sprint 1 contract; aggregate panel depends on Sprint 2.

Build one shared accessible map/detail component using ordinary layout/SVG only where helpful. Preserve chat text/tool visibility and expansion choices. Label actual versus shadow without relying on color. Attach map to its run/turn, not the latest global stage. Ops run selection loads only that run's map and rejects stale responses. Distinguish unavailable/unsupported/partial history from empty; reconnect cannot duplicate cards or reset the chosen selection. Render aggregate scope and sample counts separately. Keyboard toggle/focus, long labels, zero cost versus unknown cost and bounded overflow must remain legible.

Validation: reducer/component red/green tests and deterministic browser checks for flat loop, shadow, actual branch, two turns/two scopes, run switching, disconnect/reconnect, retained/expired snapshot, old-server response and desktop/narrow viewports. Existing chat send/input/approval behavior remains exercised.

## Sprint 4 — TUI map and keyboard details

Demo: built TUI in a real PTY shows compact progress, expands selected attempt details, closes cleanly and reconnects to the same run.

Locations: `tui/internal/protocol/msg.go`, `tui/internal/ui/` state/update/view/key handling and tests. Depends on Sprint 1 contract; can run independently of Sprint 3.

Decode additive observations/snapshot fields. Reuse transcript expansion or existing overlay/palette conventions, with a visible discoverable binding rather than stealing composer text keys. Preserve shared navigation on all affected tabs/states. Render bounded attempts and explicit advice/partial/terminal status; plain terminal glyph/text fallback must remain understandable. Reset only when scope/run changes and reject stale observations.

Validation: Go decoder/state/render/key tests for narrow widths, expand/select/close, scrolling, composer focus, approval/input modals, overlay tabs and shared navigation. Deterministic real PTY fixture verifies visible output and keyboard actions; screenshots alone are insufficient for key behavior.

## Sprint 5 — Integration and closeout

Run isolated deterministic fake-provider server using temporary user/session/profile roots and ephemeral or verified free ports. Never start against the user's live state or existing service. Keep fixture artifacts and evidence out of tracked source unless intentionally authored tests. Stop owned processes at closeout.

Required final gates:

- Root: `pnpm test`, `pnpm typecheck`, `pnpm build`.
- Protocol: `node scripts/gen-web-protocol.mjs --check`.
- Boundary: `bash scripts/check-boundary.sh` from repository root.
- Web: `pnpm --dir web test`, `pnpm --dir web typecheck`, `pnpm --dir web build`; focused Playwright workflow-map acceptance under existing browser configuration.
- TUI: from `tui/`, `GOCACHE=/tmp/base-go-cache go test ./...`; build and isolated PTY keyboard/reconnect acceptance. Run gofmt on changed Go files.
- `git diff --check`; review entire diff for unrelated edits and generated-file consistency.

Record exact commands/counts and each spec acceptance ID in a dated report. Distinguish component tests, mounted fake-provider runtime, browser/PTY acceptance and user/live-provider acceptance. A fixture proves rendering and transport behavior, not live Jev quality. PT-082 remains open; no enforce recommendation or release/deployment claim follows from this work.

Update PT-084 when plan/spec complete; PT-085 when its implementation and named local gates pass. Update component/features/roadmap rows and ADR if final recovery/transport decisions introduce a load-bearing contract. Any failed/unavailable gate remains explicit with a linked follow-up, not silently waived.

## Risks and rollback

A configured or shadow-selected playbook is not executed evidence; only runner observations establish the solid path. Retry attempts need unique identity, not stage-name dedupe. Claim re-entry and sequential playbooks must preserve parent relationships. Retention must expose gaps, and aggregate scope cannot follow a selected-run label accidentally. Event display must never expose raw private prompts/evidence. Existing PT-082 runner edits create overlap: apply small patches, review current file before each change.

Rollback is removal of only PT-085 presentation/observation additions while preserving existing stage transport and routing. No profile policy, runtime service, data migration or provider switch is required. No commit/release step is authorized by this plan.
