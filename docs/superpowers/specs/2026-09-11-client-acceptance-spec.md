# Client acceptance specification

Date: 2026-09-11. Owner: Luna high execution, parent review.
Planning: PT-040. Execution: PT-041, with acceptance against PT-002–PT-006.
Primary feature: CHAT-05. Affected: CHAT-01/03/04, TUI-01/04/05, OPS-05,
HOME-01/02 and existing analyst remote-read surfaces.
[Plan](../plans/2026-09-11-client-acceptance-plan.md).

## Outcome and authority

Prove the implemented C1–C4 client behavior through actual Web and TUI clients
connected to a real local harness. Fix narrowly reproduced client defects.
This is the acceptance continuation of the
[client uplift specification](2026-09-09-client-uplift-spec.md), not a replacement
for its requirements. Existing C1–C4 criteria remain mandatory; new matrix IDs
below make remaining proof explicit. Existing Core `resume`/`session_resumed`
contracts govern session recovery, rather than inventing an attach protocol.

Current baseline: `f56981e`; E-015–E-017 establish implementation and partial
browser checks. E-018 establishes corrective Core fixture checks. Neither pure
lifecycle helper tests nor requested URL assertions establish complete client
acceptance. No production release or external provider acceptance is implied.

## Scope and boundaries

- Allowed: client tests/fixtures, Web and Go TUI client fixes, test configuration,
  evidence reports and tracker updates. Keep current layout and interaction model.
- Use real local server and deterministic local fake provider for inference.
  Browser routing may delay/fail a request for fault injection, but populated
  scope and recovery success must exercise actual server responses.
- Do not change production Core behavior, protocol, schema or prompts. If Core
  blocks a gate, record a stable linked Core task with reproduction and continue
  independent gates. Do not redefine a failure as accepted.
- PT-007/PT-008 durable operator state/live inbox implementation, PT-009–PT-012
  export/storage/UX, Windows/install PT-013, Codex PT-014, device/model PT-015,
  effort picker PT-016 and Orchestrator PT-020 remain separate.
- Read-only inventory of overlap with PT-007/PT-008 is allowed. Event-tail loss
  cannot be used to claim PT-004/PT-005 done if it demonstrably violates those
  tasks' identity/recovery criteria; record dependency and leave affected task open.
- No paid inference, user credentials/profile changes, push, release or deployment.
  Keep patches individually committable; no automatic commits in this handoff.

## Fixture contract

Use a temporary task-owned home directory and two users A/B, profiles P/Q, with
unique disjoint transcript, memory, usage and audit markers. Verify fixture
records through existing stores/APIs; do not assume every endpoint supports a
profile filter. Record route scope as user-only, user/profile or aggregate.
Populate data before assertions; empty collections cannot prove isolation.

Start task-owned server/provider/Web processes on available ports with explicit
origin allowlisting and task-local environment. Build-time Next public endpoints
must match fixture endpoints. Never reuse an unknown server or stop an existing
user process. Existing `web/e2e/global-setup.ts` uses ambient home/profile and
fixed ports; use a separate acceptance config/fixture unless safely refactored
with old suites preserved. Cleanup owns only recorded child processes and temp
paths, including on failed setup, browser crash and interrupted run.

## Required acceptance matrix

| ID | Tasks | Scenario and required observable result |
|---|---|---|
| CA-01 | PT-002 | Backend down: submit editable text in real browser; text retained, reason visible, no false sent/working state. Restore backend and submit once; one server-observed message and one visible transcript entry. Distinguish socket write from server acknowledgment; do not claim exactly-once delivery across ambiguous disconnects. |
| CA-02 | PT-002/PT-003 | Audit actual send call sites for cancel, compact, approval, undo and other changed controls. Inject closed/write-failed transport; each applicable action surfaces failure without false success or losing pending input. Preserve busy-queue semantics. Real-browser cancel during a deterministic slow turn stops or visibly reports failure. Operator durable acknowledgment redesign remains PT-007. |
| CA-03 | PT-004 | Real browser switches A/P → B/Q → A/P with populated transcripts, usage, audit and memory. Confirm actual content and wire scope, no stale identity/profile residue, and labels for intentionally aggregate reads. Include scoped mutations already exposed by these clients using task-owned data. |
| CA-04 | PT-004 | Delay an A/P read, switch to B/Q, then release old response; old data never repopulates active UI. Cover history plus shared remote-read layer and dependent route state. |
| CA-05 | PT-005 | Actual mounted React client: repeated route mount/unmount, identity changes, reconnect button and forced socket drops. Count client-owned connections; exactly one active connection per mounted owner after settling, zero after teardown and zero orphan retries. Ignore callbacks from superseded sockets; assess shared shell socket separately from chat-owned socket. |
| CA-06 | PT-004/PT-005 | Disconnect and restart task-owned backend with persisted home; recover selected session/profile and history. Resume session under Q while connected under P; UI adopts authoritative Q from session_resumed. Missing/denied resume visibly reports failure and truthful current session, never silently claims restored history. |
| CA-07 | PT-003 | Run actual TUI binary in PTY against same fixture: connect, type input, backend down, failed submit retains text and notice; backend returns, send succeeds; selected session/profile restored or visibly failed. Capture terminal evidence plus server frames; splice real ws transport into model tests for deterministic failure assertions. |
| CA-08 | PT-003 | TUI cross-profile resume and missing-session recovery through real connection; check displayed profile/session and notice. Exercise affected shared navigation/cancel keys and queued-while-busy behavior after recovery. Pure model tests supplement, do not replace PTY run. |
| CA-09 | PT-006 | Real browser `/ops` and `/home`: loading, healthy empty, healthy populated, all-down and one-endpoint failure states. Failed reads name failure, show retry and never imply no outstanding work. Restart/retry recovers without reload; partial failure preserves successful panels. |
| CA-10 | PT-006 | Transcript history and existing analyst remote reads covered by C4: explicit error/retry rather than swallowed empty fallback. Inventory all applicable sites; execute representative real-browser fault/recovery per distinct shared integration, plus regression tests for remaining callers. |

Each row records PASS/FAIL/BLOCKED/NOT_RUN, date, exact command or interaction,
source version plus dirty changes, fixture conditions, expected/actual result,
durable evidence pointer and linked remaining task. Screenshots/terminal captures
must use synthetic data. Do not commit raw credentials, machine logs or artifacts
under ignored scratch paths as the only evidence; include readable report details.

## Completion rule

PT-040 finishes when spec/plan are saved, links checked and Luna high dispatched.
PT-041 finishes when matrix is executed or explicitly dispositioned, report and
tracker updated, discovered defects assigned and parent handback supplied.
A completed execution/report task does not close failing acceptance tasks.
PT-002–PT-006 close individually only when every mapped row and original C1–C4
criterion passes. Record any unavailable PTY/browser tool as an unmet gate.
Windows, paid provider/device quality and release remain explicitly unverified.

Use TDD for fixes. Final checks: root tests/typecheck/build, Web tests/typecheck/
production build and acceptance browser run, Go tests/build/vet, generated protocol
freshness and boundary guard. Record exact counts and skips; historical counts
are not fresh results. Core contract/schema/prompt compatibility: unchanged;
generated artifacts should remain unchanged unless regeneration proves stale.
