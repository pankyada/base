# Client acceptance and operator implementation checkpoint

Date: 2026-09-12 (Australia/Sydney). Base source: `f56981e` plus current uncommitted client, fixture, and documentation changes. No production Core protocol/API/schema/prompt changes. Local deterministic provider, real harness, production Web, and macOS TUI PTY; no paid provider, release, installation or deployment acceptance.

This checkpoint supersedes overbroad PASS/BLOCKED statements in the September 11 report. Missing test executions are remaining acceptance work, not external blockers.

## Implemented

- Web identity reset and stale transcript protection; manual reconnect closes superseded transport. Profile/control write refusal preserves current UI state and displays the actual error. Approval/input dialogs survive refused writes.
- Dataset list/detail failures and malformed responses are explicit and retryable. Selection and identity guards ignore late results. Upload preserves the scoped URL; schema parser consumes the real endpoint's direct schema response. Browser CSV upload exposed and verified both contract corrections.
- TUI resume hydrates selected history through existing scoped `/sessions/:id/messages`; HTTP deadline and identity/profile/session/revision guards prevent stale replacement. The earlier claim that missing history required a new Core protocol was incorrect.
- PT-007 client state retains approvals, skills and budget outside the 200-event display buffer; shell navigation preserves the shared provider. Decisions carry request IDs and remain pending until correlated acknowledgment; rejected writes/ACKs remain visible. Snapshot hydration does not invent missing prompt details.
- PT-008 supports validated text/select/multi-select answers; JSON arrays preserve commas in options. Pending-result correlation and store refresh distinguish recorded answers from failed continuations. Event-triggered refresh and bounded nonoverlapping five-second polling update asks, runs, channels and metrics; expiry/external answers remove stale inbox items. Read failures expose retry and update-age state; successful independent panels remain.

## Evidence and limits

Automated commands and final counts are recorded in tracker E-020. Fresh full browser run: 14/14 passed; added selected-Q/missing-resume case: targeted 1/1 passed. Web unit suite: 31 files/136 tests. Root: 170 files/966 tests passed, one file/three tests skipped. Go: seven packages passed test/build/vet. Reproducible browser entrypoint: `cd web && pnpm exec playwright test -c playwright.client-acceptance.config.ts`. Fixture uses temporary home, explicit origin, ports 18831/18832/3012, and task-owned child cleanup. `scripts/client-acceptance-sockets.mjs` is loaded only by the fixture to measure actual server connections after page teardown; normal runtime never imports it.

Browser cases cover populated A/P → B/Q → A/P memory/audit/usage with scoped responses, A/B transcript separation, delayed obsolete transcript response, mounted navigation and repeated identity changes, forced/manual reconnect, and server-side zero connections after teardown. They also cover same-session history recovery, selected Q-under-P authoritative profile/history and truthful missing-session error, visible transcript failure/retry, memory partial failure/retry, dataset upload/schema failure/retry, approval retention beyond 280 events, navigation, rejected/delayed ACK, transport refusal, slow-turn cancel refusal then successful cancellation, all three persisted answer kinds, external answer/expiry, run refresh and channel refresh failure/retry. Successful channel payloads are modeled; other populated success cases use real server responses and stores.

TUI local PTY evidence: selected session `70f01eef` restored its marker; p/q profile and navigation runs exited zero; queue/cancel showed `message queued`, retained both user inputs in persisted session and omitted cancelled slow completion. Go regression tests supplement the PTY evidence. Earlier missing-session visible-error evidence remains in the September 11 report.

## Still open

- **PT-007:** Core PT-044 now recovers an in-process approval through a same-session reconnect. TUI still needs live receipt/control acceptance; UI never creates controls from bare actionable IDs. Durable PendingStore asks remain separate and work through PT-008.
- **PT-043 / PT-002–PT-006 acceptance:** comprehensive per-control compact/undo/input-refusal matrix, delayed shared-route reads beyond transcript, persisted-backend-restart browser recovery, and complete loading/empty/populated/all-down matrix still need final execution. Covered subcases are not blanket PASS labels for the broader CA rows. TUI recovery implementation is now present; no missing-history Core blocker remains.
- Major operator/assistant UX, Windows/install, real providers/devices, and release/deployment remain outside this patch. No commit or push performed.

## PT-044 addendum

Core now keeps a bounded, user-and-session-scoped in-process approval registry plus full actionable prompt projections in runtime snapshots. Reconnecting to the same session must claim a fresh controller lease; allow/deny resolves the original callback. Registry expiry and explicit cancel deny and abort original work. The reconnecting socket does not persist the detached live run, preventing revision conflicts with the original owner. `SessionRuntimeWire.actionable` is additive and generated for Web and Studio; protocol version remains unchanged. Process restart still clears callbacks and reports interruption under ADR-81.

Focused Core lifecycle/registry tests (16), Web suite (31 files/138 tests), root/Web typechecks, and full task-owned production-browser suite (16/16) pass. The initial sequence exposed a stale-session revision crash after reconnect cleanup; the detached writer guard fixes it, and the reconnect-plus-PT-008 sequence completes without a harness crash. TUI control recovery and the broader PT-043 matrix remain open acceptance gates.

TUI follow-up implementation now sends `runtime_subscribe` after `session_resumed`, accepts only complete actionable prompts, and routes recovered allow/deny through existing controls. Go protocol/UI tests and full Go suite pass. Live PTY reconnect receipt/control remains open.
