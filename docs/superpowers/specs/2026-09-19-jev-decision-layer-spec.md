# Jev decision layer specification

**Task:** PT-067 (specification); implementation tasks PT-068+  
**Date:** 2026-09-19  
**Status:** implementation specification; pending feature-branch adoption  
**Primary feature:** CORE-05, CORE-06, CORE-07, CORE-08, CORE-09, CORE-10, CORE-11  
**Affected clients:** Core runtime and profile authors. No client protocol or UI change is required. Existing TUI, Web, Studio, unattended and delegated callers retain their current wire contracts.

## 1. Goal and non-goals

Add an optional, profile-owned TypeSafe Jev decision provider. It supplies typed, bounded semantic judgments which Base code composes into context selection, evidence-aware memory handling, and advisory routing. It is never an authority for tool execution, approvals, access control, provenance, budget admission, or user intent.

The implementation tasks created from this specification must support the following complete runtime paths:

1. Capability selection: attach only Jev-selected optional skill instructions and tool schemas, retain mandatory capabilities, and provide a bounded rediscovery path.
2. Memory: score automatic capture only after evidence checks; rank only structurally retrieved, scope-valid memory candidates; retain explicit pins and user requests; archive rather than delete low-salience records; record unresolved conflicts.
3. Workflow and execution advice: select among existing workflow task classes/intensities and existing specialist-agent tools; preserve compaction commitments; assess whether a completed tool result addressed the immediate need; classify a failure for advisory retry, discovery, escalation, or stop.

The feature does not add vector search, embeddings, dynamic playbooks, dynamically invented tools or agents, automatic mutation retries, a user interface, a new WebSocket version, cross-account sharing, or a claim of live Jev quality from mocks.

## 2. Design constraints

### 2.1 Default compatibility and profile boundary

`decision_layer` is absent or disabled by default. With it absent, disabled, feature-disabled, or in shadow mode, every current runtime path must retain the same system prompt content, provider tool-schema set, memory writes, workflow routing, tool execution behavior, retry behavior, and wire frames as its baseline, except for explicitly documented, bounded telemetry that has no raw prompt, tool payload, secret, or model response content.

Enabling Jev requires both a configured provider and an explicit `allow_remote_state: true`. An API key is resolved only by an environment-variable *name* in the profile; its value never enters profile rendering, errors, decision records, telemetry, or tests. Profile validation rejects contradictory or incomplete enabled configuration and requires a nonempty pinned model identifier, but does not pretend to know the vendor's model catalog; server rejection follows the existing provider-error path. It permits explicit input/output pricing where bounded run-cost accounting is configured. A missing cost model does not mean zero cost: the call is skipped with an `unknown_cost` reason when budget enforcement needs pricing.

Every subfeature has a mode: `disabled`, `shadow`, or `enforce`. Shadow makes a decision and records its safe metadata but does not alter application behavior. Enforce can alter only the bounded selection/advisory surface named here. A profile can enable only a subset. It may never cause a profile without `workflow.enabled` to enter the workflow runner.

### 2.2 Decision provider contract

Create a generic decision-provider interface separate from model providers. The Jev HTTP adapter calls the documented System One endpoint using authenticated JSON with configured model, bounded named state, and typed questions. It validates all response shapes before use:

- Noul is a finite probability in `[0,1]`; it has no confidence field.
- Choice contains one configured option, a finite probability distribution over only configured options, and finite confidence in `[0,1]`.
- Score contains configured levels, a valid probability distribution, and finite confidence in `[0,1]`.
- Unknown fields are ignored; invalid, partial, malformed, stale, or mismatched answers are provider failures and cannot change an enforced result.

Questions and state are versioned semantic contracts owned by code. Independent questions over the same bounded state are batched. The provider accepts the caller's abort signal and inherited deadline. Requests observe configured request-count, byte, token, and cost reservations before dispatch; retries are bounded and only for documented availability responses such as rate limiting or transient service failure. Cancellation, deadline, policy/budget gates, and authentication/configuration errors propagate through their existing control paths. Ordinary Jev availability failures fall back according to the feature-specific policy below. Decision response caches are keyed only by a safe content digest plus question/model/config version, obey a bounded TTL, are scoped so users/profiles/projects cannot share private results, and are not a persistence mechanism for raw state.

Only a whitelist of data leaves the harness. Each caller constructs its own minimum state from the user request, relevant recent public messages, stable candidate identifiers, candidate metadata/content subject to configured byte caps, and the exact decision question. `providerState`, known credential/authorization fields, environment values, configured secret values, recognized secret-token formats, unsupported binary payloads, and non-whitelisted tool input/output fields are stripped before the adapter. Redaction runs before size truncation and before request logging. No raw request, response, prompt, candidate body, source evidence text, or secret is emitted by decision telemetry. This is a bounded, testable redaction policy, not a claim to detect every arbitrary secret embedded in free text.

The safe record contains feature, mode, model/version, outcome label or selected stable IDs, finite probabilities/confidence when available, safe fallback reason, duration, request/response byte and token/cost counters where provided, and correlation/run identifiers. It does not contain content. A decision cannot be reused after the candidate-set or input-state digest changes.

### 2.3 Existing safety rules remain authoritative

Jev is a semantic adviser only. Existing ACL predicates, effects, approvals, denial behavior, taint handling, provenance, execution allowlists, cancellation, pending-input handling, budget gates, and audit receipts execute unchanged and after any decision. A selected provider schema is a presentation view of executable tools, not a new executor registry or authorization grant.

Tainted input remains tainted through a decision call. A decision can neither mark it trusted nor omit its source. Memory writes preserve caller-provided scope, taint, source, source evidence IDs, temporal fields, claim metadata, and supersession semantics. A tainted record cannot be promoted as trusted because Jev considers it relevant or supported. Delegated children inherit the existing taint and budget restrictions; decisions cannot cause a parent or child to bypass them.

This is an additive, opt-in exception to ADR-18 only: Jev can rank a structural candidate set already retrieved by the existing scope/link/entity/relation/temporal query rules. It cannot introduce vector retrieval, embeddings, or query the whole transcript/history as a candidate corpus. ADR-19 pins, temporal validity and imminent entries remain authoritative.

## 3. Capability selection

### 3.1 Candidate construction and selections

Construct candidates from existing loaded skills and runtime tool definitions after current availability/runtime restrictions have been applied. Each candidate has a stable ID, type, label/description, capability tags, mandatory flag, safe schema summary, and content-size estimate. Do not send full skill bodies or full schemas merely to decide applicability. ACL-denied tools retain baseline visibility when the decision layer is disabled or shadowed; enforce selection may narrow optional schemas but cannot grant a denied tool.

Jev receives one independent Noul question per optional candidate: whether it is applicable to the present request and runtime task. The composition policy is configured and evaluated against local calibration evidence, not a cookbook constant. It supports a clear `none applicable` result. Enforce passes only selected optional skill bodies and only selected optional tool schemas to the main model.

Always attach:

- repository/profile/system requirements and any requested skill;
- mandatory control, safety, approval, input, restore, and discovery capability required by the existing path;
- a capability rediscovery route that exposes the safe index and can request a fresh selection; and
- schemas needed to complete an existing assistant tool-call/approval continuation.

The selected schema set is intersected with all current runtime restrictions: registered tools, MCP availability, runtime allowlist, read-only/mutating restrictions, and profile policy. Selection must never expose a denied tool and must never remove an already-issued assistant tool call from its executor lookup. Existing tool IDs can still be parsed, audited, approved, parked, resumed, denied, cancelled and reported even when a new context build would not select their schema.

On low applicability probability, ambiguity, insufficient candidate coverage, timeout, malformed answer, provider outage, or budget skip, enforcement widens to its documented safe fallback: mandatory capabilities plus the bounded capability index/rediscovery path. It must not silently render a needed optional capability unreachable. Shadow selection cannot alter attached content.

### 3.2 Integration points

Apply the same context assembly abstraction, rather than system-prompt substring surgery, to all production builders: ordinary interactive turns, approval follow-ons, workflow stages and plan previews, persisted pending-input resume, `agents/runner` delegated agents, and Town/unattended task execution. The profile's configured workflow playbook remains authoritative. Subagents have their own loaded profile/skills/candidate set; they do not inherit an accidental parent context selection.

## 4. Memory

### 4.1 Automatic capture versus explicit memory requests

Automatic capture includes digest/reflection facts and any other automatic promotion hook. Before an automatic write, code supplies the proposed fact and exact stable evidence IDs/source references to Jev for separate judgments of support, durability, future usefulness, duplicate/supersession candidacy, and conflict candidacy. Evidence must be available to the caller; Jev cannot manufacture it. The deterministic policy only promotes records satisfying configured/calibrated rules and writes provenance, taint, scope, source evidence IDs, and verified-at time unchanged. Automatic capture on a decision failure, uncertainty, outage, unknown cost, cancellation, or budget skip defaults to no new promotion and records only a safe outcome. Digest text itself still follows its existing fallback behavior.

An explicit user-requested `MemoryWrite` has separate semantics. It must not be discarded merely because Jev is unavailable, uncertain, low-salience, or marks it non-durable. It writes using the user-specified or existing caller-default scope and retains existing validation, temporal and taint rules. Jev may create a non-blocking advisory/record only where configured, but must not rewrite content, scope, source, taint, evidence identity, or trust. Explicitly requested retention and existing pinned records override automatic salience pruning.

### 4.2 Recall, retention, and conflicts

Memory recall first uses current structural filtering: scope/ownership, query relation/entity/text semantics, temporal validity, supersession view, and configured limits. Imminent entries remain available under their existing rules. Jev receives only that bounded candidate set and may rank or select it for prompt attachment. It may not retrieve omitted candidates or convert invalid/expired records into valid ones. On uncertainty/failure it preserves deterministic structural ordering and availability.

Retention is non-destructive. A Jev retention decision may nominate non-pinned, non-explicit, active records for an auditable archive/review marker; it never calls delete. The marker preserves full record content, history, provenance, source evidence, temporal and claim metadata and is reversible through an exposed production operation (for example a documented restore tool or an explicit active retention state accepted by the existing memory-write contract). Archived records are excluded only according to documented query/render policy and can be restored by stable ID. Supersession still collapses only the active view and never erases history.

Conflict detection may nominate an existing structured entity/predicate pair and stable source IDs. It creates an unresolved conflict record containing the named records and explicit semantic/evidence rationale metadata. It never overwrites normalized values, marks a guessed record as superseding, deletes either side, changes trust, or resolves the conflict without an existing deterministic or human-reviewed mechanism.

### 4.3 Memory data compatibility

Both filesystem and graph providers implement any added metadata with equivalent read/write/list/query behavior. Existing memory lacking new fields remains readable and follows today's semantics: absent temporal fields are valid as before; existing active records remain active; legacy pins and supersession are preserved. User scope remains private, profile scope remains shared, and project/session boundaries remain unchanged.

## 5. Advisory routing, compaction, and execution evidence

Workflow triage may use Jev only to choose among existing task classes and existing stage intensity options consumed by `triageA`/`triageB`, and to identify an already configured specialist-agent tool. Fixed routing rules, configured playbook, tier policy, stage contracts, retries, and budgets remain authoritative. Jev cannot invent a playbook, stage, profile, agent, model tier, or task class. A decision failure falls back to current deterministic triage.

During compaction, Jev may nominate source message groups containing unresolved commitments or evidence worth preserving as *supplemental* pins. Code validates source indices, keeps assistant-tool call/result pairs intact, honors explicit pins before nominations, respects the remaining pin/context budget, and records stable source IDs. The digest/projection must retain its current destructive-condensation protections and fallback behavior. Jev cannot rewrite, fabricate, or make a source group available after it has been removed; it only selects from groups passed by code.

After a completed tool batch, Jev can assess bounded executor output against the immediate requested subgoal and return a safe advisory label such as sufficient, needs-discovery, needs-verification, or insufficient. Existing `onEvidence` values are authenticated executor facts and must not be changed by the assessment. The agent may receive a bounded advisory context tied to the tool-call ID; the assessment does not transform tool output into trusted evidence, fabricate a completion receipt, or authorize a side effect.

For a tool failure, Jev can classify only an already observed failure as retry, rediscover, escalate, or stop. Code retains the original error and existing retry bounds. It never automatically replays a mutating/outbound/destructive tool because of Jev; it never replays a denied, approval-waiting, parked, cancelled, stale, or aborted call; it never replaces a user decision; and it never turns a provider control failure into a generic retry. The main model may make a new permitted request through normal policy.

## 6. Acceptance criteria

### A. Configuration, contract, privacy, and failure

- Schema tests prove an absent configuration and every `disabled` feature preserve baseline behavior; malformed config, enabled-without-remote-consent, empty model/cost policy contradictions, and secret literals fail validation without echoing secret text. The schema accepts an arbitrary nonempty pinned model identifier; server-side rejection follows the provider-error path.
- HTTP adapter tests use a deterministic mock server to prove request endpoint/method/auth header shape, named state/questions/model, response validation for valid Noul/Choice/Score and each invalid field/distribution, timeout/deadline/abort propagation, bounded retry, scoped cache invalidation, and safe telemetry redaction.
- Tests prove request state excludes `providerState`, credentials, unwhitelisted tool fields and raw payload logging. They exercise redaction before truncation. Profile/log/audit/telemetry snapshots contain environment variable names only, never key values or sent content.
- Tests prove reservation/deadline/request/byte limits skip calls rather than exceed them; missing required price yields `unknown_cost`, not a zero-cost decision. Service outage, 429/529 exhaustion, malformed result and cache miss produce each specified feature fallback.
- A live Jev smoke/benchmark is optional and separately gated by a supplied API key and remote consent. Its report records model/config/date, corpus provenance, request counts, measured latency/cost and observed outcomes. It does not claim production accuracy, calibrate an untested threshold, or close PT-067 by itself. No live call is required for deterministic suite success.

### B. Skills and tools in production paths

- Deterministic fixtures show requested/mandatory skills and required control/discovery capabilities always attach, while applicable and inapplicable optional skills/tools respectively attach and stay omitted in enforce mode. Shadow produces the same final context/tool schemas as disabled.
- Tests prove no-match/ambiguous/outage/invalid/budget decision produces the documented recovery context and a fresh rediscovery attempt can select an omitted optional capability.
- Mounted tests cover interactive initial turn and approval follow-on, workflow stage/preview, pending resume, delegated `agents/runner`, and Town/unattended construction. They assert the provider sees the intended selected schema/body set, while runtime executor restrictions still win.
- An already-issued tool call can complete/deny/park/resume/cancel after a later selection excludes its schema. Selected schemas never expose a non-registered/MCP-unavailable/allowlist-denied/mutating-denied tool.

### C. Memory capture, recall, retention, conflict

- A mounted digest/automatic-promotion test proves supported durable evidence promotes with exact scope, source evidence IDs, taint/trust, temporal and claim metadata; unsupported, uncertain, missing-evidence, duplicate and provider-failure cases do not silently write a new promoted record.
- Explicit user `MemoryWrite` succeeds under Jev outage/unknown-cost/uncertainty and preserves caller scope, temporal data, taint/source and content. It is not downgraded or discarded by retention.
- Filesystem and graph fixtures prove structural query happens before Jev ranking; invalid/expired/out-of-scope/omitted candidates cannot be recalled; fallback retains deterministic result availability; imminent, pinned and legacy temporal-less entries retain current availability.
- Retention tests prove a candidate becomes auditable archived/review state with full data intact, explicit/pinned records remain active, and a production restore operation makes the same stable record active again. No retention flow invokes delete.
- Conflict tests prove two conflicting structured candidates create an unresolved record with stable sources/evidence metadata, leave original records unchanged, and never infer `supersedes` or trust. Existing supersession view and history remain unchanged.

### D. Routing, compaction, and evidence/failure advice

- Mounted workflow tests prove enforce decisions select only preconfigured task classes/intensities/specialists; fixed policies and disabled workflow preserve baseline. No decision creates a playbook/stage/profile/tier.
- Projection tests prove nominated supplemental pin groups retain source identity and tool-pair integrity within budget; explicit pins and unresolved commitments win conflicts; disabled/shadow projection remains baseline; digest failure/backstop still works.
- Loop tests prove result advisories are tied to executor output and cannot alter `onEvidence`, provenance, audit receipt, tool result or effect. Failure labels never auto-execute a second tool and preserve denied, approval, parked, cancellation, abort, stale-event and provider-control paths.
- Taint tests cover memory, delegation, and file laundering closures with decisions enabled. No decision output upgrades taint or permits a restricted effect.

### E. Regression and honest status

- Run red/green focused tests during implementation, then `pnpm test`, `pnpm typecheck`, `pnpm build`, and `scripts/check-boundary.sh` from repository root. Record exact command outcomes/counts in PT-068 only when actually run.
- Update `docs/PRODUCT_STATE.md` before claiming completion: task row, affected component/feature state, compatibility (no WS/API bump unless evidence changes), dated completion evidence and separate remaining live/calibration/deployment gaps. Update ADR-18 narrowly to document opt-in structural-candidate ranking while preserving no-vector policy; update ADR only for other load-bearing adopted decisions. Update roadmap only if numbered scope/status changes.

## 7. Completion boundary

PT-067 is complete when this specification and its linked task split are adopted in the tracker. PT-068+ implementation tasks are complete only after all enabled production hooks above are covered by deterministic, mounted acceptance tests and the required suite/checks pass. A separate live-calibration task remains incomplete until it has a supplied API key, remote-data approval, a measured corpus and an honest report. Those gates are not substitutes for the deterministic contract and are not implied by a passing helper-only unit suite.
