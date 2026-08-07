# Automation

Three primitives that turn a chat tool into a background agent: triggers that
wake a profile without a human starting it, a way to ask a question that
outlives the process asking it, and a transport to actually reach a human
when the agent needs to report, ask, or be approved. All three are
profile-agnostic — core knows nothing about mailboxes, calendars, or any
specific messaging platform; that logic lives in adapters you plug in.

## Triggers

`triggers.cron` (a clock) and `triggers.webhook` (someone else's HTTP call)
cover the basics. `watch` and `poll` cover the far more common case:
**something changed**. Cron approximates that badly — "check my inbox"
becomes "run every 5 minutes and hope," which costs a full model turn per
tick to usually discover nothing happened. At 5-minute granularity that's
288 wasted turns a day per watched source.

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
      mode: skip                   # skip | queue | parallel, if a run is already active

  poll:
    - name: mail
      every: "5m"
      probe: { tool: "gmail__list_messages", args: { q: "is:unread", max: 1 } }
      cursor_path: "messages[0].id"
      jitter_pct: 10

  max_concurrent_runs: 3
  budget: { max_cost_usd: 0.50, max_tools: 30, max_wall_s: 300 }
```

### `poll` — the no-change path is free

A poll trigger runs a **cursor probe**: a single tool call (usually MCP) that
reads a value at `cursor_path` and compares it to what was persisted last
time. **No model call happens on the probe path** — that's what turns 288
wasted turns/day into 288 cheap HTTP calls and a handful of real runs.

- Probe failure is *not* a fire — errors back off exponentially, capped at 1h.
- First run after a cold start records the cursor **without firing**, so a
  restart doesn't replay everything as "new."
- The changed cursor value is passed to the run as input, so the agent knows
  *what* changed instead of rediscovering it.

### `watch` — coalescing is the point

Filesystem changes, backed by chokidar, with three protections a naive
watcher doesn't have:

- **Debounce** — events inside `debounce_ms` collapse into one wake; a `git
  checkout` in a watched repo produces one run, not four hundred.
- **Batch cap** — more than `max_batch` paths in a window fires once with a
  summary (`changed_count`, `sample_paths`, `truncated: true`) instead of a
  path list that blows the context budget.
- **Self-write suppression** — a run that writes into its own watched path
  won't re-trigger itself; the harness tracks its own writes and ignores
  matching watch events for a short window afterward.

### Concurrency

Per-trigger `mode` (default `skip`) decides what happens when a run is
already active: `skip` drops the new signal, `queue` runs one coalesced
follow-up, `parallel` runs concurrently under the process-wide
`max_concurrent_runs` cap. `triggers.budget` bounds every triggered run — see
[Safety & Governance](./safety#autonomy-budget).

## Deferred asks

In most harnesses, asking the user a question means awaiting an in-memory
promise held by a live connection — no client, no question; a restart
destroys it along with whatever work was already paid for. `AskUser` here
can instead park:

```
AskUser({
  prompt: "Approve refund of $340 to order #8821?",
  kind: "select",
  options: ["approve", "deny"],
  defer: true,
  ttl: "4h",
  channel: "phone"
})
```

The question writes to a durable pending store, delivers over the named
[channel](#channels), and the run parks with status `waiting_input` —
survivable across hours, days, and a full server restart, because resume
reads state purely from disk (the pending record plus the append-only
session ledger), not from anything held in process memory. A TTL sentinel
expires unanswered questions; cancellation is explicit. As far as the model
is concerned, the answer arrives "as if instant" whenever it comes back.

```bash
GET /pending                    # this user's open questions
POST /runs/:id/input             # { pending_id, value }
DELETE /pending/:id              # cancel
```

The Go TUI renders an inbox of open questions natively — no REST calls
needed from a human at the keyboard.

## Channels

A channel is a named, pluggable, **bidirectional** transport between a
profile and a human. It's what closes the gap where a triggered run is
otherwise write-only: it can spend tokens, but until it has a channel it
can't report, ask, or be approved.

```yaml
channels:
  - name: phone
    transport: webhook
    inbound: true
    default: true
    config:
      url: "https://example.com/hooks/phone"
    acl:
      notify: allow
      approvals: true
      inbound: paired
    limits:
      max_sends_per_hour: 20
```

- **Adapter-opaque.** Core defines the interface (send / receive /
  capability-describe) and ships only two reference adapters — `stdout` and
  `webhook`. No vendor lives in `src/`; that boundary is enforced by CI
  (`scripts/check-boundary.sh`), not just convention. A real integration
  (Slack, SMS, WhatsApp, whatever) is a custom adapter dropped in
  `.agents/channels/`.
- **Persistent bindings** route a user to a channel as `paired` (only a bound
  user), `open` (anyone), or `off` — with **fail-closed** handling for
  inbound messages from an unbound source.
- **Capability degradation** — a text-only channel silently drops what it
  can't render instead of erroring.
- **Chunking and rate limits** — long messages split at the channel's length
  limit; `limits.max_sends_per_hour` caps how often a channel can be used.
- The `Notify` built-in tool sends over a bound channel and is governed by
  the same [conditional ACL](./safety#conditional-acl) as any other tool —
  `Notify: { default: prompt, allow_if: [{ arg: channel, in_list: trusted_channels }] }`
  is the difference between an agent that can message anyone and one that
  can only reach a channel you've explicitly trusted.

## See also

- [Safety & Governance](./safety) — the budget, ACL, and provenance gate that
  bound everything on this page
- [Profiles](./profiles#triggers) — full field reference for `triggers:`,
  `channels:`, and `lists:`
- [CLI & TUI](./cli-tui) — the deferred-asks inbox in the terminal client
