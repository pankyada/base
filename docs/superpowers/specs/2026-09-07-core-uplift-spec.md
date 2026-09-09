# Core uplift specification

Date: 2026-09-07. Status: authorized Core-only implementation track.
Owner: parent specification/review; Luna high implementation.
Task range: PT-022–PT-030. [Implementation plan](../plans/2026-09-07-core-uplift-plan.md).

## Outcome and scope

Make existing Core behavior consistent, recoverable and inspectable for every client. Implement in order: scope → protocol recovery → human decisions → provider/effort → lifecycle/persistence/platform → prompts/execution/telemetry audits → orchestration contract groundwork.

Allowed: `src/`, Core tests, protocol generators and generated type artifacts, CLI diagnostics without interactive UX changes, relevant docs/ADR, build/CI scripts only for demonstrated Core validation needs. Excluded: handwritten `web/`, `tui/`, `studio/` UI/client behavior, layouts, preference selectors, dashboards, browser persistence/export fixes, game UI, product login/RBAC, new cloud/voice vendors, deployment, provider account changes and unrelated refactors. Generated client protocol files may change solely through the existing generator; do not claim client adoption from generated types.

User authorizes implementation, not a redesign of established policies. Preserve ADR-53–56, 69–70, 75–79, environment precedence, named default profile, current approval ceilings and provider billing ownership. No new packages without necessity. No live paid inference or credential changes required for local implementation acceptance; record external acceptance separately. Existing local credentials must not be read just to run fixtures.

## Baseline evidence and non-assumptions

- `src/server/read-api.ts` defaults missing scope to HARNESS_USER/anonymous; run/pending lists in `rest.ts` allow unscoped lists; some ID routes use global lookups. These are trusted-local API semantics today, not authentication.
- `SessionRuntime` already has events, snapshots, leases and deduplicated responses. Snapshots retain bounded event tails; response map is process-local. Reuse this implementation, do not build another registry/event bus.
- Existing `attach`, `runtime_subscribe`, `spawn`, `agents_list`, `board_post` contracts must be inventoried before additions.
- Model discovery drops effort metadata; `codexFallbackCapability` guesses capabilities and calls them live. Do not confuse model identity availability with verified capability.
- Prior persistence work has atomic writes, revisions and session pagination. Extend demonstrable gaps, do not replace stores.
- Several failures recorded in PT-002–PT-008 are client defects. This track provides/validates Core contracts and leaves those tasks open until clients adopt them.
- Prior effort spec refers to a protocol number that may be stale. Actual `PROTOCOL_VERSION` and generators are authority; do not copy a version from prose.

## S1 — Scope consistency (PT-023; CORE-01/07)

Requirements:

1. Inventory and document scope for REST/WS entrypoints reading or mutating sessions, runs, pending, memory, usage, audit, artifacts and missions. Distinguish intentionally aggregate operator reads from user-scoped routes.
2. Centralize explicit scope normalization/validation using existing user/project helpers. Never change persisted sanitization/key format in this sprint. Explicit malformed scope returns a bounded diagnostic, not a crash or implicit fallback. Validate input type before sanitizing.
3. Where routes accept explicit user/profile/session scope, enforce ownership before reading, cancellation, answering or mutation; wrong-scope IDs behave as not found with no existence/data leak. Contradictory body/query scope is rejected, not arbitrarily selected. Profile/session relationships must be checked when supplied.
4. Preserve legacy omitted-scope behavior unless a demonstrated defect requires a documented/versioned migration. In particular, do not globally replace missing user with `web-user`, infer identity from the last socket, or remove intended aggregate operator reads. Document that clients must pass scope explicitly; user identity remains caller-asserted.
5. Apply helpers through real routes, not just unused utility tests. Internal trusted global store lookup may remain when external callers enforce scope.

Acceptance: real local REST and WS fixture coverage with users A/B and profiles P/Q proves explicit isolation, missing/default compatibility, invalid type rejection, cross-user cancellation/answer denial and zero mutation on rejection. No product auth claim.

## S2 — Delivery, snapshots and recovery (PT-024; CORE-02/03)

1. Publish a compact client contract for connect/hello, attach/observe/control, replay cursor, snapshot fallback, controller expiry and restart. Reuse current messages; only additive opt-in fields/messages if needed.
2. A runtime snapshot must retain authoritative current state needed for recovery independently of the bounded event tail. At minimum identify session/run, lifecycle, latest usage/budget information available, and outstanding actionable IDs where the runtime owns them. Integrate actual emitted events/state; no fabricated defaults. Bound previews and persistence.
3. Cursors older than retained events or ahead of current sequence produce explicit snapshot/resync behavior. Snapshot must be detached from mutable internal state. Restart clears controller authority and reports interrupted in-memory execution honestly.
4. Scope all response deduplication to owning runtime/action/controller. Bound retention. Concurrent duplicate responses must not execute a handler twice; failures and retry policy are explicit. No exactly-once external-effect promise or blind durable replay after restart.
5. Add request correlation for new opt-in control operations where needed; negative acknowledgment must describe failure. Do not advertise generic message delivery guarantees for legacy messages without implementing them. Existing clients continue to receive expected responses.

Acceptance: local two-socket fixture, >event-retention overflow, stale/future cursor, disconnect/control reclaim, observer rejection, duplicate concurrent response, failed handler, registry reconstruction. Acknowledgment means Core accepted the action, not a tool succeeded or client delivered offline input.

## S3 — Human decisions (PT-025; CORE-08)

1. Inventory interactive approvals versus durable PendingStore questions. Preserve their distinct lifecycles; persisted questions are not callbacks to revive blindly after crash.
2. Expose scoped outstanding state through existing list/snapshot contracts, extending additively if required. Outstanding items must not disappear after ordinary event-tail eviction. Include existing type/options/TTL/run identity and truthful state.
3. Route answering/approving through existing validators, ACL ceilings, provenance and lease/controller checks. Validate expiry/revision where applicable and reconcile simultaneous answer/cancel/expire. Remember grants stay session-only and never override deny.
4. Return correlated success/failure for supported opt-in decisions; only report success after the state transition is recorded. Duplicate answers cannot resume twice. Preserve existing legacy error text where compatibility tests require it.
5. After restart, durable pending questions remain discoverable; ephemeral approvals become explicitly unavailable/interrupted rather than resurrecting execution.

Acceptance: restart/re-list, type/options validation, expired/answered ID, competing answers, cancellation race, cross-scope action, observer action, deny versus remember, event-tail overflow. Test mounted route/WS paths as well as stores.

## S4 — Provider/model/effort Core (PT-026; CORE-04)

Core-only subset of [model-effort spec](2026-09-06-model-effort-selection-spec.md). Its UI/setup picker changes and provider expansion remain excluded. This spec narrows implementation scope; preserve its capability/default/alias semantics.

1. Retain validated bounded provider effort metadata, exact transport/account/endpoint scope, provenance/freshness and unknown/unsupported distinction. Stop presenting prefix-derived guesses as live evidence. Unknown metadata must not prevent a previously valid model ID using provider default solely because effort metadata is absent.
2. Supported/default effort metadata is server-owned. Default is omission/null; `none` is literal only if supported. Do not enable ultra/provider-managed delegation without verified adapter support. Account IDs/tokens and credentials never reach public protocol, telemetry or preferences.
3. Add optional shared profile effort syntax with deprecated alias conflict handling; validate syntax offline and explicit capability at execution/selection. Do not rewrite shipped/user profiles or change default provider, transport, billing mode or budget.
4. Atomically validate model/effort with optional request ID on existing selection contract. Reject while busy/observer; recheck session/profile/account generation after async discovery. Capture effective pair per turn; retries keep it; helper/delegated/workflow models resolve their own settings.
5. Implement on currently supported Codex transport using fixture/live-catalog shape evidence. API-key transports only expose explicit effort when exact current official adapter payload support is verified; otherwise remain unknown/adapter-unavailable with provider-default legacy behavior. Native Anthropic adapter/new Responses transport is not authorized by this sprint.
6. Selection metadata and supported Core capabilities may be generated into client types; no handwritten client changes. Record that full PT-016 and PT-014 remain open for UI and live provider acceptance.

Acceptance: fixture discovery → WS selection/ack → outgoing provider payload; default/none distinction, invalid pair atomic rejection, stale metadata, account/profile switch race, removed option, alias conflict, tool continuation, retries/helper isolation, unknown model default, redaction. Provider API changes require fresh primary documentation before implementation; no remembered model-name inference.

## S5 — Lifecycle, persistence and platform evidence (PT-027; CORE-02/07/10/12)

1. Build a local fixture matrix for concurrent profiles, lazy MCP lifecycle/global concurrency, cancellation/shutdown/restart and fake STT/TTS barge-in. Fix only reproduced Core defects; preserve generic voice interfaces and no crash-isolation claim.
2. Run history gains validated bounded cursor pagination through an opt-in/additive route shape; preserve existing store/list consumers. Stable ordering needs deterministic tie-breaker, cursor validation and scope binding. Document insertion/deletion behavior. Expose recovery diagnostics where already available without disclosing paths/secrets.
3. Exercise conditional revision updates, corruption isolation, run ownership and server-owned interruption after restart. Atomic records do not imply multi-process transactions or exactly-once effects.
4. Improve existing doctor/health/version diagnostics only where they cannot distinguish requested/selected/running Core state. No new selector, installer UX or profile writer. Produce exact local build/process/platform evidence and runnable external acceptance checklist.

Acceptance: real temporary server and fake provider/MCP/voice boundaries, concurrency bound, cancellation final state, repeated startup/stop without owned resource leaks, history cursor isolation/ties, corrupted record recovery. Windows/device/live-provider gates remain pending unless actually executed; cross-compilation is not Windows acceptance.

## S6 — Prompt/config, execution and telemetry cleanup (PT-028; CORE-05/06/11)

Audit-first, bounded scope:

1. Map effective config/prompt assembly precedence using real profile/instruction/memory/context seams. Add safe diagnostic metadata (sources, ordering, sizes, non-sensitive identifiers) through an existing diagnostic path or a small Core helper wired into it; never export prompt content, private memory or provider continuation by default. Preserve prompt behavior unless regression proves a defect.
2. Audit cancellation/deadlines through loop, helpers, tools, MCP, hooks and subprocesses. Add behavioral regression tests at demonstrated gaps and narrowly repair leaks, late writes or swallowed errors. Record reviewed paths and findings including no-change results; no blanket module rewrite.
3. Reconcile run/agent/tool identifiers and terminal/usage/budget states across WS/REST/SSE and saved telemetry. Use existing schemas; unknown remains unknown, subscription estimate is not billed charge, cancelled/failed/budget-exceeded are not success.

Acceptance: deterministic precedence tests and secret-canary exclusion, cancellation/deadline propagation with no late successful completion, correlated terminal/usage records on failure and child cancellation. All fixes linked to reproduced evidence in report.

## S7 — Orchestration Core groundwork (PT-029; CORE-09)

Deliver a Core contract inventory and executable compatibility tests for existing spawn/agents/cancel/board/attach/handoff semantics, scoped tasks/agents and budget ownership. Reuse implemented primitives. Fix only clear defects in existing ownership/cancellation/isolation contracts exposed by tests.

Do not decide persistent teammate identity, shared-checkout/worktree policy, orchestrator autonomy, new multi-agent scheduling architecture or game metaphor. Those remain PT-020 discovery. Record missing future contracts as proposals, not automatically implement them. This sprint can complete its inventory/test scope without claiming Orchestrator delivered.

## Common acceptance and delivery

- TDD for behavior fixes; tests invoke production seams and independently assert contracts. Fixture inference must not escape to network/provider credentials.
- Maintain requirement → test → result → remaining gate matrix in `docs/superpowers/reports/2026-09-07-core-uplift-acceptance.md`.
- Full root suite/typecheck/build and boundary guard; generated protocol freshness; client typechecks/Go tests when shared protocol changes (verification only, not permission to edit clients).
- Each sprint updates tracker/task/component/roadmap/ADR as appropriate before completion claim. Core-only subtasks do not close parent client/live tasks.
- Preserve pre-existing dirty work, especially Codex stream edits and unpublished effort docs. No broad staging, push, release, deployment, or destructive migration. Any commit must contain only classified task changes and pass repository checks.
