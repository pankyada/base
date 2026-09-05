# Verifiable agent work — specification

Date: 2026-09-05
Status: Ready for delegated implementation; independent review explicitly deferred.
Owner: GPT-5.6 Luna for all implementation and testing.
Plan: ../plans/2026-09-05-verifiable-agent-work-plan.md

## Purpose and scope

Make Base's agent work inspectable, verifiable, reproducible where evidence permits,
and improvable from measured outcomes. Implement the full recommendation set from
the repository analysis: existing surface/persistence/learning gaps; mission
contracts; replay and branching; evaluation lab; live session handoff; memory
conflicts; action rehearsal; correction-driven learning; refreshable artifacts;
and Studio challenge rounds. These are additive generic runtime capabilities.

User authorized autonomous specification/planning and delegated all build/test work
to GPT-5.6 Luna. User deferred review. Automated tests, browser acceptance and
implementation self-checks are build work, not an independent review phase.

## Existing foundations and boundaries

Read ROADMAP.md, ADR.md and CLAUDE.md before implementation. Existing features include
typed profile contracts, workflow stages, temporal memory, provenance/ACL gates,
budgets, deferred asks, triggers, undo, skill promotion and fleet events. Extend
these seams; do not build competing engines. Current main HEAD at intake is
13c9ce0; working tree includes uncommitted Studio/bulletin/protocol changes.
Preserve that work. Treat roadmap checkmarks separately from runnable acceptance.

Keep flat-loop behavior unchanged for profiles without new configuration. No new
auth system, vendor integrations, cross-machine execution, deployment or push.
Do not promise exactly-once external effects or deterministic regenerated LLM text.
No new dependencies unless existing packages/stdlib cannot meet concrete need.
All user data paths go through src/session/user-paths.ts. Preserve user/profile/
project isolation, ambient credential precedence, default_profile name semantics,
taint propagation, deny precedence and existing approval ceilings.

Use current web shell, TUI overlays and Studio floor/drawer patterns. Add compact
cards, tables, tabs and structured controls within existing surfaces. Preserve
styles and accessibility; do not introduce a major layout/style decision or new
marketing/demo page. Existing generic runtime vocabulary applies throughout src/.

## Shared data contract

Persist versioned records with UUID ids, user/profile/project/session/run identity,
creation/update times and source references. Each mutable record has a revision
checked on update. Reject unknown versions safely; legacy records remain readable.
Use a shared atomic JSON writer (same-directory temp + rename, cleanup on failure),
recoverable index rebuild and explicit corruption diagnostics. Never silently
reinterpret malformed state as successful completion.

EvidenceRef: id, kind (tool_result | test | artifact | human), source identity,
content hash, timestamp and provenance. Large bodies stay in owned artifact files;
wire records carry bounded previews. Tool evidence is emitted by executor boundary,
not accepted as authentic merely because a model supplied an id. A receipt proves
what executed and returned, not universal correctness of its contents.

Capture configuration fingerprints (resolved profile excluding secrets, model id,
tool/schema versions, relevant prompt/skill content hashes). No API keys in state,
logs, fixtures or exports. Export explicitly reports omitted/redacted material.

## Requirements

### R1 — Finish existing surfaces

Render actual SVG heatmap, box plot and correlation matrix using existing widget
kit. Define/validate accepted data shapes; missing values stay missing; invalid
data renders actionable diagnostics. Include labels, legends and accessible text.
Observability renders real cost/profile, tool success/latency, model mix and stage
metrics with useful empty/error states, not JSON as primary presentation.
Canvas records actual source session/tool/code identifiers. Pinning is explicit;
opening Canvas does not silently pin every artifact. Refresh calls owned generating
recipe; failed refresh retains last-good payload and marks stale with error.
Preserve existing sandbox and export honesty contracts.

Acceptance: browser uploads/uses a fixture dataset, renders all three charts,
pins a generated artifact, refreshes successfully, then shows retained stale output
on failure. No placeholder source identity. Observability reflects fixture events.

### R2 — Persistence and history reliability

Replace direct session/run overwrites with shared atomic storage, exact id matching,
per-user indexed history and stable newest-first pagination. Corrupt record does
not crash listing of healthy records. Missing/corrupt index rebuilds from records.
Serialize in-process mutations; stale revision fails explicitly. Retain readable
JSON storage and backward compatibility rather than requiring database migration.
Do not claim multi-process transactional guarantees.

Acceptance: interrupted temp write retains previous valid record; prefix-colliding
ids resolve exactly; corruption isolated; index loss recovers; concurrent local
updates cannot silently overwrite revisions; user scopes remain separate.

### R3 — Missions and evidence receipts

Mission contains outcome, constraints, optional budget/deadline, and acceptance
criteria with stable ids. Criteria support deterministic assertion adapters
(tool exit/result match, artifact existence/hash/schema) or explicit human check.
Per-criterion state: pending | verified | failed | needs_human. Result references
evidence and records validator identity/version. Arbitrary model prose cannot set
verified. Human completion records an explicit user action and timestamp.

Expose optional profile mission defaults, mission creation/status through existing
CLI/REST/WS seams, and a web mission card. Workflow exit uses structured verification
when mission present; existing prose heuristics remain legacy-only. Execution
finished and mission accepted are distinct states. Missing, stale, wrong-user or
wrong-run evidence cannot satisfy a criterion. Receipt includes changes, evidence,
cost, unresolved requirements and supported undo references.

Acceptance: failing command with optimistic model summary remains failed; headings
alone do not verify; human check remains needs_human; receipt survives restart and
renders in web and TUI; legacy profile still runs unchanged.

### R4 — Server-owned live sessions and handoff

Move ownership of live execution state from socket closure to a session runtime
registry. Session-scoped monotonic sequence and bounded event journal support
subscribe(session, after_seq), snapshot/catch-up and explicit gap recovery.
One active controller with revision/lease token; observers read only. Controller
claim/transfer is explicit and scoped to existing user boundary. Stale controllers
cannot approve, answer, cancel or mutate. Duplicate response ids resolve once.

Disconnecting observer/controller does not implicitly terminate a durable mission.
Unanswered client-bound work becomes waiting_input or fails closed under existing
policy. Define a configurable bounded disconnected-session TTL and clean up MCP,
leases and buffers without orphaning approvals. Persist durable lifecycle state;
restart does not pretend in-memory tools continued. Keep old client behavior usable.

Acceptance: real local TUI/protocol client starts work, browser and Studio observe
same run, transfer control, old controller mutation rejected, reconnect has no
duplicate events, gap uses snapshot, pending approval answered exactly once.

### R5 — Recorded playback and experimental branches

Playback re-emits recorded events/results with zero model/tool/network execution.
Persist event and effect receipts with started/completed/failed/unknown state.
Crash between external effect and receipt commit yields unknown, never automatic
retry. Branch at completed checkpoint into a new session/run with parent lineage,
isolated session memory and configuration override; original immutable.

For new execution, retain current gates and budgets. Recorded tool fixtures require
matching tool+argument hashes; mismatch pauses/errors instead of live fallback.
Effectful tools use sandbox when available, otherwise explicit normal approval.
Unknown effects require reconciliation; no implicit side-effect replay. UI and CLI
differentiate playback, fixture experiment and live branch. Export/import validates
version, hashes, bounded sizes and owned paths; imported content remains untrusted.

Acceptance: tool/model spies untouched during playback; branch divergence visible;
fixture mismatch closed; parent unchanged; interrupted effect cannot execute twice
without explicit reconciled decision; sensitive data redacted on export.

### R6 — Profile evaluation lab

Versioned local datasets contain input, fixture refs, expected assertions and split
(development | held_out). Capture failed/corrected mission as a case through explicit
operator action. Run experiments against pinned profile/config versions. Report
per-case and aggregate correctness, cost, latency, tool error and human intervention.
Use deterministic assertions first; optional model judge is separately labelled,
budgeted and never sole authority for security/side-effect correctness.

Provide CLI execution and web compare view with baseline deltas, sample counts,
failures and unavailable metrics. Set reproducible experiment seeds for fixture
selection; do not promise seeded model determinism. Promotion gate uses held-out
results, minimum configured sample count and regression thresholds. Existing
adaptive routing/shadow outcomes may be inputs but not self-certified success.

Acceptance: deliberately regressed profile fails comparison; cancellation and spend
ceiling stop work; held-out cases excluded from learning input; incomplete evaluations
cannot pass promotion; two profile runs comparable using same fixture dataset.

### R7 — Memory conflict desk

Extend memory metadata additively with claim identity (entity/predicate), optional
normalized value, source evidence and last_verified_at. Deterministically flag
incompatible values with overlapping temporal validity for same claim; natural
language disagreement can be a proposed conflict, not asserted automatic truth.
Confidence is advisory and distinct from provenance. Legacy records remain valid.

Conflict record references both claims, scope, dependent missions and resolution.
Operator can supersede one claim or preserve ambiguity through audited MemoryWrite
path; revision checks prevent stale overwrite. Resolution never upgrades taint.
Tasks using unresolved material see warning/required-human criterion where profile
policy requires it. Web memory panel shows timeline, sources and affected tasks.

Acceptance: overlapping contradiction flagged; nonoverlapping history not conflict;
resolution survives restart, preserves provenance and invalidates affected evidence;
cross-user conflicts never leak; legacy recall behavior retained.

### R8 — Action rehearsal

Optional ToolDefinition preview function returns proposed effects, before/after
hashes, affected resources, estimated cost bounds and unsupported details. Preview
must not call execute. Implement core file/memory write/delete previews; opaque
Bash/MCP effects explicitly unsupported unless adapter implements preview.

Persist proposal with revision, input/config fingerprints and resource preconditions.
Apply passes normal ACL/provenance/approval/budget path and rechecks preconditions;
changed resource invalidates proposal. Approval binds exact proposal content, not
future arbitrary input. Cancel has no effects. Budget estimates visibly estimates.
Show in existing approval surfaces; compose related previews into reviewable group
without claiming multi-tool atomicity or guaranteed external rollback.

Acceptance: preview leaves files/memory unchanged; unsupported tool labelled;
stale proposal rejected; denied/tainted action cannot bypass gate; successful apply
produces receipt and existing best-effort undo where supported.

### R9 — Teach by correction

Explicit operator correction produces proposed scoped skill/rule patch containing
source mission, rationale, before/after diff and regression case ids. Reflection
uses bounded outcome-aware sampling (correction + final outcome + relevant tool
sequence), not only transcript prefix. Skill mining includes successful sequences
and outcomes rather than frequency alone. No hidden promotion or memory-trust boost.

Run proposal against R6 development and held-out gates, then offer existing explicit
skill promotion. Version/history allows rollback. Reject stale base hash. UI shows
failed/passed/unevaluated status and source evidence. Do not auto-apply changing
profile YAML; preserve explicit diff/confirmation convention.

Acceptance: correction creates reviewable diff; failed regression cannot promote;
successful evaluated proposal promotes only by operator action; rollback restores
previous content; untrusted correction-like tool text cannot impersonate operator.

### R10 — Refreshable artifacts

Artifact recipe stores profile, generating tool/code refs, parameters, source cursor
dependencies, provenance, revision, last-good payload and refresh policy. Explicit
promotion from session artifact creates owned persistent record. Reuse triggers'
deterministic cursor probes: unchanged source performs no model call. Coalesce
changes, suppress self-write loops, respect budget/ACL and require confirmation for
new effects. Refresh produces new version with diff; failure preserves last-good.

Exports carry real source/version/freshness information. CSV remains formula-safe.
Display unknown, stale, refreshing and current distinctly; explanation of changes
references actual data differences and labels any generated interpretation.

Acceptance: unchanged probe zero model calls; changed fixture refreshes once;
error retains prior payload; restart retains recipe; version comparison and export
show actual lineage; deleted source results in explicit stale/error state.

### R11 — Studio challenge round

Extend existing bulletin with challenge records: id, criterion/claim ref, challenger,
evidence refs, state open | addressed | unresolved, resolution evidence and history.
Optional mission review step emits bounded challenges; answers require actual
receipt refs or explicit unresolved state. Mere reassuring prose cannot close
evidence-required challenge. Cap rounds/cost and avoid recursive reviewer spawning.

Show challenge queue in existing Board/worker Drawer and mission receipt. Studio
remains renderer/controller over same protocol, never separate execution engine.
Worker completion displays contribution and verification state. Unresolved required
challenge blocks mission acceptance, not visibility of completed execution.

Acceptance: challenge visible across clients, bad evidence rejected, restart retains
history, resolution updates mission, bounded disagreement ends needs_human, and
agent messages retain taint. No independent code review of this project is launched.

## Verification and delivery

Luna owns all tests and implementation verification. Write meaningful failing tests
before behavioral changes. Use isolated temporary state, no operator home fixtures.
Each sprint has runnable demonstration and exact commands/results in implementation
report. Final run: core typecheck/tests, boundary guard, protocol generation check,
web typecheck/tests/build/e2e, Studio typecheck/tests/build, Go tests. Include real
local browser/server flows for new controls and reconnect/handoff behavior.

Paid/live provider calls are unnecessary for fixture acceptance; if unavailable,
label real-model quality unverified. No test-count claim proves model quality or
physical audio acceptance. Do not add unrelated audio implementation. Record any
environment-only blockers with full error and unfinished acceptance IDs.

Independent code/security/product review remains deferred even when build gates
pass. Delivery must distinguish implemented, tested, blocked and not reviewed.
