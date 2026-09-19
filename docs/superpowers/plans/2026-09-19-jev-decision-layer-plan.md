# Jev decision layer — implementation plan

Generated: 2026-09-19. Task: PT-066; specification PT-067; implementation PT-068; live calibration PT-069. Primary: CORE-06; affected: CORE-04/05/07/08/09/11 and every runtime client. Implementation requires the companion PT-067 specification. This plan covers all requested decision uses; later sprints are required work, not optional follow-ups.

## Outcome and scope

Add a generic, profile-opt-in semantic decision service with a Jev adapter. Use typed judgments to select optional skill/tool context, promote supported memories, select recall context, maintain reversible retention state, flag contradictions, route existing workflows and specialists, preserve useful compaction evidence, and guide tool-result verification/failure recovery. Base remains responsible for policy, execution, content generation and persistence.

Default profiles retain existing behavior. No UI redesign, authentication, vector database, new deployment, or automatic selection of a different main LLM. No skill/body or tool schema becomes authority. Unknown applicability widens permitted discovery; unknown memory evidence cannot promote a fact. Explicit user instructions, loaded skill pins, temporal rules, approvals, provenance, quotas, budgets and cancellation remain authoritative.

## Research and current seams

Read AGENTS.md, CLAUDE.md, tracker, feature taxonomy, roadmap and relevant ADRs. Planner and typesafe-ai skills apply. Live official TypeSafe index/API, confidence, skill-suggestion and reranking docs were read 2026-09-19; `.md` pages worked via curl after the web tool returned `Internal Error`. No API credential or paid inference required for planning.

- `src/context/system-prompt.ts` currently concatenates project instructions, complete skill index and provider-rendered memory. Interactive, background and agent runners call it; `src/tools/builtin/delegate.ts` also constructs a prompt directly. Cover every route.
- `src/loop/agent-loop.ts` exposes the entire allowed tool registry. Separate the full execution registry from per-request selected schemas so persisted pending tool calls still resume normally.
- `src/context/digest.ts` promotes generated facts directly; `src/improver/default-improver.ts` promotes reflection memories; `MemoryWrite` preserves taint and undo. A shared evidence policy must cover automatic candidates and model-requested writes without blocking user-explicit supported saves.
- `src/memory/interface.ts`, filesystem/graph providers and query/temporal helpers own scope and validity. Existing conflict records preserve unresolved claims. Extend these contracts compatibly or wrap providers without requiring unsupported methods from third-party implementations.
- `src/workflow/triage.ts` already provides two-stage classification, clamp rules and fixed/adaptive policy. Route known choices through this seam.
- `src/context/pins.ts` and `projection.ts` own explicit pins and non-destructive context projection. Supplemental semantic preservation must not replace pins or damage tool-call/result groups.

Official references: [HTTP API](https://docs.typesafe.ai/api), [question primitives](https://docs.typesafe.ai/primitives), [confidence](https://docs.typesafe.ai/confidence), [skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion), [reranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe).

## Architecture decisions

1. Introduce `src/decisions/` with generic questions, validated answers, provider interface, per-run orchestration and pure feature policies. Keep vendor HTTP details in an adapter. Native fetch is sufficient; no new dependency required.
2. Profile schema adds optional decision settings: overall enabled/provider/model, explicit outbound-state permission, credential environment-variable name, bounded request/candidate/token/call/deadline budgets, price configuration and per-feature off/shadow/enforce modes. Omission means off. Credentials remain server-side and never appear in state, logs or profile serialization.
3. HTTP adapter follows current `POST https://api.typesafe.ai/v1/systemone`: `{model,state,questions}` and typed `answers` plus token usage. Validate all used IDs, finite probabilities/ranges, Choice membership/distribution and Score legend/distribution consistency. Noul probability has no confidence property. Treat malformed/missing answers as unavailable; never silently coerce them into yes/no decisions.
4. Batch independent questions over the same bounded state. Second stage permitted only for shortlisted body verification or genuinely new evidence. Deterministic no-match handling and candidate coverage are explicit. Caps must report truncation and preserve discovery instead of assuming omitted candidates are irrelevant.
5. Request identity contains user/profile/project/session/run/turn or stage, model, rubric version, candidate content revision and state hash. Cache only compatible decisions; discard stale completions after cancellation, steering or source changes. Never persist raw state in telemetry/cache. Resume reuses valid local selection or re-evaluates before a new model request; it cannot replay executed effects.
6. Enabling remote state explicitly permits only bounded whitelisted task/recent-message/candidate fields. Strip providerState, credentials and irrelevant private context. Outbound-denied profiles make zero requests. Unknown provider pricing under a cost-bounded run skips semantic inference; do not label unknown cost free. Reserve before dispatch/retry, settle actual reported usage, conservatively charge uncertain attempts, include decision spend in total run budgets and telemetry. Existing dispatch quota gates remain unchanged.
7. Ordinary service/format failures apply per-feature fallback. Abort, wall/cost exhaustion, credential or policy control failures propagate; they cannot become permissive fallback. Retry only retryable HTTP failures with bounded backoff inside the same deadline/reservation. Do not retry mutating tools automatically.
8. Document a narrow ADR-18 exception: optional ranking occurs only after structural scope/time retrieval; no embeddings or history retrieval. Extend ADR-19 explicitly: authoritative pins win over bounded supplemental semantic candidates. Taint is never cleared by a semantic judgment; no generated inference becomes executor evidence.

## Sprint 1 — decision contracts and runtime

**Runnable outcome:** a profile can run shadow decisions against an injected fake or Jev HTTP adapter with no change to task behavior.

- **1.1 Contracts/config.** Add `src/decisions/types.ts`, profile schema and config validation. Define typed result/unavailable/control outcomes and off/shadow/enforce feature modes. Test unchanged defaults, malformed budgets, missing permission, finite thresholds and profile serialization. Dependencies: specification.
- **1.2 Adapter.** Add `src/decisions/jev.ts` and factory. Validate exact current request/response structures, sanitize errors, bound response sizes, combine abort/deadline signals and retry 429/529 only within configured caps. HTTP fixture tests cover 401, 422, malformed JSON, partial answers, distribution mismatch, timeout and abort. Dependencies: 1.1.
- **1.3 Per-run service.** Add `src/decisions/runtime.ts`; wire through ToolContext and all run/agent/delegate entry points. Implement scoped cache, request hashes, usage attribution, reservations and safe reason telemetry. Test concurrent reservations, stale completions, resume, failed billed attempts and parent/child budgets. Dependencies: 1.2.
- **1.4 Architecture docs.** Record ADR decisions, schema reference and outbound-state/cost behavior. Update tracker with actual evidence. Dependencies: 1.3.

Demo: local fake HTTP service receives bounded state; shadow output equals disabled output; fake usage appears in total cost and abort prevents downstream changes.

## Sprint 2 — skill and tool attachment

**Runnable outcome:** enabled task requests contain selected optional capability metadata; missed capability remains discoverable through a real tool flow.

- **2.1 Candidate catalog/policy.** Build stable IDs for local/MCP/runtime/agent tools and skills from already-available metadata after runtime allowlists. Batch independent applicability Nouls; optionally verify shortlisted skill content. Handle zero/multiple applicable candidates, low-confidence uncertainty and catalog revisions. Dependencies: S1.
- **2.2 Prompt projection.** Rebuild bounded per-turn skill context from structured components, not string surgery on persisted prompts. Preserve mandatory project/profile instructions and exact explicit skill invocations; use existing Skill loading/pinning for bodies. Cover interactive, background, agent and delegate prompts. Dependencies: 2.1.
- **2.3 Schema selection/recovery.** Send only selected optional tool schemas while retaining permitted full execution registry. Add an always-available bounded capability discovery mechanism which exposes additional permitted schemas on the next model request; preserve Skill and necessary human/control tools. ACL/stage/effect checks still run at execution. Dependencies: 2.2.
- **2.4 Integration checks.** Test two relevant skills, no match, explicitly requested excluded skill, MCP refresh, discovery recovery, prohibited capability, stage change, follow-up steering and approved-call resume. Assert actual provider request payloads. Dependencies: 2.3.

Demo: request uses one selected tool, discovers a second initially missed tool, then executes it through normal gates; unrelated schema/body absent from request.

## Sprint 3 — supported memory capture

**Runnable outcome:** automatic digest/reflection and model-requested memory writes share source-grounded promotion rules; explicit durable user preferences survive.

- **3.1 Candidates/evidence.** Define candidate text, source IDs/spans, scope, temporal/claim metadata and taint. Extraction remains code/main-model work; Jev evaluates support, durability, utility and duplicate/conflict likelihood independently. Verify source IDs and content revision locally. Dependencies: S1.
- **3.2 Promotion policy.** Add shared capture service used by digest, reflection and MemoryWrite. Explicit save intent and trustworthy evidence are distinguished from assistant assertions, proposals and temporary observations. A denied/deferred automatic promotion returns truthful status rather than `Memory written`; existing undo and provenance remain. A source-supported explicit user save cannot be dropped because Jev is unavailable or salience is low; normal trust, scope and validation requirements still apply. Avoid gating deterministic internal routing-state persistence as human memory. Dependencies: 3.1.
- **3.3 Idempotence.** Stable source/candidate IDs avoid duplicate writes on digest retries, reflection reruns and fresh-process resume. Preserve existing temporal metadata and tainted provenance. Dependencies: 3.2.
- **3.4 Acceptance.** Exercise production digest/reflection/tool entry points with supported preference, speculative migration, failed deployment assertion, temporary status, duplicate and untrusted-source fixtures. Dependencies: 3.3.

Demo: supported convention stored with provenance; unsupported assistant claim absent; uncertain candidate retained as pending/rejected diagnostic rather than fact.

## Sprint 4 — recall, retention and contradictions

**Runnable outcome:** useful scoped memories enter current prompt, archival is reversible, semantic conflicts remain inspectable without rewriting history.

- **4.1 Recall.** Retrieve through existing scope/time/entity rules, then rerank bounded candidates. Preserve imminent entries, explicit pins and user-requested records. Implement honest candidate truncation plus direct-read/query recovery. Cover filesystem and graph providers; unsupported third-party features fall back to existing behavior. Dependencies: S1/S3.
- **4.2 Retention.** Persist additive reversible archive/review metadata, source revision and decision timestamp. Automatic archival requires configured policy and excludes pins, explicit retained preferences and unresolved commitments. Implement a real supported restore action through memory tooling; archived records remain listable/readable and history survives. Low salience never invokes delete. Dependencies: 4.1.
- **4.3 Contradictions.** Evaluate bounded structurally related claim pairs; persist source-linked unresolved semantic conflict records using existing store patterns. Duplicate detection is distinct from contradiction. Never auto-invent supersedes, choose a winner or clear taint. Invalidate stale assessments when records change. Dependencies: 4.2.
- **4.4 Acceptance.** Verify two-user/two-project isolation, half-open validity, legacy temporal absence, supersession history, imminent preservation, archive/restart/restore and uncertain semantic conflicts. Assert actual prompt contents. Dependencies: 4.3.

Demo: same stored inventory produces task-specific recall; a safely archived record is restored after reload; conflicting claims both remain available.

## Sprint 5 — workflow and specialist routing

**Runnable outcome:** opt-in Jev selects known task classes and bounded stage intensities in existing workflows; relevant specialist tools are discoverable.

- **5.1 Triage.** Integrate typed Choice decisions at triageA/B with explicit no-match/default routes and finite known criteria. Use configured playbook only; retain fixed routing and min/max intensity clamps. Jev cannot author plans, stages or profiles. Dependencies: S1.
- **5.2 Specialist coverage.** Ensure declared agent tools participate in S2 selection/discovery without changing delegation authority, quota checks or budgets. Dependencies: S2/5.1.
- **5.3 Acceptance.** Run actual workflow runner with fake Jev task-class/intensity decisions, uncertainty fallback, fixed-profile bypass and specialist selection. Verify stage ACL and lifecycle remain intact. Dependencies: 5.2.

Demo: request routes to an existing task class and appropriate declared specialist; impossible choices cannot create a new execution route.

## Sprint 6 — compaction preservation

**Runnable outcome:** unresolved commitments and concrete evidence survive projection under bounded supplementary retention.

- **6.1 Candidate selection.** Before digest/elision, nominate source-bound message groups for unresolved commitments or useful evidence. Do not ask Jev to generate summaries. Use known paired tool groups and stable source IDs. Dependencies: S1.
- **6.2 Projection integration.** Apply supplemental pins only inside remaining pin/context budget after explicit pins. Expire/re-evaluate supplemental state on task/source changes; ledger remains unchanged. Failure falls back to current projection. Dependencies: 6.1.
- **6.3 Acceptance.** Force real projection with long history; assert explicit pins, bounded semantic preservation, tool pairing and context ceiling. Test denied/cancelled stale judgments and exhausted pin budget. Dependencies: 6.2.

Demo: long session compacts while retaining an unresolved user commitment and verified result; irrelevant historical output leaves current context.

## Sprint 7 — result evidence and failure guidance

**Runnable outcome:** tool results produce bounded semantic guidance consumed by the next model turn without manufacturing success or retrying effects.

- **7.1 Result adequacy.** After real execution, evaluate whether output answers the current question and whether further verification is needed. Attach bounded advisory context with executor tool-call/source IDs. Preserve the original result and deterministic `ok`; do not reinterpret advice as authenticated evidence. Dependencies: S1/S2.
- **7.2 Failure routing.** Classify failures into existing bounded guidance options: retry recommendation, rediscover, escalate/ask, or stop. Code still owns retry caps, normal execution gates and cancellation. Denied, cancelled, parked and budget-exhausted actions cannot become retry recommendations. No automatic effect replay. Dependencies: 7.1.
- **7.3 Acceptance.** Exercise real loop with irrelevant-success output, partial evidence, transient read failure, denied write, cancellation, parked approval and stale response. Verify advisory enters next request exactly once and original evidence remains unchanged. Dependencies: 7.2.

Demo: semantically insufficient result prompts another permitted read; denied write remains denied and is not retried by the decision layer.

## Sprint 8 — evaluation and closeout

**Runnable outcome:** one reproducible acceptance command proves production integrations with local providers; a separate live evaluation command measures model quality when credentials exist.

- **8.1 Fixture suite.** Add labeled representative cases for all policies with required/forbidden selections, source truth and expected fallback. Include negatives, ambiguous tasks, omitted-candidate recovery and stale state. Compare disabled/shadow/enforce application behavior. Dependencies: S2–S7.
- **8.2 Mounted runtime acceptance.** Exercise actual profile runner/server plus fake main model and local fake Jev HTTP endpoint, not only direct helper calls. Cover selected payload, discovery, memory persistence/recall, routing, compaction, verification and failure guidance. No paid key required. Dependencies: 8.1.
- **8.3 Live evaluation.** Provide opt-in script producing safe aggregate capability recall/precision, missed-capability recovery, unsupported promotion rate, recall coverage, task success, latency, tokens and total cost. Record unknown prices and candidate misses honestly. Thresholds are provisional until evaluated in PT-069; shadow mode is the recommended first operational rollout. Configurable enforce mode can be implemented and fixture-accepted without claiming calibrated quality. No quality/latency savings claim from mocked results. Dependencies: 8.2.
- **8.4 Documentation/tracking.** Add usable YAML examples and operator troubleshooting. Update ADR, architecture map, task/component/feature rows and completion log. Record live Jev quality as a separate gap if credentials unavailable. Mark implementation complete only after every required sprint's concrete hook is tested. Dependencies: 8.3.

## Verification and commit discipline

Write failing behavioral tests before implementation. Keep one logical sprint/change per commit; include tracker updates. Establish baseline before edits. Run focused changed-path tests during work; before each commit run full `pnpm test`, then `pnpm typecheck`, `pnpm build`, `bash scripts/check-boundary.sh` and `git diff --check` as appropriate. Run protocol freshness and Go/Web checks if shared contracts change; absent wire/UI changes explicitly record no client source change required, while runtime clients inherit behavior. Capture exact counts and failures; never substitute mocked acceptance for live Jev quality.

Plan dependencies allow S3/5/6 work after S1 independently; integrate through one owner to avoid overlapping loop/prompt edits. User requested Luna High implementation; design uses Astra Low and specification Terra Medium. No work is silently transferred to another model.

## Risks, fallback and rollback

- Main-model prefix caching may lose efficiency from per-turn context; measure total cost including Jev.
- Relevance failures can hide needed capabilities; mandatory tools, explicit requests and real discovery recovery address this.
- Generated memory text may exceed evidence; local evidence identity plus separate support judgment and conservative promotion address it.
- Shared caches, stale source IDs and resumed calls can cross boundaries; scoped keys and generation checks are required.
- Cost estimates are not remote quota; preserve dispatch capacity gates and label actual/estimated/unknown values separately.
- Disabling decision config restores existing runtime selection. Archive markers remain reversible and discoverable; no rollback deletes records. Existing pins/history/approval calls stay intact. No service restart or deployment belongs to this implementation task unless separately requested.
