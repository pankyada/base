# Verifiable agent work — implementation plan

Generated: 2026-09-05
Complexity: High; multi-sprint program.
Spec: ../specs/2026-09-05-verifiable-agent-work-design.md
Builder/tester: GPT-5.6 Luna. Independent review: deferred by user.

## Execution contract

Implement every requirement R1–R11. Do not stop after foundations, schemas or helper
tests: each increment must reach real runtime and user-facing entrypoints. Spec is
source of truth. Reuse current uncommitted Studio/bulletin work and existing runtime.
No deployment, push, destructive reset, unrelated cleanup or reviewer delegation.

Primary agent wrote spec/plan and coordinates only. All code, builds, tests and
acceptance evidence belong to Luna. Use same Luna agent across sequential sprints.
No larger-model implementation fallback. If extra agents are necessary, use only
GPT-5.6 Luna and partition disjoint files; default single builder avoids conflicts.

Before edits record git HEAD/status, tracked diff and untracked inventory outside
repo in task-specific temporary directory; preserve existing work. Never commit
pre-existing dirty hunks as new work. Use small commits when task changes separable;
otherwise retain explicit uncommitted patch inventory and report why. Full core
suite before any commit. Never stage node_modules, generated browser output,
embedded worktrees, graph outputs or unrelated documentation. No automatic main merge.

## Sprint 0 — Baseline and delivery ledger

Coordination update: lead `/root/luna_implementation` retains shared runtime,
protocol and client integration plus R1–R4 and R7–R11. Parallel GPT-5.6 Luna builder
`/root/luna_replay_eval` owns R5/R6 modules, dedicated new entrypoint/UI modules and
focused tests. Helper sends shared-file wiring requests to lead; no overlapping
edits to main server/protocol/schema/client reducers. Lead owns final integrated
acceptance. Independent review remains deferred.

- S0.1 Read spec, ROADMAP, ADR, CLAUDE and relevant source. Snapshot dirty baseline.
  Location: repository + external temporary snapshot. Depends: none.
  Acceptance: existing Studio files preserved; task-owned change inventory possible.
- S0.2 Run baseline commands below; record exact failures/counts. Create
  docs/superpowers/reports/2026-09-05-verifiable-agent-work-implementation.md with
  R1–R11 status matrix, sprint status, commands, evidence paths and limitations.
  Depends: S0.1. Acceptance: baseline failures distinguished from introduced failures.

## Sprint 1 — Honest charts and usable observability (R1, partial)

- S1.1 Define and test heatmap/box/correlation shapes, missing data and invalid states.
  Location: web/widgets/{Heatmap,Box,Correlation}.tsx and widget tests. Depends: S0.
- S1.2 Implement real SVG renderers with kit scales, labels and accessible summaries.
  Depends: S1.1. Acceptance: values represented graphically with correct missing data.
- S1.3 Replace primary JSON observability with metrics/tables and wire real aggregate
  inputs through web/app/ops/page.tsx and web/components/ops/Observability.tsx.
  Depends: S0. Acceptance: cost, latency, success, models and stages reflect fixtures.
- S1.4 Browser demo all charts and ops data/empty/error states. Depends: S1.2–3.
  Tests: widget units, web typecheck/build/e2e. Save screenshots/evidence paths.

## Sprint 2 — Reliable records (R2)

- S2.1 Add atomic JSON writer + revision semantics and interruption/corruption tests.
  Location: src/shared/, tests/. Depends: S0. Acceptance: previous record survives failure.
- S2.2 Centralize paths and integrate session/run stores; exact ids and isolated errors.
  Location: src/session/{store,user-paths}.ts, src/runs/store.ts. Depends: S2.1.
- S2.3 Add recoverable per-user history index, deterministic sorting/pagination and
  legacy reads. Wire existing history APIs. Depends: S2.2.
  Demo: corrupt one record/delete index, list healthy newest-first history, reload.
  Tests: store, REST/read API, restart, stale revision and user isolation cases.

## Sprint 3 — Missions and evidence (R3)

- S3.1 Add versioned mission/evidence/receipt types, schemas, storage and validators.
  Location: src/missions/ (new), src/profiles/schema.ts, src/session/user-paths.ts.
  Depends: S2. Validate legacy/default-off behavior and forged evidence rejection.
- S3.2 Emit receipts at actual tool boundary and connect structured mission results
  to workflow exit. Location: src/loop/, src/tools/, src/workflow/{runner,artifacts}.ts.
  Depends: S3.1. Failing command cannot become verified through prose.
- S3.3 Add mission create/status and explicit human-criterion resolution via existing
  server/CLI/protocol seams; generate browser protocol and mirror Go messages.
  Location: src/types.ts, src/server/, src/cli/, scripts/gen-web-protocol.mjs,
  web/lib/, tui/internal/protocol/. Depends: S3.2.
- S3.4 Web mission card + TUI receipt view; restart receipt demonstration.
  Location: existing web components and tui overlays. Depends: S3.3.
  Tests: schema, validator, real loop fixture, protocol, browser and Go behavior.

## Sprint 4 — Live session handoff (R4)

- S4.1 Implement server-owned session runtime/event journal/controller lease.
  Location: src/server/session-runtime.ts (new), src/server/index.ts. Depends: S2–3.
  Test sequencing, retention gap, stale controller and cleanup in isolation.
- S4.2 Move existing execution ownership onto registry; route observers/controller
  through same runtime. Persist lifecycle; waiting work survives disconnect safely.
  Depends: S4.1. Test real two-socket disconnect/approval race and restart state.
- S4.3 Wire subscribe/snapshot/transfer in web, TUI and Studio sockets/reducers.
  Location: src/types.ts, web/lib/, tui/internal/, studio/src/{net,scene,ui}/.
  Depends: S4.2. Demo three clients see same run; one valid controller; catch-up correct.
  Tests: protocol integration, Go, Studio, real browser with local fixture server.

## Sprint 5 — Playback and branch experiments (R5)

- S5.1 Persist versioned run journal/config fingerprints and effect state receipts.
  Location: src/runs/, src/loop/, src/tools/. Depends: S3–4.
  Tests crash/unknown effect, hashes, redaction, bounded import and owned paths.
- S5.2 Implement zero-execution playback and isolated checkpoint branching with
  exact fixture matching and normal effect gates. Location: src/replay/ (new).
  Depends: S5.1. Tests spies, divergence, stale fixtures, parent isolation.
- S5.3 CLI replay/branch/export plus existing history view playback/branch controls.
  Depends: S5.2. Demo replay makes no tool/model calls, branch comparison shows lineage.

## Sprint 6 — Evaluation lab (R6)

- S6.1 Dataset/experiment schema and persistent store; explicit capture-from-mission.
  Location: src/evaluation/ (new), src/session/user-paths.ts. Depends: S3, S5.
- S6.2 Fixture runner, deterministic evaluators, budget/cancel handling, comparison
  metrics, held-out split and promotion thresholds. Depends: S6.1.
  Test intentional regression, missing results, learning split exclusion.
- S6.3 CLI eval commands and web experiment comparison in current workspace.
  Depends: S6.2. Demo baseline/candidate on same cases, failed gate blocks promotion.
  Tests integration plus browser; optional live judge remains separately labelled.

## Sprint 7 — Memory conflict desk (R7)

- S7.1 Add optional claim/source metadata in shared interface, FS and graph providers.
  Location: src/memory/{interface,fs-memory,graph-memory,temporal,query}.ts.
  Depends: S2–3. Test provider conformance and legacy temporal semantics.
- S7.2 Conflict detection, affected-evidence references and audited resolution.
  Location: src/memory/conflicts.ts (new), memory tools. Depends: S7.1.
  Test overlap/nonoverlap, stale revision, taint and cross-user cases.
- S7.3 Existing memory UI shows claims, conflict timeline/sources and resolution.
  Depends: S7.2. Demo conflict resolution persists and dependent mission evidence stale.

## Sprint 8 — Action rehearsal (R8)

- S8.1 Optional preview contract and file/memory preview implementations.
  Location: src/tools/types.ts, builtin write/edit/delete/memory tools, src/rehearsal/.
  Depends: S2–3. Test zero mutations and opaque unsupported tools.
- S8.2 Proposal store/apply with precondition hashes and exact normal gate path.
  Depends: S8.1. Test stale resources, tampered input, denial and taint bypass attempts.
- S8.3 Wire proposal cards into existing web/TUI approvals and receipt/undo links.
  Depends: S8.2. Demo preview/cancel/apply/stale rejection without a new approval engine.

## Sprint 9 — Learning from corrections (R9)

- S9.1 Outcome-aware reflection/mining input with bounded correction/tail/evidence
  sampling. Location: src/improver/default-improver.ts and tests. Depends: S3, S6.
- S9.2 Explicit correction creates scoped diff/proposal, base hash and evaluation
  case refs. Extend src/skills/{manage,commands}.ts and proposal metadata.
  Depends: S9.1. Test unauthorized source and stale base rejection.
- S9.3 Connect evaluation-gated explicit promotion, version rollback and existing
  skills queue/TUI controls. Depends: S9.2. Demo fail blocks, pass enables user action.

## Sprint 10 — Refreshable artifacts and Canvas completion (R10, rest of R1)

- S10.1 Owned artifact recipe/version store and real generating lineage at emission.
  Location: src/artifacts/ (new), src/types.ts, executor/loop event seams. Depends: S3.
- S10.2 Reuse watch/poll for explicit recipe refresh, cursor coalescing and last-good
  versioning; integrate budget/gates. Location: src/triggers/, src/artifacts/.
  Depends: S10.1, S8. Test unchanged zero model calls, errors and loop suppression.
- S10.3 Wire explicit pin/promote and working refresh in Workspace/Canvas, accurate
  sources, version diff and exports. Location: web/components/{Workspace,data/Canvas}.tsx,
  web/lib/{canvas,export}.ts. Depends: S10.2.
  Demo successful refresh, failed stale retention, source deletion, restart and export.

## Sprint 11 — Studio challenge rounds (R11)

- S11.1 Persist challenge records on existing bulletin/mission seam; bounded state
  machine and evidence validation. Location: src/agents/bulletin.ts, src/missions/.
  Depends: S3–4. Preserve uncommitted bulletin behavior and taint semantics.
- S11.2 Optional mission challenge step with cost/round caps; no automatic spawning
  loops. Route structured challenges through same protocol. Depends: S11.1.
- S11.3 Board/Drawer display challenges, contributions and verification. Observer
  and controller permissions from R4. Location: studio/src/scene/, studio/src/ui/.
  Depends: S11.2. Demo unresolved challenge -> needs_human, valid receipt resolves.
  This is product functionality, not an independent review of these source changes.

## Sprint 12 — Integrated acceptance and delivery

- S12.1 Run full fixture scenario: create mission, spawn worker, observe across
  clients, rehearse effect, approve once, verify evidence, challenge result, correct
  rule, compare evaluation, explicit promotion, pin artifact, refresh, replay and
  branch. Exercise failure/cancel/restart paths, not only happy path.
  Depends: S1–11. Record browser screenshots, fixture ids and exact commands.
- S12.2 Run final commands, update implementation matrix and operational docs/ADR
  for new load-bearing decisions. Roadmap partial remains partial unless acceptance
  fully earned. No broad rewrite of pre-existing docs. Depends: S12.1.
- S12.3 Report full changed-file/commit inventory, test counts, acceptance evidence,
  known limitations and explicit independent-review-deferred status. Depends: S12.2.

## Test commands

Run from repository root unless indicated:

```sh
pnpm typecheck
pnpm test
bash scripts/check-boundary.sh
node scripts/gen-web-protocol.mjs --check
pnpm --filter harness-web typecheck
pnpm --filter harness-web test
pnpm --filter harness-web build
pnpm --filter harness-web web:e2e
pnpm --filter harness-studio typecheck
pnpm --filter harness-studio test
pnpm --filter harness-studio build
git diff --check
```

From tui/: `GOCACHE=/tmp/base-go-cache go test ./...`.
If baseline package command is broken, fix task-relevant harness or record exact
environment failure; do not silently replace required coverage with fewer checks.
Use targeted tests during atomic patches; full core suite before each commit.

## Risks and rollback

- Dirty overlap: external snapshot + task-owned inventory; no blanket staging/reset.
- Scope: all R1–R11 retained; unfinished items marked incomplete, not renamed done.
- Session ownership migration: additive protocol compatibility, fixture old clients.
- State evolution: explicit versions, legacy reads, reversible backups and index rebuild.
- Effect uncertainty: unknown receipt state cannot trigger automatic duplicate effects.
- Learned behavior drift: held-out evaluation and explicit versioned promotion/rollback.
- UI sprawl: existing shells/panels only; no new layout/style system.
- Environment/model limits: fixture evidence is implementation acceptance; paid model
  quality and independent review are not claimed. No release/deployment in this task.
- Rollback: revert only separable task commits or recorded task-owned patches; keep
  data backups/version history and disable optional feature configuration. Never
  discard pre-existing changes or erase newly generated user records automatically.
