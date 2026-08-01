# Adaptive Workflow Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Design: [`docs/superpowers/specs/2026-08-01-adaptive-workflow-routing-design.md`](../specs/2026-08-01-adaptive-workflow-routing-design.md)

**Goal:** Replace the single-model flat agent loop with a staged pipeline
(`recon → plan → design → build → verify → review`) whose per-stage *intensity*
is chosen by a cheap triage model on evidence, whose per-stage *model tier* is
chosen by a routing policy that escalates on observed failure, and whose
telemetry can answer "which model tier is actually needed for which kind of
work" without selection bias. Generic across profiles: stages are abstract,
playbooks specialise them.

**Architecture:** New `src/workflow/` module owns the stage state machine; new
`src/analysis/` owns aggregation. Existing modules take additive changes only:
`src/profiles/schema.ts` (two optional blocks), `src/types.ts` (optional
telemetry fields), `src/loop/agent-loop.ts` (optional `opts.modelId` /
`opts.stage`), `src/server/index.ts` (route through the runner when enabled),
`src/improver/default-improver.ts` (maintain the adaptive table). Project
knowledge reuses the **existing** `project` memory scope and
`GraphMemoryProvider` typed links — no new persistence layer.

**Tech Stack:** TypeScript, Zod, OpenAI SDK, Vitest (existing stack, no new
runtime dependencies).

## Global Constraints

- **Total back-compat.** A profile with no `workflow:` block behaves exactly as
  today. Every new telemetry field is optional; existing
  `~/.harness/telemetry.jsonl` lines must still parse.
- **Degrade, don't fail.** No `models.roles` → all roles resolve to
  `profile.model.id` (pipeline + telemetry still work, single model). Triage
  JSON parse failure → playbook defaults for the task class. Playbook missing →
  built-in `generic` playbook.
- **Intensity 0 means no LLM call.** Skipped stages must cost nothing.
- **Stage handoff is artifacts, never transcripts.**
- **`recon` intensity ≥ 1 always, and always first.** `plan`/`design` may never
  run before a completed `recon`.
- Budget enforcement (`max_usd_per_task`, `max_stage_retries`,
  `max_stage_minutes`) is checked before every stage attempt; exhaustion falls
  back to a plain single-loop run and logs why.
- No WS protocol change before Phase 5.
- Every phase ends green: `pnpm typecheck && pnpm test`.

---

# Phase 0 — Observability (no behaviour change)

Ships stage-tagged telemetry, outcome events, and the deferred labeler, with a
static routing table and no adaptivity. This is the dataset the later phases
need; it must be able to run for two weeks on its own.

### Task 0.1: Telemetry schema extension

**Files:**
- Modify: `src/types.ts`
- Modify: `src/telemetry/logger.ts`
- Test: `tests/telemetry-schema.test.ts`

**Interfaces:**
- Produces: `TelemetryEvent` gains optional `task_id`, `stage_id`, `stage`,
  `attempt`, `intensity`, `tier`, `task_class`, `blast_radius`, `playbook`,
  `escalated_from`, `explore`.
- Produces: `kind` union gains `'stage' | 'outcome'`.
- Produces: `StageEvent` and `OutcomeEvent` payload types (see design §6).

- [ ] **Step 1:** Write failing test: an old-shape event (no new fields) round-trips through `logEvent` + `queryEvents` unchanged; a new-shape event with all fields round-trips.
- [ ] **Step 2:** Add the optional fields and the two `kind` values.
- [ ] **Step 3:** Verify `src/telemetry/query.ts` filters still work when fields are absent (`undefined` must not match a filter).
- [ ] **Step 4:** `pnpm typecheck && npx vitest run tests/telemetry-schema.test.ts`

### Task 0.2: Per-call model override in the agent loop

**Files:**
- Modify: `src/loop/agent-loop.ts`
- Test: `tests/agent-loop-model-override.test.ts`

**Interfaces:**
- Produces: `runAgentLoop(..., opts?: { modelId?: string; stage?: StageTag })`
  where `StageTag = { task_id, stage_id, stage, attempt, intensity, tier, task_class, playbook }`.
- The single `model: profile.model.id` call site becomes `opts?.modelId ?? profile.model.id`.
- `estimateCost` and the `kind: 'llm'` `logEvent` call use the same resolved id, and spread `opts.stage` into the event.

- [ ] **Step 1:** Failing test — loop called with `opts.modelId` issues the completion against that id and logs `model` + stage fields; called without `opts`, behaviour and logged fields are byte-identical to today.
- [ ] **Step 2:** Thread `opts` through; do not change any other behaviour.
- [ ] **Step 3:** Confirm `requiresReasoningEffortNone` is evaluated against the *resolved* model id, not `profile.model.id`.
- [ ] **Step 4:** `npx vitest run tests/agent-loop-model-override.test.ts`

### Task 0.3: Profile schema — `models.roles` and `workflow`

**Files:**
- Modify: `src/profiles/schema.ts`
- Test: `tests/profile-workflow-schema.test.ts`

**Interfaces:**
- Produces: `RoleModelsSchema` — `{ cheap?, balanced?, frontier?, critic? }`, each a model id string.
- Produces: `WorkflowSchema` — `enabled`, `playbook`, `min_intensity`, `max_intensity`, `budget`, `routing { policy, explore_rate, shadow_rate, table }`, `knowledge { graph, generalization_probe }`, with the defaults in design §7.1.
- Produces: `resolveRole(profile, role): string` — returns the role's model id, falling back to `profile.model.id`.
- Produces: `Profile` gains optional `models` and `workflow`.

- [ ] **Step 1:** Failing tests — a profile YAML with neither block parses to today's shape; a full block parses with correct defaults; `explore_rate` outside `[0, 0.5]` is rejected; `resolveRole` falls back when a role is unset.
- [ ] **Step 2:** Implement the Zod schemas + `resolveRole`.
- [ ] **Step 3:** Add a `critic`/`build` same-provider warning at load time (warn only, never throw) using `src/models/registry.ts` provider lookup.
- [ ] **Step 4:** `npx vitest run tests/profile-workflow-schema.test.ts`

### Task 0.4: Static stage tagging around the existing loop

**Files:**
- Create: `src/workflow/types.ts`
- Create: `src/workflow/policy.ts` (static half only)
- Modify: `src/server/index.ts`
- Test: `tests/workflow-policy-static.test.ts`

**Interfaces:**
- Produces: `type Stage = 'recon'|'plan'|'design'|'build'|'verify'|'review'`, `type Intensity = 0|1|2|3`, `type Tier = 'cheap'|'balanced'|'frontier'|'critic'`.
- Produces: `resolveTier(profile, stage, taskClass): { tier: Tier; modelId: string; explore: boolean }` — Phase 0 returns the static `routing.table` floor, `explore` always `false`.
- Produces: `newTaskId()` / `newStageId()`.
- Server assigns one `task_id` per user message and tags the (single, unstaged) loop as `stage: 'build'` when workflow is enabled but the runner is not yet built.

- [ ] **Step 1:** Failing test — `resolveTier` returns the table value; falls back to `balanced`→`profile.model.id` when the table omits a stage; unknown role → default model.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Wire `task_id` in `src/server/index.ts`; verify a normal session still runs end-to-end.
- [ ] **Step 4:** `npx vitest run tests/workflow-policy-static.test.ts`

### Task 0.5: Outcome events + deferred ground-truth labeler

**Files:**
- Create: `src/workflow/labeler.ts`
- Modify: `src/server/index.ts` (emit task-close outcome)
- Test: `tests/workflow-labeler.test.ts`

**Interfaces:**
- Produces: `emitTaskOutcome(session, task): void` — writes the `kind: 'outcome'` event at task close with in-band labels (`verify_first_try`, `review_findings`, `rework_count`, `escalations`, `total_cost_usd`, `verdict`).
- Produces: `recordWrittenFiles(task_id, paths: string[]): void` — persisted to `<artifact_dir>/workflow/labels/<task_id>.json`.
- Produces: `sweepDeferredLabels(user, project): Promise<void>` — on session start, for pending tasks in this project, computes `human_edit_churn` via `git diff --numstat` on the recorded files since the task's commit/timestamp and appends a second `outcome` event with the same `task_id`.
- Non-git / non-coding projects: churn is `undefined`; `verdict` comes from the explicit user signal only.

- [ ] **Step 1:** Failing test — a fixture git repo where a task wrote two files, one later edited: `sweepDeferredLabels` emits one deferred outcome with the correct churn; a non-git dir yields `undefined` churn and no crash.
- [ ] **Step 2:** Implement, guarding every git call (never throw into session start).
- [ ] **Step 3:** Call the sweep on session start in `src/server/index.ts`, fire-and-forget.
- [ ] **Step 4:** `npx vitest run tests/workflow-labeler.test.ts`

**Phase 0 exit:** run normal sessions for a period; `~/.harness/telemetry.jsonl`
contains `task_id`-grouped events with stage/tier tags and outcome events.
No user-visible behaviour change.

---

# Phase 1 — The pipeline

### Task 1.1: Playbook loader

**Files:**
- Create: `src/workflow/playbook.ts`
- Create: `.agents/playbooks/coding/PLAYBOOK.md`
- Create: `.agents/playbooks/generic/PLAYBOOK.md`
- Test: `tests/workflow-playbook.test.ts`

**Interfaces:**
- Produces: `resolvePlaybookDirs(): string[]` — same four levels as `src/skills/loader.ts` (user / git root / parent / CWD), most specific wins.
- Produces: `loadPlaybook(name): Playbook` where `Playbook = { name, stages: Stage[], task_classes: string[], defaults: Record<string, IntensityMap>, contract(stage, intensity): StageContract }`.
- Produces: `StageContract = { required_sections: string[]; exit_criteria: string; prompt: string }`.
- `generic` playbook is bundled and always resolvable.

- [ ] **Step 1:** Failing test — frontmatter parse, per-stage/per-level contract lookup, four-level precedence, missing playbook falls back to `generic`, malformed `PLAYBOOK.md` falls back with a warning rather than throwing.
- [ ] **Step 2:** Implement the loader, reusing the gray-matter approach in `src/skills/loader.ts`.
- [ ] **Step 3:** Author the `coding` playbook from design §1.2 / §7.2 and the 4-stage `generic` playbook.
- [ ] **Step 4:** `npx vitest run tests/workflow-playbook.test.ts`

### Task 1.2: Triage

**Files:**
- Create: `src/workflow/triage.ts`
- Test: `tests/workflow-triage.test.ts`

**Interfaces:**
- Produces: `triageA(request, playbook, openai, profile): Promise<{ task_class, recon_intensity }>`.
- Produces: `triageB(request, reconArtifact, playbook, openai, profile): Promise<TaskPlan>` where `TaskPlan = { task_class, blast_radius, reversibility, intensity: Record<Stage, Intensity>, confidence, why }`.
- Both run on `resolveRole(profile, 'cheap')`, non-streaming, JSON-only, small max tokens.
- Produces: `clampIntensity(plan, workflow): TaskPlan` — applies `min_intensity`/`max_intensity`; `recon` clamped to ≥1 unconditionally.
- Triage-A caching keyed by `(playbook, normalized request fingerprint)`, TTL-bounded, advisory only.

- [ ] **Step 1:** Failing tests — valid JSON parses; malformed JSON falls back to `playbook.defaults[task_class]`; clamping honours min/max; `recon: 0` is always raised to 1; the cheap role model id is the one used.
- [ ] **Step 2:** Implement with a strict Zod parse of the model output.
- [ ] **Step 3:** Log both triage calls with `stage: 'triage'` telemetry tags including predicted intensities (needed later for calibration).
- [ ] **Step 4:** `npx vitest run tests/workflow-triage.test.ts`

### Task 1.3: Stage artifacts

**Files:**
- Create: `src/workflow/artifacts.ts`
- Test: `tests/workflow-artifacts.test.ts`

**Interfaces:**
- Produces: `writeArtifact(profile, session, stage, body, meta): string` — `<artifact_dir>/workflow/<session_id>/<stage>[.attempt].md` with gray-matter (`stage`, `intensity`, `tier`, `model`, `confidence`, `contract_ok`).
- Produces: `validateArtifact(body, contract): { ok: boolean; missing: string[] }` — required-section presence check.
- Produces: `buildStageContext(request, priorArtifacts, contract, graphSlice): string` — the seed prompt for a stage; **never** includes prior transcripts.

- [ ] **Step 1:** Failing tests — write/read round-trip; missing required section reported; `buildStageContext` includes prior artifact bodies and the contract but no `session.messages` content.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `npx vitest run tests/workflow-artifacts.test.ts`

### Task 1.4: Stage runner (gates, fail-back, escalation)

**Files:**
- Create: `src/workflow/runner.ts`
- Modify: `src/workflow/policy.ts` (escalation half)
- Test: `tests/workflow-runner.test.ts`

**Interfaces:**
- Produces: `runWorkflow(request, profile, session, context, events, openai, signal): Promise<void>` — the runner: triage-A → recon → triage-B → remaining stages, each via `runAgentLoop` with `opts.modelId` + `opts.stage`.
- Produces: `shouldEscalate(stageResult): { escalate: boolean; reason: string }` implementing the six promotion triggers in design §3.
- Produces: `failBackTarget(stageResult): Stage | null` — a stage may declare a precondition violation naming an earlier stage; re-entry is at `intensity + 1`.
- Budget checked before each attempt; on exhaustion, log an `outcome` with `verdict: 'abandoned'` reason and fall back to a plain `runAgentLoop`.
- Intensity 0 stages are skipped with **no LLM call** and a `kind: 'stage'` event with `intensity: 0`.

- [ ] **Step 1:** Failing tests, with a stubbed loop: happy path runs stages in order and skips L0 stages with zero calls; verify-fails-twice promotes the build tier once and re-runs; contract-unmet-twice escalates; fail-back re-enters the named stage at +1 intensity; `max_stage_retries` terminates; budget exhaustion falls back to the plain loop.
- [ ] **Step 2:** Implement the state machine.
- [ ] **Step 3:** Emit `kind: 'stage'` on every stage close including `escalated_from` and `failed_back_to`.
- [ ] **Step 4:** `npx vitest run tests/workflow-runner.test.ts`

### Task 1.5: Server wiring

**Files:**
- Modify: `src/server/index.ts`
- Modify: `profiles/coding.yaml` (add `models.roles` + `workflow`)
- Test: `tests/workflow-e2e.test.ts`

- [ ] **Step 1:** Failing test — a profile with `workflow.enabled: true` routes a user message through `runWorkflow`; a profile without the block routes through `runAgentLoop` exactly as before.
- [ ] **Step 2:** Wire it; preserve cancel/abort semantics across stages (an abort mid-pipeline must stop the pipeline, not just the current stage).
- [ ] **Step 3:** Update `profiles/coding.yaml` as the first real consumer.
- [ ] **Step 4:** `pnpm typecheck && pnpm test`

---

# Phase 2 — Project knowledge graph

### Task 2.1: Stage-close knowledge extraction

**Files:**
- Create: `src/workflow/knowledge.ts`
- Test: `tests/workflow-knowledge.test.ts`

**Interfaces:**
- Produces: `extractKnowledge(artifact, stage, openai, profile): Promise<{ nodes: KnowledgeNode[]; edges: MemoryLink[] }>` — one cheap-role call; node types and relations per design §5.1.
- Produces: `persistKnowledge(memory, nodes, edges): Promise<void>` — writes to `project` scope via the existing `MemoryProvider.write(scope, key, content, links)`; no new storage.
- Produces: `queryProjectGraph(memory, hints): Promise<string>` — the recon seed slice.
- Skipped entirely when `workflow.knowledge.graph` is false.

- [ ] **Step 1:** Failing tests — extraction output maps to nodes/edges; `persistKnowledge` writes `project` scope with typed links; a new `Decision` conflicting with an existing node emits a `contradicts` edge; extraction failure is swallowed (never breaks a stage).
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Verify against **both** providers (`fs` and `graph`) — links must survive the `fs` frontmatter round-trip too.
- [ ] **Step 4:** `npx vitest run tests/workflow-knowledge.test.ts`

### Task 2.2: Recon gate

**Files:**
- Modify: `src/workflow/runner.ts`, `.agents/playbooks/coding/PLAYBOOK.md`
- Test: `tests/workflow-recon-gate.test.ts`

- [ ] **Step 1:** Failing test — recon artifact lacking a `Prior knowledge` section fails its contract and re-runs; an artifact recording "no prior project knowledge" passes; `plan` never executes before a passing recon.
- [ ] **Step 2:** Seed every recon stage context with `queryProjectGraph` output.
- [ ] **Step 3:** `npx vitest run tests/workflow-recon-gate.test.ts`

### Task 2.3: Generalization probe

**Files:**
- Modify: `.agents/playbooks/*/PLAYBOOK.md`, `src/workflow/knowledge.ts`
- Test: `tests/workflow-generalization.test.ts`

**Interfaces:**
- Review contract at intensity ≥2 requires a `Generalization` section answering "does this apply beyond the immediate scope?".
- A "yes" emits `generalizes_to` edges plus a `Followup` node, and surfaces the follow-up to the user in the review artifact summary.

- [ ] **Step 1:** Failing test — review artifact without a `Generalization` section fails the contract; a "yes" answer produces `generalizes_to` edges and a `Followup` node; a "no" produces neither.
- [ ] **Step 2:** Implement in the playbooks + extraction.
- [ ] **Step 3:** `npx vitest run tests/workflow-generalization.test.ts`

---

# Phase 3 — Adaptivity and analysis

### Task 3.1: Forced exploration

**Files:** Modify `src/workflow/policy.ts`; Test: `tests/workflow-explore.test.ts`

- [ ] **Step 1:** Failing tests, seeded RNG — roughly `explore_rate` of routings deviate one tier (up and down, both directions observed); exploration never fires when `reversibility === 'irreversible'` or remaining budget < 25%; deviating routings are tagged `explore: true`.
- [ ] **Step 2:** Implement with an injectable RNG.
- [ ] **Step 3:** `npx vitest run tests/workflow-explore.test.ts`

### Task 3.2: Paired shadow runs

**Files:** Create `src/workflow/shadow.ts`; Test: `tests/workflow-shadow.test.ts`

**Interfaces:**
- Produces: `maybeShadow(stage, plan, profile, ...): Promise<void>` — for `plan`/`design` only, at `shadow_rate`, runs the cheap tier in parallel with the chosen tier and has the `critic` role judge the two artifacts **blind** (order randomised, tiers unlabelled).
- Emits `kind: 'stage'` events tagged `explore: true` plus a shadow comparison outcome; shadow cost is excluded from the primary cost-per-accepted-task metric.

- [ ] **Step 1:** Failing tests — shadow only fires for plan/design; judge input contains no tier/model identifiers; ordering is randomised; results recorded with the same `task_id`; a shadow failure never affects the primary stage.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `npx vitest run tests/workflow-shadow.test.ts`

### Task 3.3: Stratified analysis + CLI

**Files:** Create `src/analysis/routing.ts`, `src/analysis/cli.ts`; Test: `tests/analysis-routing.test.ts`

**Interfaces:**
- Produces: `aggregateRouting(events, { since, stage, taskClass }): RoutingReport` — cells keyed by `task_class × blast_radius × stage × tier`, each with `n`, `total_cost`, `cost_per_accepted_task`, `first_try_rate`, `rework_rate`, `escalation_rate`, `mean_human_edit_churn`.
- Produces: `harness stats routing [--since] [--stage] [--class] [--shadow]`.
- **Refuses** to print an unstratified tier comparison; cells with `n < 8` are printed as "insufficient data" rather than as a rate.

- [ ] **Step 1:** Failing tests — a synthetic event stream aggregates to expected cells; deferred outcomes join by `task_id`; shadow-tagged events are excluded from the primary metric; low-`n` cells suppressed; unstratified request rejected.
- [ ] **Step 2:** Implement aggregation + CLI table output.
- [ ] **Step 3:** `npx vitest run tests/analysis-routing.test.ts`

### Task 3.4: Adaptive table via the improver

**Files:** Modify `src/improver/default-improver.ts`; Create `src/workflow/adaptive.ts`; Test: `tests/workflow-adaptive.test.ts`

**Interfaces:**
- Produces: `updateRoutingPolicy(report, current): RoutingPolicyDoc` — per design §9: require `n ≥ 8`; demote when `first_try ≥ 0.85 && rework_rate ≤ 0.1`; promote on two consecutive escalations; never below the playbook floor; never demote when `reversibility === 'irreversible'`.
- Policy persisted as a human-readable `project`-scope memory doc `routing-policy`; `policy: adaptive` reads it, `policy: static` ignores it.

- [ ] **Step 1:** Failing tests — demotion/promotion thresholds, floor clamping, `n < 8` no-op, malformed stored doc falls back to the playbook floor.
- [ ] **Step 2:** Implement; call from `DefaultImprover.reflect()`.
- [ ] **Step 3:** `npx vitest run tests/workflow-adaptive.test.ts`

---

# Phase 4 — Breadth: playbooks for every profile

### Task 4.1: Non-coding playbooks

**Files:** Create `.agents/playbooks/{research,data,writing,security}/PLAYBOOK.md`; Modify `profiles/{research,data,writer,security}.yaml`; Test: `tests/workflow-playbooks-all.test.ts`

Stage meanings per design §1.2. Each playbook defines its own `task_classes`
and per-class intensity defaults; each profile gains `models.roles` +
`workflow`.

- [ ] **Step 1:** Failing test — every shipped playbook loads, every stage/level has a contract with non-empty `required_sections`, and every profile referencing a playbook resolves it.
- [ ] **Step 2:** Author the four playbooks.
- [ ] **Step 3:** Verify the `verify` stage is meaningful in each (source check / reconciliation / fact check / repro) — an empty `verify` contract fails the test.
- [ ] **Step 4:** `npx vitest run tests/workflow-playbooks-all.test.ts`

### Task 4.2: Docs

**Files:** Modify `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/ROADMAP.md`

- [ ] **Step 1:** Add a "Workflow & routing" section to `CLAUDE.md` (module table row for `src/workflow/`, `src/analysis/`, playbook discovery levels).
- [ ] **Step 2:** Document the playbook format alongside the skills section.
- [ ] **Step 3:** Mark the roadmap item in progress / done.

---

# Phase 5 — TUI surfacing

### Task 5.1: Protocol + stage strip

**Files:** Modify `src/types.ts` (`ServerMessage`), `src/server/index.ts`, `tui/internal/ui/{topbar,rail,model}.go`; Test: `tui/internal/ui/stage_strip_test.go`

**Interfaces:**
- New `ServerMessage`: `{ type: 'stage', stage, intensity, tier, model, state: 'start'|'done'|'escalated'|'skipped', cost_usd? }`.
- Topbar renders a stage strip (`recon ▸ plan ▸ design ▸ build ▸ verify ▸ review`) with the active stage highlighted, skipped stages dimmed, escalations marked.
- Rail shows per-stage cost and the running task total against `max_usd_per_task`.

- [ ] **Step 1:** Failing Go test — strip renders correct states from a message sequence; skipped stages dim; escalation marker appears.
- [ ] **Step 2:** Implement, following the existing category/color conventions in `tui/internal/ui/theme.go`.
- [ ] **Step 3:** `cd tui && go test ./...`

---

## Validation checklist

- [ ] `pnpm typecheck && pnpm test` green; `cd tui && go test ./...` green.
- [ ] A profile with no `workflow:` block produces byte-identical telemetry to pre-change (regression test).
- [ ] A trivial task (`ui-tweak`) costs ≤ 2 LLM calls beyond the build itself.
- [ ] A skipped (L0) stage issues zero LLM calls.
- [ ] `harness stats routing` on ≥2 weeks of real Phase 0 data prints stratified
      cells with enough `n` to act on — this is the deliverable that answers the
      original question about frontier vs mid-tier models.
