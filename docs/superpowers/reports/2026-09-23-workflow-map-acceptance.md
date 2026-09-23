# Workflow execution map acceptance report

Date: 2026-09-23. Task: PT-085. Design/specification: PT-084. Primary feature: CORE-11; affected clients: TUI-05, CHAT-04, OPS-03/04.

## Baseline

Before implementation, all baseline checks passed:

| Area | Evidence |
|---|---|
| Root | `pnpm typecheck`; `pnpm test`: 206 files passed, 1 skipped; 1,351 tests passed, 3 skipped. |
| Web | `pnpm --dir web typecheck`; `pnpm --dir web test`: 34 files, 176 tests passed. |
| TUI | From `tui/`, `GOCACHE=/tmp/base-go-cache go test ./...`: 8 packages passed. |

PT-082 remained dirty and in progress. Its shadow period and live-provider accuracy were not part of this work.

## Acceptance matrix

| ID | Result | Evidence |
|---|---|---|
| WM-01 | Pass | Projection tests cover exact scope, event ID dedupe, monotonic server revision, recovery snapshots/events, validation, independent retention limits, 32 completed-run retention, and completion without a fabricated observation. A later focused run passed projection + mounted WS files: 2 files, 8 tests. |
| WM-02 | Pass | Runner and branch tests assert actual retry/skip/fail-back/reroute, sequential parent linkage, claim re-entry, exploratory execution, cancel/error/budget closure, observer isolation, and flat-loop behavior. Latest pre-WS focused set: 7 files, 76 tests. Mounted fixture additionally covers a real workflow and flat run. |
| WM-03 | Pass | Deterministic router, edge, and claim tests distinguish shadow suggestions from applied advice; the runner test proves an actual exploratory-tier attempt remains connected. Separate shadow-comparison calls do not emit actual map attempts. |
| WM-04 | Pass | `tests/workflow-map-ws.test.ts`: 3 tests pass for exact-scope observer updates, terminal history replay, wrong-scope rejection without map leakage, and a completed REST `/run` recovered from a separate WebSocket. |
| WM-05 | Pass | The mounted test restarts the isolated server, recovers the known run identity, and receives `unavailable/server_restarted` with no stale attempts or edges. |
| WM-06 | Pass | Read API tests verify additive legacy-compatible routing stats, server-wide profile/time filtering, sample scope, empty data, and suggestions. The selected-run client keeps aggregates separate from map scope. |
| WM-07 | Pass | Web reducer/component tests cover exact turn/run attachment, reconnect/gap handling, stale run rejection, actual/advice labels, cost states, partial history, and accessibility. TUI state/protocol tests cover stale scope and bounded/deduplicated history. |
| WM-08 | Pass | Isolated browser command `pnpm --dir web exec playwright test --config playwright.client-acceptance.config.ts -g "WM-08"`: 1 passed in 14.9s. Browser confirmed the mounted fixture's actual workflow path, Chat reconnect, exact selected-run Ops map, and flat-profile suppression. Shadow-advice labeling and gap-recovery behavior were browser-injected reducer cases, not live runner decisions. Screenshots: `/tmp/base-workflow-map-chat-desktop.png`, `/tmp/base-workflow-map-chat-narrow.png`, `/tmp/base-workflow-map-ops-selected.png`. |
| WM-09 | Pass | `GOCACHE=/tmp/base-go-cache go test ./...` from `tui/`: all 8 packages passed, including decoder, state, rendering, keyboard, and retention coverage. |
| WM-10 | Pass | From `tui/`, `HARNESS_TUI_PTY=1 GOCACHE=/tmp/base-go-cache go test ./acceptance -run WorkflowMap -count=1 -v`: `TestWorkflowMapPTYCompactDetailsCloseAndReconnect` passed (12.05s). It covers compact output, expand/details, Escape close, reconnect and recovered details. |
| WM-11 | Pass | Final command results are listed below. |
| WM-12 | Pass | This report records baseline, exact post-change results, local runtime/browser/PTY evidence, and remaining external acceptance boundaries. |

## Final validation

| Command | Result |
|---|---|
| `pnpm test` | 209 passed files, 1 skipped (210 total); 1,368 tests passed, 3 skipped (1,371 total), 58.96s. A subsequent cleanup-specific check after one added projection assertion passed 2 files / 8 tests; root typecheck was rerun afterward. |
| `pnpm typecheck` | Passed after all Core and client changes. |
| `pnpm build` | Passed. |
| `node scripts/gen-web-protocol.mjs --check` | Passed, no output. |
| `bash scripts/check-boundary.sh` | Passed. |
| `pnpm --dir web test` | 37 files, 192 tests passed. |
| `pnpm --dir web typecheck` | Passed after the Web build. |
| `pnpm --dir web build` | Passed; Next.js static build completed for all routes. |
| `GOCACHE=/tmp/base-go-cache go test ./...` (`tui/`) | Passed, 8 packages. |
| `HARNESS_TUI_PTY=1 GOCACHE=/tmp/base-go-cache go test ./acceptance -run WorkflowMap -count=1 -v` (`tui/`) | Passed; 1 real-PTY test. |
| `gofmt -d` on all changed Go files | Passed; no formatting diff. |
| `git diff --check` | Passed on the final working tree. |

The root Vitest run emitted the existing `node-cron` missing-sourcemap warning and exited successfully. During the isolated browser flow, a transcript read returned 404 for a newly created fixture session; the read path was unchanged and the cause was not established. It did not affect workflow-map assertions. This remains an unrelated client acceptance limitation, not a map result.

`bash scripts/check-boundary.sh` passed with one narrow allowlist entry for the pre-existing unchanged `src/decisions/workflow.ts` assistant-role/context vocabulary; the guard had flagged generic `assistant` terms, not product coupling. No source boundary finding was hidden or silenced.

## Implementation and acceptance boundary

The implementation adds a bounded process-local projection with authoritative revisions, exact run/session/profile scope, safe allowlisted observations, explicit overflow/restart states, and recovery for interactive, REST, and trigger-backed workflows. It keeps routing aggregates server-wide and profile/time scoped. Web Chat/Ops and TUI show actual execution separately from shadow advice. Execution and routing policy remain unchanged; the runner gained observation hooks. No observation is inferred from session route labels or telemetry.

Automated, mounted fake-provider, isolated browser, and real-PTY checks passed. No paid/live provider run, deployment, release, real-profile PT-082 shadow period, or user acceptance occurred. PT-082 remains in progress; this report does not recommend enforcing routing advice.
