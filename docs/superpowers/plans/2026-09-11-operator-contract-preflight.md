# Operator C5/C6 contract preflight

Date: 2026-09-11. Parent preflight for user-authorized PT-007/PT-008 continuation.
Read with [original spec](../specs/2026-09-09-client-uplift-spec.md) and
[original plan](2026-09-09-client-uplift-plan.md). No acceptance requirements waived.

## Verified current contracts

- `src/server/session-runtime.ts`: snapshot retains `actionable_ids`, `budget`,
  `latest_usage`, status and a bounded 256-event tail. It does **not** retain
  a full outstanding prompt payload map outside that tail. Process restart
  clears ephemeral actionable callbacks and marks active runtime interrupted.
- `src/server/index.ts` socket close handler aborts execution, resolves every
  `pendingApprovals` callback false and clears that map. Thus actionable ephemeral
  approval survival across reconnect is a Core dependency (PT-044), not merely a
  missing client reducer. Retaining a button cannot restore execution authority.
- `src/server/index.ts` attach handler: another session can be observed, but
  cross-session control attach is deliberately denied. Execution callbacks stay
  connection-owned. Client must not route a foreign approval through its own
  callback map or claim it can revive expired execution.
- `runtime_subscribe` returns a snapshot at request time; it does not establish
  peer subscription. `attach` joins runtime peers but observation removes control.
- `tool_approve`/`tool_deny` accept `request_id`; correlated `notice` confirms
  `decision accepted`; correlated `error` reports rejection. Pending visual state
  remains until acknowledgment; failed transport is not acknowledgment.
- `pending_answer` carries a string value and optional `request_id`;
  `pending_result` reports status/error. Do not confuse downstream continuation
  failure with whether the durable answer was already recorded; refresh store truth.
- `src/runs/pending.ts`: text, select and multi_select supported. Multi-select
  JSON string array accepted; values must match options and duplicates rejected.
- `src/server/rest.ts`: `/pending` and `/channels` scoped by user; `/pending`
  contains profile metadata but route filtering must be inspected before use.
  Existing shared scope helper separates ambient stale-response scope from URL scope.

## Implementation sequence

1. Finish independent CA acceptance; document any exact dependency on C5/C6.
2. Add reducer/store tests for state retained beyond 200 events and route unmount,
   scope reset, request-correlated pending/success/failure and readiness-gated fetches.
3. Adopt snapshots plus retained client state, bounded by user/session ownership.
   Re-fetch skills and budget/runtime state on reconnect. If server cannot restore
   evicted prompt details, expose unavailable recovery and log Core dependency;
   do not manufacture actionable details or claim full PT-007 acceptance.
4. Add typed inbox controls and refresh on relevant events plus bounded polling
   where out-of-band changes produce no broadcast. Cancel timers/in-flight stale
   responses on unmount/scope switch; prevent overlap and request storms.
5. Preserve successful data with honest stale/error indicator on failed refresh;
   show last successful update time. No major layout work.
6. Validate against real server/fake provider: >200 events, navigation/reconnect,
   delayed/rejected ACK, create/answer/expire outside page, invalid values,
   periodic runs/channels/metrics refresh, scope switch and backend failure/retry.
   Pure reducer tests supplement mounted browser proof.

Record unfulfilled original criteria in PT-007/PT-008; do not call snapshots more
capable than current source. No production Core patch within client-only track.
