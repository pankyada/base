# Watch & Poll Triggers — Design (H4)

> Date: 2026-08-02
> Status: Draft (design)
> Related: `docs/superpowers/specs/2026-08-02-channels-design.md`,
> `docs/superpowers/specs/2026-08-02-autonomy-budget-acl-design.md`, `docs/ROADMAP.md`

## Goal

`triggers` today is `{ cron?, webhook?, cron_input? }`. Two ways to start an
unattended run: a clock, or someone else's HTTP call. Neither expresses the most
common reason an agent should wake: **something changed**.

Cron approximates it badly. "Check my inbox" becomes "run every 5 minutes and
hope", which costs a full LLM turn per tick to usually discover nothing happened.
At 5-minute granularity that is 288 turns/day per watched source — the dominant
cost of any always-on assistant, and almost all of it wasted.

This design adds two trigger kinds and, critically, makes the no-change path
**free**:

- **`watch`** — filesystem changes (a vault, a downloads dir, a repo).
- **`poll`** — interval + persisted cursor; the run fires only when the cursor
  advances, and the cursor check happens *before* any model call.

It also unifies cron/watch/poll under one lifecycle, because they differ only in
what produces the wake signal.

### Non-goals

- Not a source integration. Core does not know what a mailbox is. A poll trigger
  runs a **cursor probe** the profile defines; fetching is MCP's job (§3).
- Not a distributed scheduler. Single process, single box. Multi-node is out of
  scope until hosting (A9).
- Not exactly-once delivery. At-least-once with dedupe is the contract.
- Not a replacement for cron — cron stays, unchanged in behavior.

---

## 1. Unified trigger model

```
             ┌── cron:  clock says so
wake signal ─┼── watch: path changed
             └── poll:  cursor advanced
                   │
                   ▼
            TriggerManager.fire(source, input)
                   │
       budget check (H5) ─▶ RunStore.create ─▶ runProfileOnce ─▶ Notify (H1)
```

Everything downstream of `fire()` is shared: run creation, abort registry,
contract validation, budget enforcement, telemetry tagging, channel delivery.
`CronScheduler` (`src/scheduler/cron.ts`) already contains this logic for one
source; the refactor generalizes it rather than duplicating it twice.

---

## 2. Schema

```yaml
triggers:
  cron: "0 7 * * *"
  cron_input: { task: morning_brief }

  watch:
    - name: vault
      path: "$VAULT/inbox"
      events: [add, change]        # add | change | unlink
      debounce_ms: 2000
      ignore: ["**/.obsidian/**", "**/*.tmp"]
      max_batch: 50

  poll:
    - name: mail
      every: "5m"
      probe: { tool: "gmail__list_messages", args: { q: "is:unread", max: 1 } }
      cursor_path: "messages[0].id"
      jitter_pct: 10

  budget: { max_cost_usd: 0.50, max_tools: 30, max_wall_s: 300 }
```

`triggers` absent ⇒ unchanged. `cron` alone ⇒ current behavior exactly, including
`cron_input` fail-fast validation at startup (`cron.ts:28-35`), which extends to
watch/poll inputs.

---

## 3. Poll: the cursor is the whole point

A poll trigger has two phases with radically different costs:

```
probe (cheap, deterministic, NO model call)
   └─ read cursor at cursor_path
      ├─ unchanged ──▶ record skip, spend nothing, done
      └─ changed   ──▶ persist new cursor ──▶ fire() (model runs)
```

The probe executes a **single tool call** — normally an MCP call the profile
already has configured — and extracts a scalar with a JSONPath-lite expression.
No LLM is involved. This is what turns 288 wasted turns/day into 288 cheap HTTP
calls and a handful of real runs.

Design consequences:

- Core still knows nothing about mail. It knows "call this tool, read this path,
  compare to last value". The vendor lives in the MCP server.
- Cursors persist at `~/.harness/cursors/<user>/<profile>__<name>.json` with
  `{ value, updated_at, consecutive_errors }`.
- **Probe failure is not a fire.** Errors increment a counter and back off
  exponentially (cap 1h). A flapping source must not become a spend loop.
- First run after a cold start records the cursor **without firing** — otherwise
  every restart replays as "everything is new".
- `jitter_pct` spreads polls so N triggers don't align on the minute.

The changed cursor value is passed to the run as input, so the agent knows what
changed rather than rediscovering it.

---

## 4. Watch: coalescing is the whole point

chokidar-backed, with three protections that exist because naive file watching
is a spend disaster:

1. **Debounce.** Events within `debounce_ms` collapse into one wake. A `git
   checkout` in a watched repo produces one run, not four hundred.
2. **Batch cap.** More than `max_batch` paths in a window ⇒ fire once with a
   summary (`{ changed_count, sample_paths, truncated: true }`) rather than a
   path list that blows the context budget.
3. **Ignore patterns**, defaulting to `.git/**`, `node_modules/**`, dotfile
   temp patterns, plus profile-supplied globs.

Self-write feedback loop: a run that writes into its own watched path would
re-trigger itself forever. Mitigation is a **write-suppression window** — the
manager records paths written by the harness (via the audit journal, H5.3) and
ignores watch events matching them within `debounce_ms * 2`. This is a real bug
in every naive implementation and the reason the audit journal is a dependency.

Watch input to the run:

```json
{ "trigger": "watch", "name": "vault", "events": [
  { "type": "change", "path": "/vault/inbox/note.md" } ], "truncated": false }
```

---

## 5. Concurrency and overlap

Per-trigger `mode`, default `skip`:

| Mode | Behavior when a run is already active for this trigger |
|---|---|
| `skip` | drop the new signal, count it in telemetry |
| `queue` | run after, at most one queued (coalesced) |
| `parallel` | run concurrently, subject to a global cap |

`skip` as default is the conservative choice: a slow morning brief that overlaps
its next tick should not double-spend. `queue` depth is capped at 1 — a backlog
of stale wake-ups has no value; the newest signal supersedes.

Global cap `triggers.max_concurrent_runs` (default 3) protects a laptop-class
box from N triggers firing at once.

---

## 6. Refactor: `CronScheduler` → `TriggerManager`

```
src/scheduler/cron.ts  ──▶  src/triggers/
                              manager.ts    lifecycle, fire(), concurrency, budget hook
                              cron.ts       (moved, logic preserved)
                              watch.ts      chokidar + debounce + coalesce + suppression
                              poll.ts       interval + probe + cursor store
                              cursors.ts    cursor persistence
                              input.ts      trigger → contract-validated run input
```

Constraint on the refactor: **existing cron tests must pass untouched.** Not
rewritten to match a new shape — untouched. That is the guarantee that a
generalization did not become a behavior change.

`Run.trigger` gains `'watch' | 'poll'`; telemetry `trigger` tag likewise.

---

## 7. Telemetry

Per fire *and* per skip:

```
{ kind: 'trigger', name, source: 'cron'|'watch'|'poll',
  fired: bool, skip_reason?: 'cursor_unchanged'|'overlap'|'budget'|'probe_error',
  probe_ms?, coalesced_events?, cost_usd? }
```

`skip_reason` distribution is the operational health metric. A healthy poll
trigger is >95% `cursor_unchanged` at near-zero cost. A watch trigger with high
`overlap` is misconfigured. Both are invisible without this event.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Poll cost regression | probe never calls the model; CI asserts zero token spend on an unchanged-cursor tick |
| Watch storm from bulk operations | debounce + `max_batch` + ignore defaults; storm test with 50 rapid writes asserting exactly one run |
| Self-triggering write loop | write-suppression window sourced from the audit journal |
| Cursor corruption / source resets id space | `consecutive_errors` backoff; malformed cursor → record-and-skip, never fire-on-garbage |
| Clock skew / suspended laptop | on resume, cron missed-fire policy is `skip` (do not stampede); polls resume on next interval |
| Trigger config typo silently does nothing | fail-fast validation at load, matching today's `cron_input` behavior |

## 9. Open questions

1. Should `probe` support a non-tool form (raw HTTP GET + header cursor)? It
   would avoid requiring an MCP server for trivial sources, but adds an HTTP
   client and a URL surface to core. Currently: no — MCP or nothing.
2. Missed-cron policy on wake from sleep: `skip` is chosen, but a morning brief
   missed because the box slept until 9am arguably should still run. Possibly a
   per-trigger `catch_up: true` in a later iteration.
