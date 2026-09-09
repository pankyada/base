# Client uplift specification

Date: 2026-09-09. Status: specification only; implementation not yet authorized.
Owner: parent specification/review. Task range: PT-032 (this spec/plan), implementation against existing PT-002–PT-008, PT-011, PT-012.
[Implementation plan](../plans/2026-09-09-client-uplift-plan.md). Predecessor: [Core uplift spec](2026-09-07-core-uplift-spec.md) (delivered `499c36d`).

## Outcome and scope

Make the Web and TUI clients adopt the Core contracts delivered by PT-023–PT-030, so that what an operator sees matches what the server actually did. Implement in order: send/delivery truth → identity and scope adoption → connection lifecycle → unavailable-versus-empty → durable operator state → live refresh → UX completion.

Allowed: `web/`, `tui/`, `studio/` client code and their tests, generated protocol artifacts consumed by clients, and docs/tracker updates. Excluded: new Core protocol messages or server behavior changes (raise a Core follow-up task instead), product login/RBAC, export fidelity (PT-009), canvas durability (PT-010), orchestrator UI (PT-020), deployment and release.

Core is treated as the authority. If a client need cannot be met by an existing contract, record it as a new Core task rather than widening this track. Do not re-implement scope, snapshot, cursor, or decision-acknowledgment logic in the client.

## Baseline evidence and non-assumptions

Verified in the working tree at `499c36d`:

- `web/hooks/useHarnessWS.ts:53` — `send()` silently no-ops unless `readyState === OPEN`. `web/components/HarnessApp.tsx:96` dispatches `USER_MSG` before calling it, so a dropped message still renders as sent and enters a working state. This is the browser-confirmed E-002 defect.
- `web/hooks/useHarnessWS.ts:27` — `hello` hardcodes `protocol_version: 2` and defaults `user_id` to `'web-user'`. The literal version is prose-derived and must come from the generated protocol constant.
- `web/hooks/useHarnessWS.ts:35` — `onclose` schedules `setTimeout(connect, delay)` that is never cleared by the effect cleanup, so unmount or a `userId` change can leave a retry that opens an extra socket.
- `web/hooks/useHarnessQuery.ts:14` and `web/app/ops/page.tsx:31-34` — REST reads (`/sessions/:id/messages`, `/pending`, `/channels`, `/metrics`, `/usage`, `/stats/routing`) carry no user or profile scope. PT-023 made Core scope-explicit; these callers still rely on omitted-scope legacy defaults, so switching identity does not change what is read.
- `web/app/ops/page.tsx:31-34` — every fetch failure falls back to an empty array or `{}`. Backend down is indistinguishable from nothing outstanding.
- `web/app/ops/page.tsx:47` — outstanding approvals are derived only from the live `events` array, and `resolvedApprovals` is a local optimistic set. Event-buffer eviction, navigation, or reconnect loses outstanding approvals; a decision shows as resolved before Core acknowledges it. PT-024 snapshots and PT-025 scoped outstanding state exist to replace this.
- `web/app/ops/page.tsx:30` — `/pending` and `/channels` are fetched once on mount and never refreshed, so new, answered, and expired asks do not update.
- `tui/internal/ws/client.go:124` — `Send` writes only when `c.conn != nil` and discards the `WriteJSON` error; the caller learns nothing. `tui/internal/ui/model.go` `submit()` clears the composer before the frame is known to have left, so unsent text is lost.

Non-assumptions: these are client defects. Core mechanisms for scope, bounded snapshots, cursors, and acknowledged decisions landed in PT-023–PT-030 and must be adopted, not duplicated. No client change here establishes authentication; user identity remains caller-asserted. Passing local fixtures is not live acceptance.

## C1 — Send and delivery truth (PT-002, PT-003)

1. A client must not render a message as sent, or enter a working/busy state, until the transport reports the frame written. Web `send` returns an explicit result; TUI `Send` returns an error.
2. When the transport is unavailable or the write fails, the composed input is visibly retained and editable, and the failure is surfaced in the UI with the reason. No silent drop.
3. Optimistic local echo is permitted only when a failure path removes or marks the echoed message. Queued-while-busy behavior (existing TUI `m.queue`) is preserved and kept distinct from failed-while-disconnected.
4. Cancel, compact, approval, and undo sends follow the same rule: a control the operator pressed either takes effect or reports that it did not.

Acceptance: browser test with the backend down proves submission does not enter a working state and the text survives; TUI test proves a write error surfaces and the composer retains content; reconnect then successful send passes.

## C2 — Identity and scope adoption (PT-004)

1. All user-scoped REST reads and writes send the active WS identity and profile explicitly, using the scope fields PT-023 defined. Do not rely on omitted-scope legacy defaults.
2. Changing identity or profile clears dependent client state (transcript, pending, usage, audit, memory) before issuing scoped reads; stale responses from the previous scope are ignored.
3. Intentionally aggregate operator reads stay aggregate and are labelled as such in the UI, not silently mixed with user-scoped data.
4. `protocol_version` in `hello` comes from the generated protocol constant, never a literal.

Acceptance: fixture and browser coverage with users A/B and profiles P/Q proves transcript, usage, audit, and memory reads return the active scope, that switching scope shows no residue from the previous one, and that a late in-flight response is discarded.

## C3 — Connection lifecycle (PT-005)

1. Exactly one active socket per client instance. Effect cleanup cancels pending reconnect timers and detaches handlers from superseded sockets.
2. Callbacks bound to a closed or superseded socket are ignored. Backoff resets only on a confirmed open.
3. After reconnect the client re-establishes session and profile selection through the existing attach/snapshot contract rather than assuming server memory of the prior socket.
4. TUI reconnect restores the selected session and profile, or states plainly that it could not.

Acceptance: repeated mount/unmount and identity switches leave no orphaned socket or timer; forced disconnect/reconnect restores session and profile; assertions on socket count, not on absence of visible error.

## C4 — Unavailable versus empty (PT-006)

1. Every remote read distinguishes loading, empty, and failed. A failed read renders an explicit unavailable state with the reason and a retry affordance.
2. No `catch` may substitute an empty collection for an error. Partial failure in a batched read reports which parts failed.
3. Applies to `/ops`, `/home`, transcript history, and the analyst surfaces that read remotely.

Acceptance: browser checks with the backend down show unavailable, not reassuring empty, on `/ops` and `/home`; retry succeeds once the backend returns.

## C5 — Durable operator state and acknowledgment (PT-007)

1. Outstanding approvals, budget, and skills state come from the PT-024 authoritative snapshot and PT-025 scoped outstanding lists, with the live event stream applied on top — not derived from the event array alone.
2. Outstanding work survives more than 200 events, navigation between routes, and reconnect.
3. A decision stays visibly pending until Core acknowledges the recorded transition. A rejected or failed decision returns to pending with the reason; it is never optimistically marked resolved.
4. Initial requests wait for a confirmed connection instead of firing against a socket that is still connecting.

Acceptance: event-overflow, navigate-away-and-back, and reconnect fixtures all retain outstanding items; an unacknowledged approval remains actionable; a denied-then-failed decision reports failure.

## C6 — Live refresh and deferred inbox (PT-008)

1. New, answered, and expired deferred asks update without a manual reload, driven by existing events and scoped re-reads.
2. Supported ask types (text, select, multi-select) validate their values client-side against the options Core reports, and rejected values surface Core's reason.
3. Run, channel, and metrics snapshots stay current, with a visible last-updated indication.

Acceptance: an ask created, answered, and expired out of band is reflected live; an invalid value is rejected with Core's message; stale snapshots are not presented as current.

## C7 — Operator and assistant UX completion (PT-011, PT-012)

Deferred behind C1–C6 and gated on explicit UX approval before implementation. Confirm major layout direction with the user first: run lanes and hierarchy for `/ops`, meaningful brief summaries instead of raw object dumps for `/home`, readable tables, actionable statuses, and responsive verification. No layout work starts on the strength of this spec alone.

## Out of scope

Export fidelity (PT-009), canvas durability (PT-010), platform/installer acceptance (PT-013), Codex live acceptance (PT-014), effort picker UI (PT-016), orchestrator workspace (PT-020). New Core protocol surface: raise a separate Core task.
