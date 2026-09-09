# Client uplift implementation plan

Date: 2026-09-09. Complexity: medium-high. Implementation: not yet assigned; awaiting user authorization.
Source of truth: [Client spec](../specs/2026-09-09-client-uplift-spec.md).
Tracking: [PRODUCT_STATE.md](../../PRODUCT_STATE.md), PT-032 (spec/plan), implementation against PT-002–PT-008, PT-011, PT-012.

## Execution rules

Run S0 → C1 → C2 → C3 → C4 → C5 → C6 → S8, in order. C7/UX (PT-011, PT-012) does not start without separate explicit UX approval. Each sprint is a bounded, testable increment; preserve earlier green behavior.

Client-only. Server behavior changes are forbidden — if a client requirement cannot be met by an existing Core contract, stop and raise a Core task with the specific gap. Generated protocol artifacts may be regenerated with repository scripts; do not hand-edit them.

Before edits, record `git status`, HEAD, and scoped diff. Never reset, clean, or stage the whole tree. Root and Web suites plus `tui/` Go tests must pass before each sprint closes. Small logical changes should be individually committable. No push, release, or deploy without explicit instruction.

Test-first per sprint: write the failing client test that reproduces the recorded defect before changing behavior.

## S0 — Baseline and contract map

- **0.1 Read contracts.** `src/types.ts` and generated `web/lib/protocol.ts` / `tui/internal/protocol`; the PT-023 scope helper `src/server/scope.ts`; PT-024 snapshot/cursor and PT-025 outstanding-decision shapes. Record which fields clients must now send and which they may consume.
- **0.2 Green baseline.** Root `pnpm test`, `pnpm typecheck`, Web `pnpm --filter harness-web test` and typecheck, `cd tui && go test ./...`. Record results and any pre-existing failures separately.
- **0.3 Client seam inventory.** Every WS `send` call site, every `fetch` call site in `web/`, and the TUI `Send`/`submit` paths. Note which currently omit scope and which swallow errors.
- Demo: an inventory naming real files and functions, plus a statement of which Core fields exist today versus which the spec assumes.

## C1 — Send and delivery truth (PT-002, PT-003)

- **1.1 Tests first:** Web test that submits with the socket closed and asserts no working state and retained input; TUI test that a write error reaches the model and the composer keeps content.
- **1.2 Web transport:** `useHarnessWS.send` returns a discriminated result (sent / not-connected / write-failed). `HarnessApp.handleSend` dispatches only on success, otherwise surfaces the failure and retains `state.input`. Apply the same rule to cancel, compact, surface-emit, and suggest paths.
- **1.3 TUI transport:** `ws.Client.Send` returns an error (nil connection and `WriteJSON` failure both). `model.submit()` restores composer content and raises a notice on failure. Keep the existing busy-queue behavior distinct from send failure.
- **1.4 Protocol constant:** replace the literal `protocol_version: 2` with the generated constant.
- Dependencies: S0. Demo: backend-down submission in a real browser leaves the text in the box with a visible reason; TUI equivalent proven by test.

## C2 — Identity and scope adoption (PT-004)

- **2.1 Tests first:** fixture tests for transcript, pending, usage, audit, and memory reads under users A/B and profiles P/Q, including a late in-flight response after a scope switch.
- **2.2 Scope-carrying read layer:** one place that builds scoped request URLs/headers from the active WS identity and profile; wire `useHarnessQuery`, `/ops`, `/home`, and analyst reads through it. Do not scatter query-string building.
- **2.3 Scope change resets:** switching identity or profile clears dependent state before re-reading; responses tagged with a superseded scope are discarded.
- **2.4 Label aggregate reads:** operator-wide reads stay aggregate and say so in the UI.
- Dependencies: C1. Demo: two identities show disjoint transcript and usage, with no residue across a switch.

## C3 — Connection lifecycle (PT-005)

- **3.1 Tests first:** mount/unmount and identity-switch tests asserting one socket and zero pending timers.
- **3.2 Single-socket discipline:** track the reconnect timer in a ref and clear it in cleanup; ignore handlers from superseded sockets; reset backoff only on confirmed open.
- **3.3 Reconnect recovery:** re-attach session and profile through the existing attach/snapshot contract on both Web and TUI; report plainly when recovery is not possible.
- **3.4 TUI transport tests:** add the missing `tui/internal/ws` package tests covering reconnect, send failure, and recovery.
- Dependencies: C2. Demo: forced disconnect/reconnect restores the selected session with no orphaned socket.

## C4 — Unavailable versus empty (PT-006)

- **4.1 Tests first:** per-surface tests asserting three distinct states — loading, empty, failed.
- **4.2 Read-state helper:** replace `catch → []` with a result type carrying error and retry; render an explicit unavailable state with reason and retry control.
- **4.3 Batched reads:** the `/metrics` + `/usage` + `/stats/routing` group reports per-part failure instead of collapsing to `{}`.
- **4.4 Apply across surfaces:** `/ops`, `/home`, transcript history, analyst remote reads.
- Dependencies: C3. Demo: browser check with the backend down shows unavailable on both routes, and retry recovers.

## C5 — Durable operator state and acknowledgment (PT-007)

- **5.1 Tests first:** more than 200 events, navigate away and back, and reconnect — outstanding approvals and budget must survive all three.
- **5.2 Snapshot-backed state:** source outstanding approvals, budget, and skills from the PT-024 snapshot and PT-025 scoped outstanding list; apply live events as deltas on top of it rather than as the sole source.
- **5.3 Acknowledged decisions:** remove the optimistic `resolvedApprovals` set; a decision is pending until Core acknowledges the transition, and a failure returns it to actionable with the reason.
- **5.4 Connection-gated init:** initial requests wait for a confirmed open socket.
- Dependencies: C4. Demo: an approval outstanding across an event overflow and a reconnect is still actionable, and a failed decision reports failure.

## C6 — Live refresh and deferred inbox (PT-008)

- **6.1 Tests first:** ask created, answered, and expired out of band; invalid select value; stale snapshot.
- **6.2 Event-driven refresh:** deferred asks, runs, channels, and metrics update from events and scoped re-reads instead of a single mount-time fetch.
- **6.3 Value validation:** text, select, and multi-select values validate against Core-reported options; surface Core's rejection reason verbatim.
- **6.4 Freshness:** show last-updated for snapshot-backed panels.
- Dependencies: C5. Demo: out-of-band ask lifecycle reflected live without reload.

## S8 — Integrated acceptance

- **8.1 Full checks:** root `pnpm test` and typecheck, Web tests and typecheck, `cd tui && go test ./...`, boundary and generator checks.
- **8.2 Real-browser matrix:** backend down, backend up, identity switch, reconnect, event overflow — recorded as evidence with the exact conditions.
- **8.3 Tracker closeout:** update PT-002–PT-008 status honestly, add a dated completion row and evidence ID, and keep live/deployed acceptance separate from local passes.
- Demo: an acceptance report separating implemented, locally accepted, and still-unverified, with remaining tasks linked.

## Risks

- C5 assumes the PT-024 snapshot actually carries outstanding approval identity and budget for the operator route. S0.1 must confirm this against `src/server/session-runtime.ts` before C5 starts; if it does not, that is a Core task, not a client workaround.
- C2 depends on Core accepting explicit scope on every route the clients read. PT-023 covered REST ID actions, read APIs, and WS hello/attach; any route it missed surfaces here as a Core follow-up.
- C7 UX work is deliberately unscheduled. Do not let layout work absorb the correctness sprints.
