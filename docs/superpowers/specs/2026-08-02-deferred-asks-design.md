# Deferred Asks — Design (H2)

> Date: 2026-08-02
> Status: Draft (design)
> Related: `docs/superpowers/specs/2026-08-02-channels-design.md`,
> `docs/superpowers/plans/2026-08-02-personal-assistant-plan.md`, `docs/ROADMAP.md`

## Goal

`AskUser` (`src/tools/builtin/ask-user.ts:37`) awaits
`context.events.onInputRequest(...)` — an in-memory promise held by a live
connection. Three consequences:

1. **No client, no question.** Unattended runs get
   `[input_request not supported in this environment]` and must guess.
2. **A question is a held socket.** The run occupies memory and a connection for
   as long as the human takes to answer. Hours is not viable.
3. **A restart destroys the question.** The promise is gone; the run is
   unrecoverable and the work already paid for is lost.

Human latency and machine latency differ by four orders of magnitude. Modelling
a human answer as an awaited in-process promise is the mistake. This design makes
a question a **durable object**: written to disk, delivered over a channel (H1),
answerable minutes or days later, resumable across restarts.

This is what makes background agents *useful* rather than merely autonomous. An
agent that cannot ask can only do what needs no permission.

### Non-goals

- Not a change to interactive `AskUser`. Non-deferred behavior is byte-identical;
  this is a strict superset gated on `defer: true`.
- Not a workflow engine. No branching, no multi-question forms, no state machine
  beyond one question and one answer.
- Not a general job queue. Parking is per-run and specific to awaiting a human.
- Not a notification system — delivery is H1's job.

---

## 1. The state that must survive

A parked run is (ledger, pending question, resume point). Two of the three
already persist: the session ledger (`src/session/store.ts`) and the run record
(`src/runs/store.ts`). Only the question is missing, plus a run status that means
"alive but not running".

```
run.status: pending | running | completed | failed | cancelled
                            └──▶ + waiting_input          (new)
```

`waiting_input` is deliberately distinct from `pending` (never started) and from
`running` (consuming resources). Operationally it answers "is this run stuck or
is it politely waiting for me?" — the question you actually ask at 9pm.

---

## 2. Pending store

```ts
// src/runs/pending.ts
export interface PendingInput {
  id: string                    // also the channel correlation_id
  run_id: string
  session_id: string
  user: string
  profile: string
  prompt: string
  kind: 'text' | 'select' | 'multi_select'
  options?: string[]
  channel?: string              // where it was delivered
  created_at: string
  expires_at: string            // created_at + ttl
  state: 'open' | 'answered' | 'expired' | 'cancelled'
  answer?: string
  answered_at: string | null
  answered_via?: 'channel' | 'rest' | 'ws' | 'cli'
}
```

Persisted one-file-per-record at `~/.harness/pending/<user>/<date>_<id>.json`,
matching `RunStore`'s layout and its "scan the directory" read model. Same
tradeoffs, same operational shape, no new storage concept to learn.

`id` doubles as the H1 `correlation_id`. One identifier from question to answer
across process boundaries.

---

## 3. `AskUser` gains three parameters

```ts
AskUser({
  prompt, kind, options,        // unchanged
  defer?: boolean,              // default false → today's behavior exactly
  ttl?: string,                 // "4h", "2d"; default 24h
  channel?: string,             // default: profile default channel
}) → string
```

Deferred execution path:

```
1. write PendingInput{state:'open'}
2. Notify(channel, prompt + options as buttons, correlation_id = pending.id)
3. checkpoint session ledger
4. run.status ← waiting_input
5. throw ParkSignal   ── unwinds the loop cleanly, not an error
```

`ParkSignal` is a sentinel the agent loop recognises (like `AbortSignal` handling
today) — it stops the turn without marking the run failed and without appending
a tool result. On resume the tool result is appended with the human's answer, so
the ledger reads exactly as if the human had answered instantly. **The model
never learns the question was parked** — no prompt-visible discontinuity, no
"as I asked you yesterday" confusion.

Degradation: `defer: true` with no channel configured falls back to interactive
behavior if a client is attached, else returns
`[deferred ask requires a channel; none configured]`.

---

## 4. Resume

```
answer arrives (channel reply | REST | web | CLI)
  └─ pending.state open? ──no──▶ 409, idempotent no-op
       └─yes─▶ mark answered
               load session ledger
               append tool result for the AskUser call
               run.status ← running
               continue agent loop in-process
               (cost accounting continues under the same run id)
```

Requirements that fall out:

- **Idempotent.** Double-tap on a phone button is normal. Second answer → 409,
  never a second resume.
- **Same run id.** Cost, telemetry, and audit stay attributable to one unit of
  work regardless of wall-clock gaps.
- **Ledger append-only.** Resume appends; it never rewrites. The H16 projection
  handles the fact that the parked turn may now be old and elidable.
- **Server restart is not special.** Resume reads the ledger from disk. A run
  parked before a restart resumes identically to one parked after.

### 4.1 Expiry

A sweeper (interval, default 60s) marks overdue records `expired` and resumes the
run with a sentinel tool result:

```
[no answer within 4h — proceed without it or stop]
```

Resuming with an explicit timeout beats hanging forever. The agent decides what
to do; the profile's system prompt or playbook decides the convention. The
alternative — silently abandoning the run — leaves paid-for work in limbo and
teaches the user the assistant is unreliable.

---

## 5. Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/pending?user=&state=` | list questions awaiting answer |
| `POST` | `/runs/:id/input` | `{ pending_id, value }` → resume |
| `DELETE` | `/pending/:id` | cancel question; run resumes with cancelled sentinel |

Bearer-auth'd like the existing REST surface (#4). WS clients get the same via a
new `pending_list` / `pending_answer` `ClientMessage` pair, and a `pending`
`ServerMessage` so the TUI and web client can render an inbox of open questions.

---

## 6. Interaction with approvals (H1 §7)

Approvals and deferred asks are the same shape — a question with a correlation
id — but different objects. A `tool_prompt` is bounded by the tool call's
lifetime; an `AskUser` is bounded by TTL.

Unification: `tool_prompt` in an unattended run *becomes* a `PendingInput` with
`kind: 'select'`, `options: ['Allow','Deny','Always']` and a short default TTL
(15m). Same store, same resume path, same idempotence. One mechanism, two
entry points.

This is why H1 §7's "no reply ⇒ park (if deferrable) else deny" is expressible:
parking is already implemented here.

---

## 7. Module layout

```
src/runs/pending.ts        store + sweeper
src/runs/park.ts           ParkSignal, checkpoint, resume
src/runs/types.ts          + 'waiting_input' status
src/tools/builtin/ask-user.ts   + defer / ttl / channel
src/server/index.ts        + /pending, /runs/:id/input, WS pending messages
src/channels/approvals.ts  routes channel replies into pending resolution
```

---

## 8. Telemetry

`kind: 'pending'` events: `created`, `answered`, `expired`, `cancelled`, each
with `wait_ms`, `channel`, `answered_via`.

The metric that matters for product quality: **answer rate and median wait**. A
falling answer rate means the assistant is asking too much or asking badly —
exactly the signal needed to tune autonomy (H5) empirically instead of by taste.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Pending records pile up unnoticed | TTL sweeper; `GET /pending`; surfaced in TUI/web; weekly digest is a product concern |
| Resume storms after long downtime | sweeper processes expiries with a concurrency cap; resumes are serialized per user |
| Ledger drift between park and resume | ledger is append-only and the only source of truth; resume re-reads from disk rather than trusting memory |
| Answer arrives for a run whose profile changed | pending stores `profile`; mismatch → cancel with a clear message rather than resuming under different rules |
| Parked run holds a lock/worktree | park releases external resources before checkpointing; documented requirement for tools that acquire them |

## 10. Open questions

1. Should a parked run's context be re-projected at resume against the *current*
   budget, or preserved as-projected? Leaning re-project (H16 makes this free).
2. Multi-question batching — "3 things need you" as one message — is clearly
   better UX. Deferred to the product repo; core keeps one question per record.
