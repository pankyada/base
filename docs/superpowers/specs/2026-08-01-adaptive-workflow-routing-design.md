# Adaptive Workflow Routing — Design

> Date: 2026-08-01
> Status: Draft (design)
> Related: `docs/superpowers/specs/2026-06-05-profile-examples-design.md`,
> `docs/ROADMAP.md`

## Goal

Every task the harness runs today is one flat agent loop on one model, chosen
once in the profile. Two consequences:

1. **No structure.** A schema migration and a CSS tweak get the same treatment:
   whatever the model decides to do. There is no enforced "understand before you
   plan, plan before you build, verify before you claim done."
2. **No evidence.** Model choice is a static guess in YAML. Telemetry records
   `model` and `cost_usd` per LLM call, but nothing links a call to *what kind of
   work it was* or *whether the work turned out to be good*. So the question
   "do we actually need frontier models for development work, or would a
   mid-tier model do?" is unanswerable with the data we collect.

This design introduces a **stage pipeline** with model-per-stage routing,
LLM-decided *intensity* per stage, an escalation ladder driven by observed
failure, and the telemetry needed to answer the routing question empirically
rather than by intuition.

It is deliberately **not coding-specific**. Stages are generic; the concrete
meaning of each stage lives in a *playbook*, discovered per profile the same
way skills are. Coding is the first playbook, not the only one.

### Non-goals

- Not an autonomous multi-agent planner. Stages are a fixed, inspectable
  sequence with gates, not free-form agent negotiation.
- Not a replacement for `agents:` / `Delegate`. Stages may *use* delegation, but
  workflow is orthogonal to multi-agent composition.
- No change to the WS protocol in P0–P2 (TUI surfacing is P4 and additive).
- No new model provider integration. Routing selects among model ids the
  profile already declares.

---

## 1. Three orthogonal knobs

The core modelling decision. These are conflated in most "router" designs, and
conflating them makes the telemetry uninterpretable.

| Knob | Values | Decided by |
|------|--------|-----------|
| **Stage** | `recon`, `plan`, `design`, `build`, `verify`, `review` | Playbook (fixed sequence) |
| **Intensity** | `0` (skip), `1` (light), `2` (standard), `3` (deep) | LLM triage, per stage, per task |
| **Tier** | `cheap`, `balanced`, `frontier`, `critic` | Routing policy (static table → adaptive) |

Profiles bind **role → model id**; playbooks bind **stage → role**. A model swap
is a one-line profile edit and historical telemetry stays comparable, because
telemetry records both the tier *and* the concrete model id.

### 1.1 Stage taxonomy (profile-agnostic)

| Stage | Generic meaning | Coding | Research | Data | Writer | Security |
|-------|-----------------|--------|----------|------|--------|----------|
| `recon` | Establish current state before proposing anything | Read touched code, callers, tests, git history | What's already known/collected | Profile schema, row counts, nulls | Existing draft, style guide, prior pieces | Asset + scope inventory |
| `plan` | Decide the approach and sequence | Steps, files, risks | Search strategy, source list | Query strategy | Outline, argument spine | Test plan, rules of engagement |
| `design` | Fix the contract/shape of the output before producing it | Interfaces, schema, migration path | Report structure, claim taxonomy | Metric definitions, join keys | Section structure, voice | Finding template, severity rubric |
| `build` | Produce the artifact | Patch | Fetch + synthesise | Queries + transforms | Draft | Probe + exploit repro |
| `verify` | Check the artifact against reality | Run/extend tests | Source check, citation validity | Sanity checks, reconciliation | Fact + consistency check | Reproduce finding, false-positive check |
| `review` | Adversarial second opinion, different model | Diff review | Bias/gap review | Assumption review | Edit pass | Peer review, blast-radius check |

`recon` is **always ≥ intensity 1** and always first. This is the structural
form of "plan and design only after a detailed review of the current solution" —
it is a gate, not advice.

### 1.2 Intensity means an artifact contract, not a mood

If intensity `2` merely means "think harder", nothing is measurable. Each
(stage, intensity) pair binds to a **required output shape and exit criteria**,
declared in the playbook. Coding playbook, abridged:

| Stage | L0 | L1 | L2 | L3 |
|-------|----|----|----|----|
| recon | *(never 0)* | read touched files + project graph query | + callers, call graph, existing tests | + git archaeology, prior decisions/contradictions |
| plan | skip | 3-bullet inline plan | plan artifact: steps, files, risks, rollback | + 2 alternatives with tradeoffs, spike first |
| design | skip | skip | interface/schema sketch before code | + contract tests, migration + backout path |
| build | skip | patch | patch + stated invariants | staged commits, each independently green |
| verify | skip | run existing tests | + new cases for every changed branch | + adversarial/property/edge cases |
| review | skip | self-diff read | critic model on the diff | critic + second model family + security pass |

A stage is **done** only when its artifact validates against the contract
(presence + required sections). A stage that cannot satisfy its contract fails
back — see §4.

---

## 2. Triage: two passes, both cheap

Intensity is decided by the model, as requested — but not from the prompt alone,
because at prompt time the model has no evidence.

```
triage-A (cheap)  →  recon  →  triage-B (cheap)  →  plan → design → build → verify → review
   prompt only        gate       prompt + recon findings
```

- **triage-A** sees only the user request. Its *only* job is to set `recon`
  intensity and guess `task_class`. Deliberately low-stakes.
- **triage-B** runs after recon, with the recon artifact in context: files
  touched, blast radius, existing coverage, prior decisions from the project
  graph. It sets intensity for every remaining stage and may revise
  `task_class`. This is the decision that matters, and it is made on evidence.

Both are single non-streaming calls on the `cheap` role with a strict JSON
response and a small token budget. Classification with evidence in context is
exactly the workload cheap models are good at.

```jsonc
// triage-B output (schema-validated; on parse failure, fall back to the
// playbook's default intensity profile for the task class)
{
  "task_class": "ui-tweak",
  "blast_radius": "single-file",      // single-file | module | cross-module | systemic
  "reversibility": "easy",            // easy | hard | irreversible
  "intensity": { "plan": 0, "design": 0, "build": 2, "verify": 1, "review": 1 },
  "confidence": 0.8,
  "why": "css-only, snapshot tests already cover this component"
}
```

**Triage caching.** Triage-A results are cached by `(playbook, task_class
fingerprint)` for repeat-shaped requests, so a one-line fix does not pay two
extra round-trips. Cache is advisory: triage-B always runs when any stage after
recon has intensity > 0.

**Cost floor.** If the playbook's `min_intensity` and `max_intensity` collapse to
a single option, triage is skipped entirely.

---

## 3. Routing: escalation ladder, not up-front sizing

The routing policy never tries to guess the "right" model up front. It starts at
the playbook's floor for that stage/class and **promotes on evidence**.

**Promotion triggers** (all observable in the existing loop):

| Trigger | Signal source |
|---------|---------------|
| Stage contract unmet twice | `artifacts.validate()` failures |
| `verify` fails 2× on the same build | verify stage result |
| Edit thrash: same file rewritten ≥3× in one stage | `session.tool_calls` |
| Tool error rate > 30% in a stage | telemetry `ok=false` ratio |
| Self-reported confidence < 0.4 in stage artifact | artifact frontmatter |
| `review` returns a `high` severity finding | review stage result |

Promotion moves the stage one tier up (`cheap → balanced → frontier`) and
re-runs it, capped by `budget.max_stage_retries` and `budget.max_usd_per_task`.

**Demotion** is the mirror, and it is what makes the system get cheaper over
time: if the last `N` runs of (stage, task_class) succeeded first-try at tier
`T`, the adaptive policy lowers the floor to `T-1` for that cell. Demotion is
gated: never below the playbook floor, and never when
`reversibility == "irreversible"`.

**Review diversity.** The `critic` role should resolve to a *different model
family* than the `build` role. Correlated blind spots, not raw capability, are
what a self-review misses; the policy warns at profile load if `critic` and
`build` roles share a provider.

---

## 4. Stage execution and context handoff

Stages do **not** share one growing transcript. Each stage runs a bounded agent
loop in a child context seeded with:

1. the original user request,
2. the playbook's stage contract for the chosen intensity,
3. the **artifacts** of prior stages (not their transcripts),
4. the project-graph slice recon pulled in.

Rationale: a `cheap`-tier build stage drowns if handed a `frontier` planner's
full reasoning transcript, and cost scales with the transcript we hand it.
Artifacts are the interface; transcripts stay local to their stage.

Artifacts are written to `<artifact_dir>/workflow/<session_id>/<stage>.md` with
gray-matter frontmatter (`stage`, `intensity`, `tier`, `model`, `confidence`,
`contract_ok`), so they are inspectable, diffable, and replayable.

**Fail-back.** A stage may declare a *precondition violation* rather than fail:
e.g. `verify` reports "the design was wrong, not the code". The runner then
re-enters the named earlier stage at `intensity + 1`, up to
`budget.max_stage_retries` total re-entries per task. Fail-back edges are
recorded — they are the `rework` signal in analysis.

---

## 5. Project knowledge graph (and why this design exists)

A meta-requirement surfaced during design: the harness should not lose
cross-cutting insights (e.g. "this coding-only idea generalises to every
profile") between sessions. Two mechanisms, both reusing infrastructure that
**already exists** in the repo but is currently never written to automatically:
the `project` memory scope (`src/memory/fs-memory.ts`,
`src/session/user-paths.ts`) and `GraphMemoryProvider` with typed links
(`src/memory/graph-memory.ts`).

### 5.1 Knowledge extraction at stage close

At each stage close, a cheap extraction call converts the stage artifact into
graph nodes/edges written to `project` scope:

| Node type | Written by | Example |
|-----------|-----------|---------|
| `Decision` | plan, design | "stages are generic; playbooks specialise them" |
| `Constraint` | recon, design | "loop uses one model id; per-call override needed" |
| `Component` | recon | `src/loop/agent-loop.ts` |
| `Requirement` | triage, plan | "recon must precede plan" |
| `Risk` | plan, review | "cheap models get easy tasks → selection bias" |
| `Finding` | verify, review | "critic shares provider with builder" |
| `Followup` | review | "apply routing to research profile" |

| Relation | Meaning |
|----------|---------|
| `depends_on` | node requires the target |
| `implements` | node realises a requirement/decision |
| `supersedes` | node replaces an earlier decision |
| `contradicts` | node conflicts with an existing node |
| `generalizes_to` | insight applies beyond its origin scope |
| `evidence_for` | telemetry/finding supports a decision |

### 5.2 Two enforced gates

- **Recon gate.** `recon` must begin with a `project`-scope graph query and its
  artifact must either cite ≥1 existing node or explicitly record "no prior
  project knowledge". This is what makes "review the current solution first"
  real rather than aspirational, and it is why recon can never be intensity 0.
- **Generalization probe.** `review` at intensity ≥2 must answer, as a required
  artifact section: *does this apply beyond the immediate scope?* Any "yes"
  emits `generalizes_to` edges and a `Followup` node. Likewise, a new `Decision`
  that conflicts with an existing one must emit `contradicts` and surface it to
  the user rather than silently overwriting.

The probe is the direct structural fix for the class of miss that motivated it:
scope-narrowing is caught by a checklist item with an artifact slot, not by
hoping the model volunteers it.

---

## 6. Telemetry: what has to change to answer the question

Today (`src/types.ts`) a `TelemetryEvent` carries `kind | name | model |
tokens | cost | duration | ok`. There is no way to group calls into a unit of
work, no notion of what kind of work it was, and no outcome. All added fields
are optional, so existing `~/.harness/telemetry.jsonl` lines remain valid.

```ts
// added to TelemetryEvent — all optional
task_id?: string          // one user request end-to-end
stage_id?: string         // one stage attempt
stage?: Stage
attempt?: number
intensity?: 0 | 1 | 2 | 3
tier?: 'cheap' | 'balanced' | 'frontier' | 'critic'
task_class?: string
blast_radius?: 'single-file' | 'module' | 'cross-module' | 'systemic'
playbook?: string
escalated_from?: string   // tier this attempt was promoted away from
explore?: boolean         // this routing decision was a forced exploration
```

Two new `kind` values:

```ts
// kind: 'stage'  — emitted at stage close
{ stage, stage_id, tier, intensity, attempt, contract_ok, duration_ms,
  cost_usd, tokens_in, tokens_out, failed_back_to?: Stage }

// kind: 'outcome' — emitted at task close, and again (deferred) when
// ground truth becomes available
{ task_id, verdict: 'accepted'|'reworked'|'abandoned',
  stages_run, rework_count, escalations,
  verify_first_try: boolean,
  review_findings: { high: number, med: number, low: number },
  human_edit_churn?: number,   // deferred label, see §6.1
  total_cost_usd }
```

### 6.1 Ground truth

`verify_first_try` and `review_findings` are cheap in-band labels, but they are
graded by the same system that produced the work. The strong label is
**what the human did afterwards**:

- **Coding:** at the next session on the same project, diff the files the prior
  task wrote. Churn on those files within a short window is `human_edit_churn`.
  Reverted or rewritten output is the clearest possible "the cheap model was not
  good enough" signal, and nobody logs it today.
- **Non-coding profiles:** the equivalent is artifact acceptance — was the draft
  sent/kept, the report used, the finding filed. Where no automatic signal
  exists, an explicit user verdict (accept / redo) supplies it.

Deferred outcome events are appended later with the same `task_id`, so analysis
joins them.

### 6.2 The measurement trap

Naive analysis of this data will produce a confidently wrong answer. Cheap tiers
get routed to easy tasks, so cheap tiers post great numbers, and the conclusion
"frontier models are never needed" follows from selection bias rather than from
capability.

Three countermeasures, all part of the design rather than later analysis
hygiene:

1. **Stratify.** Every reported metric is grouped by `task_class ×
   blast_radius`. The analysis CLI refuses to print an unstratified tier
   comparison.
2. **Forced exploration.** `routing.explore_rate` (default `0.12`) of stage
   routings deliberately deviate one tier from the recommendation, up *and*
   down, and are flagged `explore: true`. Without counterfactuals the dataset
   can only confirm the current policy. Exploration never fires when
   `reversibility == "irreversible"` or the budget is nearly exhausted.
3. **Paired shadow runs.** For `plan`/`design` (short, cheap, high-leverage), a
   sampled fraction runs the cheap tier *in parallel* with the chosen tier; a
   critic model judges the two artifacts blind (order randomised, tiers
   unlabelled). This yields clean per-class head-to-head data at a small cost
   multiple, because plan artifacts are short.

**Headline metric: cost per accepted task**, stratified — not cost per token and
not pass rate. A cheap stage that triggers one fail-back into re-planning has
already spent its savings.

---

## 7. Configuration surface

### 7.1 Profile additions (all optional, back-compatible)

```yaml
model:                      # unchanged — remains the default/fallback
  id: gpt-5.4-mini
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY

models:                     # NEW — role → model id
  roles:
    cheap:     gpt-5.6-luna
    balanced:  gpt-5.6-terra
    frontier:  gpt-5.6-sol
    critic:    claude-sonnet-5      # different family on purpose

workflow:                   # NEW
  enabled: true
  playbook: coding          # resolved like skills; see §7.2
  min_intensity: { recon: 1, review: 1 }
  max_intensity: { plan: 3, design: 3, build: 3, verify: 3, review: 3 }
  budget:
    max_usd_per_task: 2.00
    max_stage_retries: 2
    max_stage_minutes: 15
  routing:
    policy: static          # static | adaptive
    explore_rate: 0.12
    shadow_rate: 0.05       # plan/design paired runs
    table:                  # floors; adaptive policy may lower within playbook bounds
      recon:  cheap
      plan:   balanced
      design: balanced
      build:  balanced
      verify: cheap
      review: critic
  knowledge:
    graph: true             # write project-scope graph nodes at stage close
    generalization_probe: true
```

**Degradation is total and safe.** No `models.roles` → every role resolves to
`profile.model.id`, and the pipeline still runs and still logs stages: you get
the observability without changing any model. No `workflow:` block → current
behaviour, byte for byte.

### 7.2 Playbooks

Playbooks follow the skills pattern exactly (`src/skills/loader.ts`): a
directory containing `PLAYBOOK.md` with gray-matter frontmatter, auto-discovered
across the same four levels (user / project / sub-project / folder), most
specific wins.

```
.agents/playbooks/coding/PLAYBOOK.md
.agents/playbooks/research/PLAYBOOK.md
```

```markdown
---
name: coding
description: Software change workflow
stages: [recon, plan, design, build, verify, review]
task_classes: [ui-tweak, bugfix, feature, refactor, migration, spike, investigation]
defaults:
  ui-tweak:  { recon: 1, plan: 0, design: 0, build: 2, verify: 1, review: 1 }
  migration: { recon: 3, plan: 3, design: 3, build: 2, verify: 3, review: 3 }
---

## recon
### L1
Required artifact sections: `Files touched`, `Prior knowledge`, `Open questions`.
Exit criteria: every file the task will modify has been read; project graph queried.
...
```

Shipping playbooks: `coding`, `research`, `data`, `writing`, `security` — one per
example profile family already in `profiles/`. A profile with no `playbook:`
falls back to a built-in `generic` playbook (recon → plan → build → verify).

---

## 8. Module layout

| Path | Role |
|------|------|
| `src/workflow/types.ts` | `Stage`, `Intensity`, `Tier`, `TaskPlan`, `StageResult`, `StageContext` |
| `src/workflow/playbook.ts` | Discovery + parse + contract lookup (mirrors `src/skills/loader.ts`) |
| `src/workflow/triage.ts` | Triage-A / triage-B calls, JSON validation, caching, defaults fallback |
| `src/workflow/policy.ts` | Tier resolution: floor → adaptive table → explore jitter; escalation/demotion rules |
| `src/workflow/runner.ts` | Stage state machine: gates, fail-back, budget, retries |
| `src/workflow/artifacts.ts` | Write/read/validate stage artifacts under `<artifact_dir>/workflow/` |
| `src/workflow/knowledge.ts` | Artifact → graph nodes/edges; recon gate; generalization probe |
| `src/workflow/labeler.ts` | Deferred ground-truth labels (git churn / acceptance) |
| `src/analysis/routing.ts` | Stratified aggregation over telemetry |
| `src/analysis/cli.ts` | `harness stats routing` |

**Touched existing modules:**

- `src/loop/agent-loop.ts` — accept `opts.modelId` (currently `profile.model.id`
  is read at one call site) and `opts.stage` for telemetry tagging. No
  behavioural change when omitted.
- `src/types.ts` — telemetry field additions.
- `src/profiles/schema.ts` — `models.roles` + `workflow` blocks.
- `src/improver/default-improver.ts` — reflection also consumes stage outcomes
  and updates the adaptive routing table (see §9).
- `src/server/index.ts` — route a user message through the workflow runner when
  `workflow.enabled`.

---

## 9. Adaptive policy storage

The adaptive table is not a hidden model. It is a memory file the improver
maintains at `project` scope, `routing-policy`, so it is inspectable and
editable by hand:

```jsonc
{
  "coding": {
    "ui-tweak":   { "build": { "tier": "cheap",    "n": 34, "first_try": 0.91 } },
    "migration":  { "plan":  { "tier": "frontier", "n": 6,  "first_try": 0.50 } }
  }
}
```

Update rule (per cell, on task close): require `n ≥ 8` before any change;
demote when `first_try ≥ 0.85` and `rework_rate ≤ 0.1`; promote immediately on
two consecutive escalations. Cells with `n < 8` use the playbook floor.

---

## 10. Rollout

| Phase | Ships | Answers |
|-------|-------|---------|
| **P0 Observability** | telemetry fields, stage tagging, static table, outcome events, deferred labeler | "what does our work actually cost, by stage?" |
| **P1 Pipeline** | playbooks, triage, runner, artifacts, gates, fail-back, escalation | enforced plan/design/build/verify |
| **P2 Knowledge** | graph extraction, recon gate, generalization probe | insights stop getting lost between sessions |
| **P3 Adaptivity** | explore, shadow runs, adaptive table, `harness stats routing` | "do we need frontier models for dev work?" |
| **P4 Surface + breadth** | TUI stage strip, per-stage cost, playbooks for research/data/writing/security | the pattern applied profile-wide |

P0 ships a **static routing table and no intelligence on purpose.** Building an
adaptive router before there are labels is guessing with extra machinery; two
weeks of ordinary work under P0 produces the dataset that P3 needs.

---

## 11. Risks

| Risk | Mitigation |
|------|-----------|
| **Ceremony tax** — a one-line fix costs six LLM calls | L0 stages are skipped entirely (no call); triage-A cached; `generic` playbook is 4 stages; budget aborts to plain loop |
| **Latency** — serial stages | recon tool fan-out already parallel in the loop; triage capped at small token budgets; stages stream to the TUI so time-to-first-token is unchanged |
| **Self-scored intensity drifts** | triage predictions are logged and compared against post-hoc "what was actually needed" from outcomes; the triage prompt is retuned from own telemetry |
| **Context loss across stages** | artifact-based handoff (§4), never transcript-based |
| **Selection bias in analysis** | stratification + forced exploration + shadow runs (§6.2) |
| **Graph rot** — contradictory/stale nodes accumulate | `supersedes`/`contradicts` edges are mandatory on conflict; improver prunes at session close |
| **Cost double-counting** | cost attributed to `stage_id`; task total is the sum, shadow runs tagged and excluded from the primary metric |
| **Back-compat** | every new field optional; absent `workflow:` = today's behaviour; old telemetry lines parse unchanged |

## 12. Open questions

1. Should `verify` failures re-enter `build` or `design` by default? (Proposal:
   the verify artifact names the target; default `build`.)
2. Does the critic need the build transcript for high-intensity review, or is
   the diff plus design artifact sufficient? (Proposal: diff + design; measure.)
3. Shadow-run judging by a single critic model risks its own bias — worth two
   judges on a sample to estimate judge agreement.
