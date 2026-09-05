# R5/R6 replay and evaluation build

## Scope

Built by GPT-5.6 Luna in the R5/R6-owned areas. Shared protocol, server index/REST, profile schema, user paths, main CLI index, client reducers, and unrelated dirty work were left untouched.

## Requirement coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| R5 zero-execution playback | Implemented | `src/replay/index.ts` `playback`; replay test uses executor spy and emits only recorded events |
| R5 event/effect receipts | Implemented | versioned `RunJournal`, hashed events, effect state including `unknown` |
| R5 completed-checkpoint branch | Implemented | `markCheckpoint`, `branch`; copies checkpoint context, new session id, parent lineage, config/profile override |
| R5 isolated branch/original immutability | Implemented | branch deep-copies events/effects and never mutates parent; `branchSession` clones memory/messages |
| R5 fixture exact matching | Implemented | stable tool argument hash, mismatch error, unknown/rejected effect closure |
| R5 explicit reconciliation | Implemented | `reconcileEffect`; unknown cannot match until reconciled |
| R5 bounded untrusted import/export | Implemented | redaction, version/hash/size validation, owned-path `importJournalFromPath` |
| R5 CLI controls | Implemented as additive handler | `src/cli/replay.ts`: playback, export, branch |
| R5 HTTP controls | Implemented as additive router | `src/replay/router.ts`: GET journal, POST playback, POST branch |
| R5 browser control surface | Implemented | `web/app/replay/page.tsx`, `web/components/replay/ReplayPanel.tsx` |
| R6 versioned datasets | Implemented | `EvaluationDataset`, validation, `EvaluationStore` |
| R6 explicit mission capture | Implemented | `captureCaseFromMission` verifies mission/receipt ownership and linkage |
| R6 deterministic fixture experiments | Implemented | seeded deterministic case order; execution callback remains runtime-owned |
| R6 per-case/aggregate metrics | Implemented | correctness, cost, latency, tool errors, human intervention, unavailable cases |
| R6 cancellation/spend ceiling | Implemented | AbortSignal checks and pre-call estimate plus post-result cost ceiling |
| R6 held-out/promotion gate | Implemented | split summaries and incomplete/status/sample/regression checks |
| R6 compare view | Implemented as additive router/UI | `src/evaluation/router.ts`, `web/app/evaluation/page.tsx`, `EvaluationPanel.tsx` |
| R6 CLI controls | Implemented | `src/cli/evaluation.ts`: list, dataset import, run, experiment, compare, gate |

## Verification

Commands run from repository root:

```text
pnpm typecheck                         PASS
pnpm test -- tests/replay-evaluation.test.ts tests/verifiable-work.test.ts
  2 files, 15 tests PASS
pnpm --filter harness-web typecheck    PASS after lead regenerated protocol (`EvidenceRef` now represented as `unknown[]`)
pnpm test                              PASS (133 files, 768 tests; existing sourcemap warning)
pnpm --filter harness-web test         PASS (22 files, 59 tests)
pnpm --filter harness-web build        PASS (existing Pyodide dynamic dependency warnings)
pnpm test -- tests/replay-evaluation-router.test.ts tests/replay-evaluation-cli.test.ts
  PASS (4 tests; actual local HTTP handlers, playback/branch, run/cancel/compare, CLI run/experiment)
pnpm --filter harness-web web:e2e      PASS (4 tests, 4 passed; existing Pyodide/standalone warnings)
Screenshots: `web/test-results/r5-replay-controls.png`, `web/test-results/r6-evaluation-controls.png`.
node scripts/gen-web-protocol.mjs --check PASS
Mounted runtime checks (`HARNESS_PORT=7443`, local `coding` profile): `/health`, `/replay` discovery/playback/branch, `/evaluations/run` completed + cancelled, `/evaluations/experiment`, and persisted `/evaluations` all PASS.
CLI runtime checks: `pnpm dev:cli evaluation run ...` PASS with accuracy `1`; `pnpm dev:cli replay playback ...` PASS with one event.
```

Focused tests cover zero-execution playback, redaction, checkpoint branch divergence, fixture mismatch, unknown effect reconciliation, malformed/oversized imports, cancellation, incomplete promotion blocking, mission capture, and pre-call budget stop.

## Integration instructions

Lead wired async CLI dispatch and awaited evaluation execution router before GET routing. Runtime journaling calls are present at loop/tool boundaries and persist with `ReplayStore`. Evaluation execution loads bounded JSON fixtures through `runFixtureEvaluation` and persists runs/experiments through `EvaluationStore`.

## Remaining gaps

No live model judge is included; deterministic fixture assertions remain the authority for this build. Browser specs (`web/e2e/replay-evaluation.spec.ts`) pass against fixture API responses. Actual mounted local server curls also passed for `/health`, `/replay` discovery/playback/branch, `/evaluations/run` completion/cancel, `/evaluations/experiment`, and `/evaluations` persistence. Runtime journaling is integrated in `src/server/index.ts` for interactive WS turns. Shared REST `/run` and `/stream` execution still lacks journal emission in `src/server/rest.ts`; this is the remaining R5 integration gap if REST-triggered runs must be replayable.
