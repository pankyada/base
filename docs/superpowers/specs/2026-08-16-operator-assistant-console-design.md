# Operator Console & Assistant Surface — Design (W4 · W5)

> Date: 2026-08-16
> Status: Draft (design)
> Related: [`2026-08-16-web-surface-design.md`](2026-08-16-web-surface-design.md),
> [`2026-08-16-web-read-api-design.md`](2026-08-16-web-read-api-design.md),
> [`../plans/2026-08-16-web-surface.md`](../plans/2026-08-16-web-surface.md), `docs/ROADMAP.md`

## Goal

Roadmap #17–#23 built agents that run without a human present: triggers wake them,
budgets bound them, channels reach out, deferred asks park questions, audit records
what they did, undo reverses some of it, provenance gating blocks the rest.

None of it is visible in a browser. The operator's only windows are the Go TUI and
`~/.harness/*.jsonl`. Two faces close that:

- **Operator console** (`/ops`) — what the fleet did, what it wants, what it cost,
  what can be undone. Answers: *is anything stuck, and did anything happen I should
  object to?*
- **Assistant surface** (`/home`) — the ambient face: today's brief, pending
  questions, upcoming trigger fires, what the agent believes and when that belief
  expires.

Both are read-heavy and mostly *not* about a live turn, so both are built on the
W1 read APIs with WS used only for live overlay.

### Non-goals

- Not fleet management across machines. One harness process, one operator.
- Not an alerting system. Channels (#17) deliver; these faces display.
- Not config editing. Profiles stay YAML on disk; the console reads them.
- Not an incident tool. No paging, no on-call, no acknowledgement workflow.

---

# Part A — Operator console (W4)

## A1. Run board

Rows from `GET /runs`, live-overlaid by `turn_start` / `stats` / `session_end` for
runs attached to the current socket.

Columns: run id · profile · trigger source (`cron`/`watch`/`poll`/`interactive`/
`webhook`/`channel`) · status · elapsed · cost · budget consumed · pending question.

Status uses the `--st-*` tokens, and `waiting_input` is visually distinct from
`running` — that distinction is the whole point of the state
([deferred-asks design §1](2026-08-02-deferred-asks-design.md)) and answers
"is it stuck or politely waiting?" at a glance.

Actions: cancel (`DELETE /runs/:id`), open transcript
(`GET /sessions/:id/messages`), answer a pending question inline.

**Concurrent runs.** Every WS event carries `run_id` and the client currently
ignores it, so two concurrent runs interleave their tokens into one transcript.
The reducer becomes keyed by `run_id`, with lanes in the board and a lane selector
in the conversation view. This is a correctness fix, not a feature.

## A2. Approval centre

`tool_prompt` already carries `risk: 'safe' | 'caution' | 'danger'` and `reason`
(`src/types.ts:193`); the current modal shows neither
(`web/components/ApprovalModal.tsx`).

- Risk-tiered presentation: `danger` requires a deliberate second action, not a
  same-position button that muscle memory can hit.
- `reason` is displayed verbatim, including the provenance gate's quoted tainting
  source when #22 escalated the call. **The operator must be able to see that the
  reason an agent wants to send an email is text a stranger wrote.**
- Argument preview by tool: `Write`/`Edit` show a diff, `Bash` shows the command
  with the working directory, network tools show the resolved URL and host.
- "Always allow this tool" issues `set_approval_mode` within the server ceiling
  ([W1 §1.3](2026-08-16-web-read-api-design.md)) and shows what it actually granted
  — never a client-side allowlist, which would be a lie about a security control.
- A queue: unattended runs can stack approvals, and a modal that shows one and
  drops the rest loses work.

## A3. Inbox — deferred asks

`GET /pending` plus `pending` over WS. Question, options, run, profile, age, TTL
countdown. Answer via `pending_answer`; cancel via `DELETE /pending/:id`. Expired
questions stay visible with an `expired` badge until dismissed, because a question
that timed out is information about a run that is now guessing.

## A4. Audit trail

`GET /audit` in a virtualized table: time · tool · effect · decision · decided_by ·
reason · tainted · ok. Filters mirror the endpoint's. Row expands to the input
digest and undo availability.

The `tainted` column is a first-class filter: *show me every effectful call made in
a turn that had ingested untrusted content.* That query is the review workflow #22
was built to enable and has had no interface.

## A5. Undo drawer

`undo_list` / `undo_apply`. Entries with target, age, and a staleness indicator
when the file changed since the recorded undo point. Stale entries require `force`
and say why. Grouped by run so "undo what that trigger did at 3am" is one gesture
rather than an archaeology exercise.

## A6. Observability

Charts over `GET /metrics` and `GET /stats/routing`, using the W3 widget kit — the
first internal consumer of the kit, which is deliberate: if the kit cannot draw the
harness's own metrics, it is not ready for the analyst.

- Cost per day, stacked by profile; cost per session distribution.
- Tool call volume with success rate and p50/p95 duration.
- Model mix by call count and by spend.
- Stage funnel: runs per stage, escalation rate, `verify_first_try` rate.
- Routing efficacy from `aggregateRouting` — the empirical answer to "which tier
  does this work actually need", which #15 collected data for and never surfaced.

## A7. Budget

Per-run budget meter live during a run (consumed vs `max_usd_per_task`,
tool count, wall time) and a monthly ledger view from `GET /usage`. A
budget-exceeded run is rendered as its own terminal state, not as a generic
failure — the distinction is the difference between "broken" and "working as
configured".

---

# Part B — Assistant surface (W5)

## B1. Brief

A card grid, each card one question the operator actually has in the morning:

| Card | Source | Answers |
|---|---|---|
| Needs you | `GET /pending` | questions parked overnight |
| Overnight | `GET /runs?since=` | what ran, outcome, cost |
| Next fires | `GET /triggers` | what wakes next and when |
| Spend | `GET /usage` | today, month, trend vs last |
| Expiring beliefs | `GET /memory?scope=user` | facts whose `valid_to` is near |
| Attention | `GET /audit?tainted=true` | effectful calls in tainted turns |

Empty states are real content: "nothing is waiting on you" is the most valuable
thing the page can say, and it should look deliberate rather than broken.

## B2. Memory explorer

The one item promised in roadmap #8 that never shipped, and the surface temporal
memory (#19) most needs.

- Scope switch: session · user · profile · project.
- **Timeline view.** Each fact is a bar across its validity interval, so
  supersession reads as one belief replacing another at a point in time instead of
  two contradictory rows. Superseded facts are shown greyed with a "was believed
  until…" label.
- Entity grouping; a graph view for `MemoryLinked` relations, which is a small
  force layout, not a graph product.
- Filters: as-of instant (`?at=`), text, entity, relation, include-superseded.
- Provenance badge on facts written from untrusted content.
- Edits go through a `MemoryWrite` tool call in the session, not a REST write
  ([W1 §2.4](2026-08-16-web-read-api-design.md)), so ACL, provenance, and audit
  apply to a human edit exactly as to an agent one.

## B3. Trigger console

Cron, watch, and poll triggers in one list: schedule or watched source, last fire,
next fire, and the fire/skip ratio with skip reasons from telemetry.

The ratio is the interesting number. #20's central claim is that the no-change path
is free — a poll that skipped 287 times and fired once is the design working, and
this is the only place that becomes visible. Fire-now and enable/disable are
deferred ([W1 §7](2026-08-16-web-read-api-design.md) open question 3).

## B4. Skills queue

`skills_list` / `skill_get` / `skill_save` / `skill_promote` / `skill_discard` all
exist in the protocol and have no web surface. Proposed skills mined by the
improver are listed with their content, an edit view, and promote/discard.
Discard is recoverable, matching the TUI.

## B5. Channels

Configured channels, binding state (paired / open / off), capabilities after
degradation, and a test-send. Read-mostly; pairing stays where it is.

---

## C. Shared concerns

**Navigation.** Three routes, one shell: `/` analyst, `/ops` operator, `/home`
assistant. One WS connection lives in the shell and survives route changes — the
socket is not per-page. The command palette (`Cmd+K`) is the cross-route jump.

**Polling.** Read APIs are pulled on focus and on a slow interval (30s default),
not on a tight timer. Live overlay comes from the WS events the client already
receives. No new server push.

**Empty and error states.** Every panel specifies both. A fresh install has no
telemetry, no audit, no triggers, and must render as *new*, not as *broken*
([W1 §3](2026-08-16-web-read-api-design.md): missing source file → `200` with an
empty result).

**Density.** These are tables and boards, not prose. `--row-h-compact` is the
default here, unlike the conversation view.

---

## D. Risks

| Risk | Mitigation |
|---|---|
| Console becomes a second config UI | Read-only by rule; writes limited to actions the protocol already exposes (cancel, answer, undo, approve, skill promote) |
| Risk-tiered approvals train click-through | `danger` requires a distinct gesture in a distinct position; the queue never auto-advances |
| Undo presented as safer than it is | Staleness surfaced, `force` explicit, "best-effort" stated in the drawer, not buried in docs |
| Audit table slow at scale | Cursor pagination + virtualization; filters push to the endpoint, never client-side over everything |
| Memory timeline misleads on open intervals | Open `valid_to` rendered as an explicit "ongoing" arrow, never as an arbitrary end date |
| Three faces diverge visually | One token system, one widget kit, one shell; ops charts are the kit's first consumer |

## E. Open questions

1. Should `/ops` be reachable when the WS is down? Most of it is REST-backed, so
   yes — but the run board's live overlay degrades. Show last-known with a stale
   banner?
2. Does the brief need a channel-delivered digest (a real "morning brief" push), or
   is the page enough? A push makes this product-shaped and belongs in the separate
   assistant repo, not in `src/`.
3. Memory graph view: worth the layout code, or is the timeline plus entity
   grouping sufficient for v1?
