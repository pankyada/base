# Base improvement audit

Date: 2026-09-24. Task: PT-096. Baseline: `381a4b1` plus pre-existing `.DS_Store` modification.

Analysis only. Findings come from source, tests and canonical product documents; they do not establish a production outage, live provider behavior, current billing savings or fresh browser acceptance. No runtime configuration, product implementation, deployment or architecture decision changed. New defects remain planned follow-ups; existing acceptance tasks remain open.

## Assessment

Base has most of the necessary foundation: profile-driven tools and ACLs, workflow stages, context projection, budgets, durable Town tasks/messages, developer TUI, Web workspaces and an already substantial medieval Town. Highest return comes from making these mechanisms consistent and measurable, then exposing them as understandable controls.

The five priorities reinforce each other. A narrowly scoped analyst gets a smaller relevant prompt, fewer tool mistakes and clearer UI. An exact run identity makes multi-agent views reliable. Budget and evidence views make the game-like Town useful for real work.

## Ranked opportunities

| Priority | Opportunity | Main benefit | Next step |
|---|---|---|---|
| P1 | Reconcile whole-request context/headroom and finite-budget fanout | Predictable costs and usable parallel workers | PT-101/PT-102; deterministic acceptance first |
| P1 | Repair shipped data-profile capability mismatch | Role promised in UI becomes usable and honest | PT-097; narrow profile/prompt repair first |
| P1 | Guard Town snapshots by scope and revision | Prevent stale world and decision state | PT-098; reproduce delayed fetch and fix |
| P1 | Preserve estimated-cost provenance in narrow TUI | Prevent misleading monetary display | PT-099; atomic amount/basis rendering |
| P2 | Make executor package metadata truthful | Reliable analytical environments | PT-100; define/validate availability semantics |
| P2 | Complete existing acceptance and effort controls | Trustworthy daily TUI/Web use | Reuse PT-043, PT-053, PT-054, PT-009, PT-010, PT-016 |
| P2 | Add resolved role/capability inspection and Town assignment | Appropriate specialist tools, visible restrictions | Additive proposal; specification before implementation |
| P2 | Measure cost per accepted result and constrain context/tool exposure | Optimize actual efficiency | Cost findings below |
| P3 | Split fragile client/runtime responsibilities at tested seams | Lower maintenance cost | Incremental refactors while touching those areas |
| P3 | Extend Town with dependency, budget and evidence mechanics | Faster multi-project coordination | Preserve approved landscape and existing authority |

Priorities describe engineering order, not security severity. No P0 outage established.

## 1. Token management and cost efficiency

### Whole-request token and headroom accounting (PT-101)

[Loop estimates](/Users/pankajkumaryadav/Desktop/development/base/src/loop/agent-loop.ts:300) use messages only, then [attach tools](/Users/pankajkumaryadav/Desktop/development/base/src/loop/agent-loop.ts:311); [calibration](/Users/pankajkumaryadav/Desktop/development/base/src/loop/agent-loop.ts:356) divides reported provider input by message-only raw tokens. In contrast, [invocation estimate](/Users/pankajkumaryadav/Desktop/development/base/src/provider/invocation.ts:47) includes serialized tool schemas. Depending on provider usage semantics, schema tokens can contaminate the text calibration ratio; before calibration they are omitted from the context estimate. [EWMA and clamp](/Users/pankajkumaryadav/Desktop/development/base/src/context/estimator.ts:27) bound the distortion but do not reconcile these accounting paths.

A second composition gap: [selected-skill fitting](/Users/pankajkumaryadav/Desktop/development/base/src/loop/agent-loop.ts:31) uses the full context window after [projection](/Users/pankajkumaryadav/Desktop/development/base/src/context/projection.ts:208) targeted an 80% high-water mark. Selected skill content may consume the reserved margin, without attached schemas in the fitting check. This concerns the selected-skill path, especially enforce mode; it is not evidence that current shadow operation has hit a provider error.

Use one whole-request estimate with message/schema/opaque-state subtotals and explicit output/reasoning reserve. Fit selected skills against the remaining prompt budget, then check final composition. Preserve append-only ledger/projection semantics. Acceptance: deterministic fake accounting with fixed messages and variable schema sizes does not distort text calibration; oversized selected skills are omitted with a reason; composed requests respect configured headroom. Probable source-derived accounting defects, not measured live overflow or savings.

### Finite-budget parallel delegation (PT-102)

[Agent runner](/Users/pankajkumaryadav/Desktop/development/base/src/agents/runner.ts:58) and [Delegate](/Users/pankajkumaryadav/Desktop/development/base/src/tools/builtin/delegate.ts:67) reserve the parent's entire remaining allowance. [Budget allocation](/Users/pankajkumaryadav/Desktop/development/base/src/runs/budget.ts:73) deducts reservations, while [fanout](/Users/pankajkumaryadav/Desktop/development/base/src/tools/builtin/delegate-fanout.ts:1) intentionally starts up to three workers. A bounded primitive reproduction with a $1 parent yielded first allowance $1, second $0, and second `checkModel(0)` rejected. Source connects those primitives to fanout; end-to-end fanout was not executed.

Define fair bounded shares or a shared atomic concurrent ledger. Preserve parent cost/tool/wall limits and fail-closed behavior. Acceptance: three fake-provider children receive bounded useful allowances; total committed plus reserved cost never exceeds parent limit; failure/cancel releases unused reservations; nested delegation and shared tool/wall limits remain correct. Do not grant each child an independent fresh full budget.

### Reduce role-specific request payloads, with measured quality

[Tool assembly](/Users/pankajkumaryadav/Desktop/development/base/src/loop/agent-loop.ts:107) collects built-ins, runtime, MCP and agent tools. Existing optional decision selection can narrow exposure; do not build a second semantic selector or turn shadow features on without their existing acceptance. First measure schema-token share by family; use effective profile/stage policy for deterministic eligibility, preserving control/recovery tools and discovery. Combine with eligible skill filtering below.

Compare fixed coding/data/research tasks on total tokens, cached input, schemas, output/reasoning, retries, success and cost per accepted outcome. Small cheap calls that cause expensive retries are not savings. Reuse PT-069/PT-082 calibration/shadow gates. Prompt cache markers already exist; verify provider-specific cached usage before expanding them. No percentage savings forecast is defensible from this audit.

### Pricing provenance and projection cost

[Model prices](/Users/pankajkumaryadav/Desktop/development/base/src/models/registry.ts:24) include a fallback for unknown models. Expose source/checked-date/fallback status in usage and define budget policy for unknown custom endpoint prices. API-equivalent subscription cost remains an estimate, not provider remaining quota or billed spend. No current-price claim made here.

[Projection elision/drop loops](/Users/pankajkumaryadav/Desktop/development/base/src/context/projection.ts:239) repeatedly estimate and rebuild messages; [estimator](/Users/pankajkumaryadav/Desktop/development/base/src/context/estimator.ts:11) serializes full arrays. Benchmark synthetic 1k/5k-turn ledgers and allocation counts before optimizing. Incremental deltas and one final rebuild may reduce local CPU; require identical selected messages, tool-call pair preservation and hard-limit behavior. This is a scale/performance opportunity, not a measured bottleneck.


## 2. Maintainability

**Keep generic Core; make configuration explainable.** Profiles already compose model, tools, MCP, hooks, executor, workflow and child agents. ACL enforcement is centralized and deny-wins. Playbooks already constrain stages and read-only work. This is a good modular base, not grounds for a framework rewrite. Evidence: [profile schema](/Users/pankajkumaryadav/Desktop/development/base/src/profiles/schema.ts:316), [ACL](/Users/pankajkumaryadav/Desktop/development/base/src/tools/acl.ts:48), [stage ACL](/Users/pankajkumaryadav/Desktop/development/base/src/workflow/stage-acl.ts:7).

**Expose resolved configuration.** The data mismatch below demonstrates why raw YAML is insufficient: mode defaults override explicit tool settings. Add an inspectable, non-secret resolved view showing final tools, why a permission applies, MCP capabilities, executor, skill policy, model/effort and workflow restrictions. Use the same view in doctor/profile inspection, TUI/Web and Town; avoid a second configuration selector. Acceptance: a denied tool's explanation matches actual runtime enforcement, and configured capabilities remain distinct from effective read-only/stage restrictions.

**Refactor at behavior boundaries.** Town currently combines handwritten wire types, fetch/SSE, commands, answer recovery and folio rendering in one compressed client. The TUI central model is 2,826 lines. Extract a typed Town adapter, scoped snapshot hook, command/result hook and folio components; split TUI reducers by established message ownership when changed. Keep existing scene/model/assets separation. Evidence: [Town client](/Users/pankajkumaryadav/Desktop/development/base/web/app/town/town-client.tsx:13), [TUI model](/Users/pankajkumaryadav/Desktop/development/base/tui/internal/ui/model.go:1). Acceptance: transport race tests target the hook; existing keyboard, approval, cancellation and reconnect tests continue to pass. Line count alone is not a defect.

**Prefer contract checks over new abstraction first.** Fix one inconsistent shipped profile directly. If repeated role/configuration mismatches persist, consider optional capability requirements containing required tools/executor/MCP interfaces, artifact conventions and a UI descriptor. A contract must validate configuration, never grant permissions. Legacy profiles retain their current behavior. A new `role_pack` framework is not a prerequisite.

## 3. TUI and Web

### New defect: Town snapshot ordering and scope (PT-098)

[Refresh](/Users/pankajkumaryadav/Desktop/development/base/web/app/town/town-client.tsx:203) unconditionally commits fetched `cursor` and `snapshot`; [poll/SSE effect](/Users/pankajkumaryadav/Desktop/development/base/web/app/town/town-client.tsx:204) permits overlapping fetches. Cleanup closes the event source and timers but does not abort/ignore a pending request or clear scope-owned data. [Page](/Users/pankajkumaryadav/Desktop/development/base/web/app/town/page.tsx:7) mounts an unkeyed client.

A delayed previous-user/profile request can finish after the new scope; two same-scope fetches can also finish backwards. Result: stale projects, quota, questions or revisions displayed, with current-scope actions against old records. This is a source-derived race, not a reproduced incident. Existing [Ops refresh](/Users/pankajkumaryadav/Desktop/development/base/web/app/ops/page.tsx:151) already demonstrates in-flight serialization, abort and disposed guards.

Acceptance: delayed old-scope responses never display; same-scope cursor cannot decrease; stale errors cannot replace new success; current errors cannot be cleared by stale success; scope changes clear selections, drafts and answer keys; request bursts coalesce without losing final refresh. Do not infer authorization from visible IDs.

### New defect: TUI estimated-cost label truncation (PT-099)

[Statusbar](/Users/pankajkumaryadav/Desktop/development/base/tui/internal/ui/statusbar.go:40) appends dollar amount followed by cost-basis label. [Width fitting](/Users/pankajkumaryadav/Desktop/development/base/tui/internal/ui/statusbar.go:58) removes trailing segments individually. A suitable narrow width can retain `$...` while dropping `API-equivalent est.` or `Mixed est.`. Confirmed by a temporary focused Go test: width 100 rendered `$0.1234` without `API-equivalent est.`; width 140 kept both. Not a live PTY trial.

Render amount and basis atomically, using a compact qualified form where necessary. Acceptance: subscription/API estimate/mixed/unknown fixtures at narrow widths never leave misleading bare estimated dollars; full detail remains discoverable.

### Product completeness before redesign

The TUI already has eight overlays, context/cost, task tools and a bounded exact-run execution map; Ops already has run lanes, interventions and evidence stations. Preserve these. Evidence: [TUI tabs](/Users/pankajkumaryadav/Desktop/development/base/tui/internal/ui/tabs.go:9), [execution map](/Users/pankajkumaryadav/Desktop/development/base/tui/internal/ui/workflow_map.go:12), [Ops](/Users/pankajkumaryadav/Desktop/development/base/web/app/ops/page.tsx:6).

Prioritize model/effort picker completion (PT-016), remaining cross-client connected acceptance (PT-043), export fidelity (PT-009), and durable analyst canvas behavior (PT-010). PT-007 recovery acceptance has been completed; do not reopen it from stale summary prose. Verify populated, offline, reconnect, rejected action, delayed scope switch, keyboard-only and narrow-screen states. Tests and HTTP 200 are not substitutes for action acceptance.

## 4. Specialist modularity

### New defect: data analyst configuration contradicts its promise (PT-097)

[Data prompt](/Users/pankajkumaryadav/Desktop/development/base/profiles/data.md:3) requires queries through MCP and artifact output. [Data profile](/Users/pankajkumaryadav/Desktop/development/base/profiles/data.yaml:7) enables analyst mode but defines no query MCP or executor; apparent `Write: allow` is overridden because [mode wins](/Users/pankajkumaryadav/Desktop/development/base/src/profiles/loader.ts:20). [Analyst defaults](/Users/pankajkumaryadav/Desktop/development/base/src/profiles/schema.ts:143) deny Write and allow ExecuteCode, but [ExecuteCode](/Users/pankajkumaryadav/Desktop/development/base/src/tools/builtin/execute-code.ts:18) returns not enabled without an executor.

First decide the honest shipped contract: a clearly labelled connector template, or a functioning local-file analyst with configured executor and controlled artifact output. Repair YAML, prompt and onboarding together. Do not weaken analyst restrictions globally to make one profile pass.

Acceptance: resolved-profile test proves intended capabilities; local CSV/JSON fixture produces a report/chart under allowed artifacts if that capability is shipped; unsupported query setup is stated before a task starts; arbitrary Write/Edit/Bash remain denied; connector configuration and credentials remain local. No new role-pack abstraction required.

### Profile-specific skill selection

Ambient four-level discovery and name precedence are established: [loader](/Users/pankajkumaryadav/Desktop/development/base/src/skills/loader.ts:27), [indexer](/Users/pankajkumaryadav/Desktop/development/base/src/skills/indexer.ts:3), [agent load](/Users/pankajkumaryadav/Desktop/development/base/src/agents/runner.ts:79). Consider an optional declarative skill allow/deny policy applied after discovery and before prompt indexing/tool access. Existing decision-layer bounded selection/discovery must be reused where applicable; static profile policy would define eligible skills, not create a competing intelligent router.

Acceptance: coder and analyst see appropriate eligible sets; denied skills cannot be invoked by name; delegated workers use target-profile policy; profiles without policy remain compatible. Tool ACL stays the authority; skill visibility is not a sandbox.

### New gap: declared package availability lacks an executor contract (PT-100)

[Executor schema](/Users/pankajkumaryadav/Desktop/development/base/src/profiles/schema.ts:166) exposes `allowed_packages`; [session metadata](/Users/pankajkumaryadav/Desktop/development/base/src/server/index.ts:648) sends it to clients. [Docker execution](/Users/pankajkumaryadav/Desktop/development/base/src/executor/docker.ts:36) runs the selected image/interpreter without using that list. It neither provisions listed packages nor enforces an import allowlist.

Define the field honestly: environment inventory validated against a pinned image/manifest, or clearly informational metadata. Do not market it as an enforced package security boundary. Acceptance: declared available libraries match the executable image; unavailable imports fail clearly; no per-task install assumption; existing network/mount constraints stay intact. A full role-pack system is optional.

### Capability-aware assignment

[TownAssign](/Users/pankajkumaryadav/Desktop/development/base/src/town/runtime.ts:131) creates assignees with profile/display name and role `worker`; [read-only/orchestrator scoping](/Users/pankajkumaryadav/Desktop/development/base/src/town/runtime.ts:34) removes MCP, hooks, agents and workflow. Show these effective restrictions before dispatch. Start with resolved profile inspection and manual specialist selection. Optional task capability requirements can follow once concrete mismatches justify them; legacy untyped tasks stay compatible. No inference call is necessary just to compare declared capabilities.

## 5. Useful game-like multi-agent management

Town already exists. Its approved Chola/Kaveri medieval world has real repositories, stable buildings, activity districts, workers, persisted conversations, question replies, day/night and saved views. [Approved spec](/Users/pankajkumaryadav/Desktop/development/base/docs/superpowers/specs/2026-09-13-orchestrator-town-spec.md:14), [layout](/Users/pankajkumaryadav/Desktop/development/base/web/app/town/town-model.ts:296), [folios](/Users/pankajkumaryadav/Desktop/development/base/web/app/town/town-client.tsx:346). Preserve the approved visual direction.

The next product layer should make the town an effective command surface:

**Select office → inspect/select specialist and budget → dispatch through real gates → answer at Hall bell → inspect evidence → accept result.**

| Town element | Runtime meaning | Improvement |
|---|---|---|
| Office | Git project | Queue, workspace/branch status, exact run links |
| Resident insignia and loadout | Role/profile, model/effort, allowed capabilities | Compare coding, analyst and research specialists before assignment |
| Work order | Durable task and dependencies | Dependency view and exact queued reason with next action |
| Hall bell | Actionable approval or question | Priority inbox, receipt-backed resolution |
| Handoff courier | Durable message/artifact transfer | Source/destination/evidence; motion only for real recorded events |
| Treasury | Spend/budget plus distinct authoritative provider capacity | Per-project/team burn; separate actual, estimated and unknown |
| Completion seal | Artifact and validation/review evidence | Execution complete versus user accepted remains distinct |

Current [task card](/Users/pankajkumaryadav/Desktop/development/base/web/app/town/town-client.tsx:135) shows raw work metadata; [worker facts](/Users/pankajkumaryadav/Desktop/development/base/web/app/town/town-client.tsx:347) expose abbreviated IDs. Highest-value addition is a compact evidence drawer and exact-scoped navigation to Ops execution map/session/artifacts, plus role/loadout and budget inspection. The current [task form](/Users/pankajkumaryadav/Desktop/development/base/web/app/town/town-client.tsx:256) hardcodes shared checkout; any future workspace choice must reflect actual Core support and lease behavior.

Keep the existing [truthful work projection](/Users/pankajkumaryadav/Desktop/development/base/web/app/town/town-world-model.ts:140): matched task/session/run required for work animation. Avoid inferred progress percentages, productivity scores or fabricated worker movement. Literal accessible DOM operations remain fully capable. No new visual/layout approval is presumed.

Finish PT-053 landscape/survey/saved-view/user acceptance first. PT-054 still needs account-specific Codex model catalog reconciliation; its headless wake gap is closed. Provider quota remains authoritative under [ADR-85](/Users/pankajkumaryadav/Desktop/development/base/docs/ADR.md:1197); estimated token spend must not masquerade as quota.

Performance follow-on: hidden-document skip, resource disposal and pixel-ratio cap already exist. Visible reduced-motion scenes still render every animation frame ([scene](/Users/pankajkumaryadav/Desktop/development/base/web/app/town/town-scene.tsx:582)). Benchmark demand rendering or capped idle FPS, preserving immediate camera and state updates. No measured savings claimed.

## Sequence and acceptance

1. Fix budget/context correctness and analyst consistency: PT-101/PT-102/PT-097; resolve package semantics PT-100.
2. Establish representative cost/quality baselines; narrow role-specific request payloads through existing mechanisms. Keep shadow features under their existing acceptance gates.
3. Fix UI continuity/provenance PT-098/PT-099 and complete existing client acceptance/effort controls.
4. Expose resolved capability/budget/evidence in Town; add specialist assignment, exact-context navigation and dependency/handoff controls. Approve material UI changes first.
5. Refactor touched responsibilities and optimize measured performance bottlenecks. Avoid broad rewrites and unproven abstractions.

Success measures: cost per accepted outcome; input/cache/output/reasoning token attribution; unnecessary retries/tool calls; time to find a blocked task and answer it; scope/reconnect correctness; specialist capability mismatch rate; artifact/test/review evidence availability; measured scene frame/resource bounds. Set numeric targets after baseline, not invented percentage savings.

## Validation and remaining limits

- Reviewed product tracker/roadmap/ADRs, shipped profiles, context/provider/budget/delegation, executor/skills, TUI and Web/Town sources. Baseline `381a4b1`; pre-existing `.DS_Store` preserved.
- Isolated TypeScript budget primitive result: `{"firstAllowance":1,"secondAllowance":0,"rootRemaining":0,"secondChildZeroSpendRefused":true}`. No provider called; not an end-to-end fanout test.
- Temporary Go regression probe: `cd tui && GOCACHE=/tmp/base-go-cache go test ./internal/ui -run '^TestAuditBillingBasisTrim$' -v` passed. Width 100 dropped provenance while retaining dollars; width 140 retained both. Temporary test removed; no product source changed.
- Documentation links/line targets, task ID uniqueness and `git diff --check` checked. Full suites not rerun for documentation-only output. No browser, live TUI, provider, production runtime, release or deployment validation performed.
- Findings PT-097–PT-102 remain planned, with source-derived versus reproduced evidence identified. Review completion closes analysis only. Existing PT-009/PT-010/PT-016/PT-043/PT-053/PT-054/PT-069/PT-082 remain separate. No ADR decision or roadmap feature status changed.

Reproduce the isolated budget primitive from repository root:

```sh
pnpm exec tsx -e 'import { RunBudget } from "./src/runs/budget.ts"; const root = new RunBudget({max_cost_usd:1,max_tools:10,max_wall_s:60}); const first = root.allocate(root.remainingCost()); const secondAmount = root.remainingCost(); const second = root.allocate(secondAmount); let refused=false; try { second.checkModel(0,"second fanout child"); } catch (e) { refused = e instanceof Error && e.name === "BudgetExceeded"; } console.log(JSON.stringify({firstAllowance:first.config.max_cost_usd,secondAllowance:second.config.max_cost_usd,rootRemaining:root.remainingCost(),secondChildZeroSpendRefused:refused}));'
```
