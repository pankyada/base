# Verifiable agent work implementation

Status: all repository-required R1–R11 implementation and integrated acceptance gates pass. External/live model and device quality gates remain outside scope. Builder/tester: GPT-5.6 Luna. Independent review: explicitly deferred.

## Baseline

- Intake commit: `13c9ce0fdfe8f414518faba36e4443631dd979d4`.
- Existing dirty and untracked work preserved; snapshot: `/tmp/base-verifiable-baseline.FwLDb3`.
- `pnpm typecheck`: passed.
- `pnpm test -- --run`: 127 files, 745 tests passed (original intake baseline; distinct from later verification).
- `bash scripts/check-boundary.sh`: passed.
- `node scripts/gen-web-protocol.mjs --check`: passed.

## Delivery matrix

| Requirement | Status | Evidence |
|---|---|---|
| R1 charts/observability/canvas | implemented | SVG heatmap/box/correlation validation, metrics tables, Canvas pin/source tracking, artifact refresh endpoint and browser surface. Fixture browser acceptance passed; external/live source quality remains outside repository gate. |
| R2 atomic records/history | implemented | Atomic session/run/artifact/replay writes, exact IDs, revision conflicts, corruption isolation, history pagination, and focused persistence acceptance. Multi-process stress is outside required local gate. |
| R3 missions/evidence/receipts | implemented | Executor `onEvidence` after tool return, authenticated evidence/criterion validators, durable receipts, REST/WS/CLI mission entrypoints, Web/TUI mission state. Core mission/REST tests pass. |
| R4 live sessions/handoff | implemented | Server-owned runtime registry, subscribe/snapshot sequence recovery, observer restrictions, controller lease/transfer/release, reconnect cleanup, deduplicated responses, Web/Studio reducers. Real local server two-WebSocket acceptance passed: observer snapshot, observer mutation denial, first-client disconnect, second-client control claim. |
| R5 playback/branches | implemented | Durable ReplayStore journals at interactive and REST `/run`/`/stream` seams, token/tool/effect/evidence/session events, zero-execution playback, fixture hashes, reconciliation, branches, redacted import/export, CLI and REST routes, Web playback/branch browser acceptance. |
| R6 evaluation lab | implemented | Datasets/splits, fixture runs, cancellation/budget, summaries/comparison/gates, durable stores, async CLI/REST routes, Web run/cancel/summary browser acceptance. Paid/live model quality is a user-owned gate and is not required for repository acceptance. |
| R7 memory conflicts | implemented | Claim metadata persisted by FS/Graph providers, durable per-user conflict detect/list/resolve REST desk with audited revision checks, dependent mission evidence invalidated to `needs_human`, Web timeline/source/resolution UI, cross-user isolation acceptance. |
| R8 action rehearsal | implemented | File and memory proposal preview/apply with hashes/preconditions, denial/stale states, Web approval preview and TUI `PROPOSED EFFECT` modal use normal approval path; existing TUI mission receipt and undo overlays remain the apply evidence path. |
| R9 correction learning | implemented | Correction proposals, failed-evaluation promotion block, passing evaluation gate, stale-base checks, explicit promotion/rollback/reflection REST paths, existing skill queue integration. Automatic promotion remains forbidden; operator action is required. |
| R10 refreshable artifacts | implemented | Recipe/version/lineage/last-good store, owned file dependency resolver, stored generator adapter, budget/approval/taint gates, REST refresh route, Canvas refresh callback/source tracking, exact-origin CORS/preflight, and active WS user-scoped Workspace REST URLs. Mounted browser acceptance passed pin -> refresh -> reload -> delete source -> stale retention. |
| R11 Studio challenges | implemented | Persisted bounded ChallengeDesk, evidence-required answers from authenticated mission evidence, WS list/open/answer restrictions, Studio Board challenge queue/actions and reducer acceptance. Local browser acceptance answered through Studio: bad evidence surfaced exact rejection; unresolved answer updated challenge and mission to `needs_human`. |

## Sprint ledger

- S0 baseline: complete.
- S1–S11: implementation complete for listed repository paths; all required local/runtime/UI acceptance rows pass.
- S12 integrated acceptance: repository suite and local Web/Studio/runtime flows complete; external deployment review remains deferred per instruction.

## Verification

- `pnpm typecheck`: passed.
- `pnpm test -- --run`: 138 files, 787 tests passed (current verification; baseline remains 745; includes REST CORS, R9 API lifecycle, R9 failed-evaluation, R10 stored-recipe, and conflict/runtime acceptance tests).
- `pnpm test -- --run tests/memory-conflict-rest.test.ts tests/verifiable-work.test.ts`: 2 files, 12 tests passed.
- `pnpm test -- --run tests/rest.test.ts tests/artifact-rest-runtime.test.ts tests/verifiable-work.test.ts`: 69 tests passed, including REST CORS/preflight, REST `/run` journal -> playback, stored-recipe refresh, and failed-evaluation promotion block.
- `pnpm --filter harness-web typecheck`: passed.
- `pnpm --filter harness-web test -- --run`: 23 files, 61 tests passed.
- `pnpm --filter harness-web build`: passed (existing Pyodide critical-dependency warning).
- `CI=1 NEXT_PUBLIC_HARNESS_HTTP_URL=http://localhost:7444 NEXT_PUBLIC_HARNESS_WS_URL=ws://localhost:7444 pnpm exec playwright test e2e/artifact-canvas-runtime.spec.ts`: 1 test passed against mounted REST runtime; pin, refresh, reload, source deletion, stale retention.
- `CI=1 pnpm --filter harness-web web:e2e`: 7 tests passed with isolated runtime fixture setup, including replay/evaluation, widgets, surface escape, Canvas fixture, and mounted REST Canvas runtime.
- Local `HARNESS_PORT=17437 pnpm dev:server profiles/data.yaml` plus two `ws` clients: passed observer attach/snapshot, observer mutation denial, disconnect lease release, reconnect control claim.
- Local `HARNESS_ALLOWED_ORIGINS=http://localhost:5173 HARNESS_PORT=7337 pnpm dev:server profiles/data.yaml` + Vite Studio + Playwright: challenge question rendered; bad evidence returned `evidence-required challenge needs receipt evidence`; unresolved answer rendered and mission changed to `needs_human`.
- `pnpm --filter harness-studio typecheck`: passed.
- `pnpm --filter harness-studio test -- --run`: 2 files, 4 tests passed.
- `pnpm --filter harness-studio build`: passed.
- `pnpm --filter harness-web build`: passed; existing autoprefixer, Pyodide dynamic dependency, and standalone Next warnings only.
- `GOCACHE=/tmp/base-go-cache go test ./...` from `tui/`: passed.
- `git diff --check`: passed.
- REST correction acceptance: `pnpm exec vitest run tests/r9-correction-acceptance.test.ts tests/rest.test.ts`: 2 files, 58 tests passed, including non-operator rejection and explicit rollback route.

## Final raw evidence

Final affected-path rerun status: all commands exit 0. Full root test: 138 files / 787 tests. Web: 23 files / 61 tests. Studio: 2 files / 4 tests. Full Playwright: 7/7 passed with isolated runtime fixture setup. Raw logs: [/tmp/base-verifiable-final-20260905/status-final.log](/tmp/base-verifiable-final-20260905/status-final.log), [/tmp/base-verifiable-final-20260905/core-test-final.log](/tmp/base-verifiable-final-20260905/core-test-final.log), [/tmp/base-verifiable-final-20260905/web-e2e.log](/tmp/base-verifiable-final-20260905/web-e2e.log), [/tmp/base-verifiable-final-20260905/studio-test-final.log](/tmp/base-verifiable-final-20260905/studio-test-final.log), [/tmp/base-verifiable-final-20260905/go-test-final.log](/tmp/base-verifiable-final-20260905/go-test-final.log), [/tmp/base-verifiable-final-20260905/boundary-final.log](/tmp/base-verifiable-final-20260905/boundary-final.log), [/tmp/base-verifiable-final-20260905/protocol-final.log](/tmp/base-verifiable-final-20260905/protocol-final.log), [/tmp/base-verifiable-final-20260905/diff-check-final.log](/tmp/base-verifiable-final-20260905/diff-check-final.log).

## Changed-file inventory

- Core runtime: loop evidence lineage, server REST/WS mission/challenge/runtime/artifact wiring, replay/evaluation routes, memory conflicts, rehearsal, corrections, missions, artifact runtime, persistence helpers.
- Surfaces: Web replay/evaluation/canvas/observability/memory/mission panels, active-user REST scoping, CORS browser access, Studio challenge queue and mission/error feed, TUI approval preview.
- Verification: core, REST, persistence, replay/evaluation, artifact, memory, mission, correction, Studio, Web, browser, and TUI tests plus generated protocol checks.
- No commits, push, deploy, reset, or independent review performed; pre-existing dirty/untracked work preserved.

No deployment, push, destructive reset, or independent review performed.
