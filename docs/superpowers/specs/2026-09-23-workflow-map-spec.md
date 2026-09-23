# Workflow execution map acceptance specification

Date: 2026-09-23. Planning/specification task: PT-084. Implementation and local acceptance task: PT-085.

Primary feature: CORE-11. Affected: CORE-06, TUI-05, CHAT-04, OPS-03/04. Roadmap: #31 client-visibility follow-up.

## 1. Scope and invariants

PT-085 adds a read-only map of observed workflow execution. It does not change profile schema, routing policy, prompt construction, providers, budgets, workflow authority, authentication, or the flat agent loop. No package, graph engine, paid-provider run, deployment, commit, push, or release is part of this task.

Only observations emitted from the owning `runWorkflow` / `runWorkflowPass` / `executeStage` control flow establish the actual path. `Session.workflow_route`, `route` telemetry, aggregate telemetry, and current WS `stage` frames must never establish or repair an actual edge: they can be annotations only. In particular, a shadow route, edge, or claim decision remains advice even where its labels resemble the path selected by the existing runner.

No observation may include request text, prompts, artifact/tool body, credentials, raw provider error, raw claim/evidence, or an unbounded free-form value. Allowed summary strings are enumerated labels already used by workflow state plus a bounded fallback reason (maximum 160 UTF-8 bytes).

## 2. Exact additive shared contract

All following TypeScript wire types live in `src/types.ts`, are generated into Web/Studio mirrors, and are mirrored by the TUI decoder. `PROTOCOL_VERSION` remains unchanged: every field/message is optional/additive.

```ts
type WorkflowMapAvailability =
  | { state: 'available' }
  | { state: 'empty' }
  | { state: 'partial'; reason: 'retention_overflow' | 'event_gap' }
  | { state: 'unavailable'; reason: 'unsupported' | 'not_retained' | 'server_restarted' }

interface WorkflowMapScope {
  run_id: string
  session_id: string
  profile: string
}

interface WorkflowMapAttempt {
  attempt_id: string       // runner-created UUID; equals the stage_id for a real stage
  pass_id: string          // runner task_id; parent_pass_id when sequential/rerouted
  parent_pass_id?: string
  playbook: string
  stage: Stage
  attempt: number
  intensity: Intensity
  tier: Tier
  model: string
  state: 'running' | 'done' | 'escalated' | 'skipped' | 'failed' | 'cancelled' | 'budget_exceeded'
  cost_usd?: number        // absent is unknown; 0 is known zero
  duration_ms?: number
  contract_ok?: boolean
  explore?: boolean        // actual execution at an exploratory tier; remains an actual path node
}

interface WorkflowMapTransition {
  transition_id: string    // UUID
  from_attempt_id?: string // omitted only for pass entry
  to_attempt_id?: string   // omitted only for terminal exit
  kind: 'start' | 'continue' | 'retry' | 'promote' | 'fail_back' | 'reroute' | 'skip' | 'claim_reentry' | 'terminal'
}

interface WorkflowMapAdvice {
  advice_id: string        // UUID
  kind: 'route' | 'edge' | 'claim_check'
  mode: 'shadow' | 'enforce'
  applied: boolean
  action?: string
  summary?: string         // bounded label/fallback only
}

interface WorkflowMapObservation {
  event_id: string         // UUID, never reused within a run
  revision: number         // server-assigned, positive, monotonic within scope
  kind: 'pass_started' | 'attempt_started' | 'attempt_updated' | 'transition' | 'advice' | 'terminal'
  scope: WorkflowMapScope
  pass_id?: string
  attempt?: WorkflowMapAttempt
  transition?: WorkflowMapTransition
  advice?: WorkflowMapAdvice
  terminal?: 'completed' | 'failed' | 'cancelled' | 'budget_exceeded' | 'interrupted'
}

interface WorkflowMapSnapshot {
  version: 1
  scope: WorkflowMapScope
  revision: number
  availability: WorkflowMapAvailability
  terminal?: 'completed' | 'failed' | 'cancelled' | 'budget_exceeded' | 'interrupted'
  attempts: WorkflowMapAttempt[]
  transitions: WorkflowMapTransition[]
  advice: WorkflowMapAdvice[]
  retained_from_revision?: number
}
```

The server-to-client additive frame is exactly `{ type: 'workflow_map', snapshot?: WorkflowMapSnapshot, observation?: WorkflowMapObservation }`. Exactly one of `snapshot` or `observation` is present. A `workflow_map` client request is exactly `{ type: 'workflow_map', scope: WorkflowMapScope, after_revision?: number }`; it is a read-only recovery request. Existing `stage`, `runtime`, `attach`, and `runtime_subscribe` shapes and meanings are preserved.

An observation is accepted only when all three scope strings exactly equal the server-owned selected run, session, and profile. A missing map is **empty** only when that selected current run completed in this process without any workflow observation. It is **unavailable** for an old server, an unknown/expired run, a run whose in-process history was evicted, or a process restart. The client must not replace `unavailable` with empty.

## 3. Projection, ordering, recovery, and retention

`WorkflowMapProjection` is server-owned, in-process state. It is keyed by the exact three-value `WorkflowMapScope`; it is not stored in `Session`, `SessionRuntime`, telemetry JSONL, run journals, artifacts, or profile state. A server restart therefore returns `availability: { state: 'unavailable', reason: 'server_restarted' }` for a known retained run identity, and `not_retained` when identity is otherwise unavailable. It never restores a stale running map.

Limits are fixed: retain at most **32 completed/terminal run projections** plus all currently running projections; per run retain at most **128 observations**, **48 attempts**, **96 transitions**, and **48 advice items**. Values above the limits are dropped oldest-first by their own collection, the snapshot becomes `partial/retention_overflow`, and `retained_from_revision` is set. A projection is removed from the completed-run ring only; a running projection cannot be evicted. The limits include advice and exploratory telemetry.

The runner emits an internal observation input with no revision. The projection assigns the next positive `revision` when it accepts that input, then sends the resulting `WorkflowMapObservation`. A snapshot is authoritative at its revision. `event_id` deduplicates equal inputs; an already-seen ID is a no-op. A client that receives a revision greater than its expected next revision must request a snapshot and render partial until that snapshot arrives. A stale snapshot or observation never replaces a newer map, different scope, selected turn, or selected Ops run.

Recovery returns observations strictly after `after_revision` when still retained. Otherwise it returns one snapshot. A request with bad, missing, or mismatched run/session/profile is rejected without data. No client can use a selected run to read profile-wide statistics or a different session. Late events after a terminal observation are ignored. Any runner abort, thrown error, or budget exit closes the current open attempts and emits one terminal observation; process termination is shown as unavailable after restart, not inferred as a normal terminal outcome.

## 4. Runner emission rules

`runWorkflowPass` emits `pass_started` before its first runnable stage. `executeStage` creates the attempt UUID/stage ID before its async loop and emits `attempt_started`, then exactly one `attempt_updated` close. `done`, `escalated`, and `skipped` use the existing observed result. A caught failure closes as `failed`; an abort closes as `cancelled`; a budget exit closes as `budget_exceeded` or leaves the projection terminally `interrupted` only when the current control flow cannot determine the outcome.

The runner emits a `transition` only at its actual branch decision: pass entry, normal continuation, recon retry, tier promotion, fail-back, reroute, skip, claim-check re-entry, and terminal exit. It must preserve `parent_task_id` as `parent_pass_id`; a reroute and a sequential domain pass receive their own pass IDs. It must not synthesize a transition from stage names, analysis telemetry, or a later event.

Route, edge, and claim events create `advice` only. `mode` is the feature mode; `applied` is true only when the existing runner actually used that advice for its existing branch. `action` is the existing bounded action label. `explore: true` records actual execution at an exploratory tier and remains in the solid execution path, labeled “Exploratory tier.” The separate `maybeShadow` comparison runs are excluded from actual map observations. Shadow advice is labeled “Shadow suggestion”; enforce advice that was not applied is labeled “Not applied.”

## 5. Read API aggregates

`GET /stats/routing` preserves every current top-level legacy `aggregateRouting` key. It adds optional `routeGraph`, `suggestions`, and `scope`:

```ts
scope: { server_wide: true; profile?: string; since?: string; until?: string; sample_count: number }
routeGraph: ReturnType<typeof aggregateRouteGraph>
suggestions: ReturnType<typeof suggestRouterThresholds>
```

Telemetry is currently server-wide and has no user ownership filter. The handler applies only the supported requested `profile` and inclusive `since`/`until` time range **before** calling both aggregate functions, and exposes `server_wide: true` so the UI cannot imply an identity scope. `scope` reports the resulting filter and source-event `sample_count`. It does not accept a run or session selector. Selected-run Ops presentation must state that aggregates are server-wide profile/time statistics and show this scope and each aggregate's own sample counts. Empty data returns the legacy empty shape plus `routeGraph.hasData: false` and insufficient/no-data suggestions; it is not an execution map.

## 6. Client requirements

Web Chat attaches one collapsible `WorkflowMap` to the exact run/turn that received the map. Its collapsed summary shows observed status, actual attempt count, and partial/unavailable state. Its expanded view orders real attempts and solid actual transitions; advice is a separate labeled list. It preserves turn text, tools, input/approval controls, other turns, and chosen expansion across a reconnect. A turn with no workflow observations shows no map.

Ops uses the selected run’s map only, expanded by default. Switching runs clears prior scope before requesting the next one; stale responses are ignored. It presents partial/empty/unavailable separately. Routing statistics/suggestions are a separate read-only panel with its returned profile/time/sample scope. It must never call a suggestion an executed route or provide an apply action.

TUI shows a compact one-line observed path in the matching turn/run. A documented non-composer key expands selected-attempt details; Escape closes the detail. It uses labels/glyphs plus color, supports narrow terminals, scroll, reconnect, approval/input modals, overlays, and shared tab navigation. It ignores stale/mismatched map frames. No selected map replaces the generic existing stage display.

## 7. Acceptance matrix

| ID | Required evidence |
|---|---|
| WM-01 | Pure projection tests prove scope rejection, event-ID dedupe, monotonic revision, old snapshot rejection, out-of-order gap/partial state, and all fixed retention limits. |
| WM-02 | Mounted fake-provider workflow proves actual pass/start/close/transition IDs, retry, skip, fail-back, reroute, sequential pass parent linkage, claim re-entry, cancel/error/budget terminal closure, and flat loop has no map. |
| WM-03 | Shadow route/edge/claim and separate comparison-run fixtures prove advice/comparisons never form a solid actual path; real `explore: true` executions remain connected and labeled exploratory tier; `Session.workflow_route` cannot make a map. |
| WM-04 | Recovery tests prove same exact run/session/profile reconnect, snapshot after overflow, late-terminal rejection, wrong session/profile/run rejection, and old server safety. |
| WM-05 | Restart fixture proves history is explicitly unavailable and no running/stale map survives. |
| WM-06 | Read-API tests prove legacy keys byte-for-byte compatible in shape, server-wide profile/time filtering before aggregation, empty data, insufficient suggestions, two profiles, and selected-run UI cannot alter aggregate scope. |
| WM-07 | Web reducer/component tests prove one map per run/turn, reconnect idempotency, run switch stale rejection, actual/advice labels, zero versus unknown cost, overflow, and keyboard accessibility. |
| WM-08 | Deterministic real-browser acceptance uses only `web/playwright.client-acceptance.config.ts` and its isolated fake-provider setup (ports 18831/18832, Next 3012). It covers flat, shadow, branch/retry, two turns, reconnect, selected Ops run, narrow and desktop viewports. It must not use default `playwright.config.ts`, which can write live `~/.harness` state. |
| WM-09 | Go decoder/state/render/key tests cover map frames, narrow width, expand/select/close, scroll, composer focus, approval/input modal, overlay tabs, shared navigation, stale rejection, and reconnect. |
| WM-10 | `HARNESS_TUI_PTY=1 go test ./acceptance -run WorkflowMap` (or a focused named case in `tui/acceptance/pty_test.go`) builds the real TUI against its isolated fixture, drives compact/expand/close/reconnect keys through the PTY, and asserts rendered text. |
| WM-11 | Final commands: `pnpm test`; `pnpm typecheck`; `pnpm build`; `node scripts/gen-web-protocol.mjs --check`; `bash scripts/check-boundary.sh`; `pnpm --dir web test`; `pnpm --dir web typecheck`; `pnpm --dir web build`; `GOCACHE=/tmp/base-go-cache go test ./...` from `tui/`; gofmt changed Go files; and `git diff --check`. |
| WM-12 | PT-085 report records the initial green baseline (root: 206 files/1,351 tests plus 3 skipped; Web: 34 files/176 tests; Go: 8 packages; both typechecks), every actual post-change count/command, and separates automated, mounted, browser, PTY, live-provider, deployment, and user acceptance. |

PT-085 is done only after every applicable row has passing evidence and tracker updates. Fixture/browser/PTY evidence proves local transport and presentation, not provider quality, deployment, or PT-082’s real-profile shadow period. Any unavailable gate remains an explicit follow-up.
