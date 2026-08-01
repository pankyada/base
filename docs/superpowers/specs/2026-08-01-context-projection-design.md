# Context Projection — Design

> Date: 2026-08-01
> Status: Draft (design)
> Related: `docs/superpowers/specs/2026-08-01-adaptive-workflow-routing-design.md`,
> `docs/ROADMAP.md`

## Goal

`session.messages` is currently two things at once: the durable record of what
happened, and the payload sent to the provider each turn. Because they are the
same array, every context operation is a **destructive mutation of history**.
Five consequences, all observable today in `src/loop/context-manager.ts`:

1. **Reactive, never preventive.** Condensation fires only once the estimate
   already exceeds the full window. The request that crosses the line was built
   and sent before the check ran on the *next* iteration.
2. **Silent spin.** Summariser throws → `return 0`, messages unchanged, next
   iteration hits the same condition and throws again. No termination guarantee.
3. **Lossy and irreversible.** Summarised messages are gone from the session.
   Full tool output survives in `session.tool_calls`, but nothing can put it
   back in front of the model.
4. **Cache-hostile.** The summary is spliced in at index 1, so every compaction
   rewrites the prompt prefix and invalidates any provider-side prompt cache.
5. **Heuristic retention.** "Keep tool results ≥400 chars containing a `#`"
   is a proxy for "this was a skill or a doc". It fires on any markdown-shaped
   tool output and misses anything important that is not markdown.

This design separates the two roles. The ledger becomes append-only and
authoritative. What goes on the wire becomes a **projection**: a pure function of
(ledger, budget, policy) recomputed each turn. Retention stops being a mutation
and becomes a rendering decision.

### Non-goals

- Not a retrieval/embedding system. No vector store, no semantic search over
  history. Relevance is handled by *promotion* (§5), not by ranking.
- Not a change to the WS protocol. `stats` / `notice` already carry everything
  the clients need; `context_tokens` keeps its meaning.
- Not a provider abstraction rewrite. Cache breakpoints are emitted behind a
  flag and are a no-op on providers that ignore them.
- No new runtime dependency. No tokenizer package (see §4).

---

## 1. Ledger vs projection

| | Ledger | Projection |
|---|---|---|
| Where | `session.messages` | return value of `project()` |
| Lifetime | append-only, persisted | rebuilt every turn, never stored |
| Fidelity | full, verbatim | budgeted |
| Mutated by | the agent loop only | nothing |

```
session.messages  ──project(session, profile)──▶  wire messages ──▶ provider
      ▲                                                                │
      └──────────────── append assistant / tool results ◀──────────────┘
```

The loop keeps appending to `session.messages` exactly as it does today
(`agent-loop.ts:132`, `:159`, `:287`). The only change at the call site is that
`openai.chat.completions.create` is handed `project(session, profile)` instead of
`session.messages`.

Consequences that fall out for free:

- Compaction can never lose data — the ledger is untouched, so a bad projection
  is recoverable by re-projecting.
- `/compact` becomes a policy nudge (lower the water line for this session), not
  a destructive operation.
- Session replay, telemetry, and the improver keep reading full history.

### 1.1 Back-compat

`Session.messages` keeps its type (`unknown[]`) and meaning. Sessions written by
the current build load and project correctly — they simply have no
`session.context` block, and one is initialised on first use.

---

## 2. Band layout

The projection is three bands, in wire order:

```
┌─ index 0 ── PREFIX ──────────────────────────┐  append-only  → cache breakpoint 1
│  system prompt + skill index + memory        │
│  + pinned blocks (§6)                        │
├─ index 1 ── DIGEST (optional) ───────────────┤  rewritten rarely → cache breakpoint 2
│  "[Earlier session digest: …]"               │
├─ index 2.. ── LIVE ──────────────────────────┤  changes every turn
│  ledger tail, verbatim or elided             │
└──────────────────────────────────────────────┘
```

Budget split of the effective window:

| Band | Share | Rule |
|---|---|---|
| Prefix | ≤ 25% (`pin_budget`) | grows only by explicit pin; refuses past cap |
| Digest | ≤ 15% | single block, regenerated on recompaction |
| Live | remainder | the tail is never compressed below `tail_turns` |

The point of the split is not tidiness — it is that **bands 0 and 1 are stable
across turns**, which is the precondition for provider-side caching (§7).

---

## 3. The decay ladder

A ledger entry is rendered at one of four tiers. Tier is chosen per projection;
it is not stored on the entry.

| Tier | Rendering | Approx. cost | Reversible |
|---|---|---|---|
| 0 | verbatim | full | — |
| 1 | **elided** — content replaced by a handle | ~15 tok | yes, by tool call |
| 2 | folded into the digest | ~amortised | no (but in ledger) |
| 3 | dropped from projection | 0 | no (but in ledger) |

### 3.1 Tier 1 — elision, the load-bearing idea

A `role: 'tool'` message is rendered with its content replaced:

```
[Read src/loop/agent-loop.ts → 8,214 chars elided · ContextRestore("call_a1b2")]
```

Properties that make this the primary mechanism:

- **Zero LLM cost.** No summariser call. Elision alone will hold most sessions
  under budget indefinitely.
- **Lossless by reference.** Full output already lives in `session.tool_calls`
  (`agent-loop.ts:290`). Restoring is a tool call away.
- **Structurally safe.** The message is *not removed* — role, position and
  `tool_call_id` are preserved. Orphaned-`tool_call_id` repair, which is the
  most delicate part of the current condenser, becomes unreachable and its code
  is deleted.
- **The model decides relevance, not a heuristic.** If the agent needs the file
  again it calls `ContextRestore`; that call is itself evidence for telemetry.

Elision applies only to `role: 'tool'` messages outside the tail, largest-first.
Assistant and user messages are never elided — they are cheap and they carry the
reasoning thread.

### 3.2 Tier 2 — digest, at turn boundaries only

When elision is not enough, the oldest **whole turns** are folded into the
digest block. A turn is `[user message] … [assistant message with no pending
tool calls]`. Cutting only at turn boundaries is what guarantees no dangling
`tool_call_id` — a strictly simpler invariant than the current keep-set +
repair-pass.

The digest is regenerated (not appended to) from `ledger[1..upto]`, so it never
degrades into a summary-of-summaries.

### 3.3 Tier 3 — drop, the termination guarantee

If prefix + tail alone exceed the window, the oldest turns are dropped from the
projection and a `notice` is emitted. This is the case the current code cannot
express, and why it can spin. **`project()` returns under budget or throws — it
never returns over budget.**

---

## 4. Self-calibrating estimator

No tokenizer dependency. The provider already reports the true prompt size every
turn — `chunk.usage.prompt_tokens`, captured at `agent-loop.ts:108`.

```
raw(msgs)  = JSON.stringify(msgs).length / 4          // as today
est(msgs)  = raw(msgs) × ratio
```

After each call:

```
observed = actual_prompt_tokens / raw(messages_sent)
ratio    = ratio + α(observed − ratio)                 // α = 0.3, clamp [0.5, 3]
```

`ratio` persists on the session, so it survives reconnect and converges within
~3 turns per model. This corrects the two known biases of `raw` at once — JSON
punctuation and key names inflate it, non-Latin content deflates it — without
adding a dependency or a per-model table.

`estimateTokens()` keeps its signature so `server/index.ts` and the `stats`
message are unaffected.

---

## 5. Promotion — where "important information" actually lives

The transcript is the wrong home for durable facts. Retention pressure will
always eventually win against it.

The repo already has the right home: `GraphMemoryProvider`, the `project` memory
scope, and `src/workflow/knowledge.ts`, which extracts knowledge at stage close
when `workflow.enabled`. This design extends that to the flat loop, at no extra
LLM cost, by making the digest call **dual-output**:

```json
{
  "digest": "…prose summary of the folded turns…",
  "facts": [
    { "text": "auth token is validated in src/server/index.ts:139", "tags": ["auth"] }
  ]
}
```

`digest` goes into band 1. `facts` are written through the existing
`MemoryProvider.write()` into the `project` scope. One call, both outputs.

So: **the transcript is allowed to decay, because what mattered was promoted out
of it.** Context management becomes a promotion policy, not a retention fight.

---

## 6. Pins replace the anchor heuristic

`isAnchor()` (`context-manager.ts`) is deleted. Retention of loaded material
becomes explicit at the point of loading:

- `Skill` tool → pins the `SKILL.md` body it returned.
- Workflow artifacts (`src/workflow/artifacts.ts`) → pinned for the stages that
  declare them as input.
- Playbook body → pinned for the duration of the task.

```ts
pin(session, key: string, text: string): 'ok' | 'over-budget'
```

Pins are keyed and idempotent (re-loading the same skill does not duplicate),
appended in insertion order, and rendered into the prefix. Exceeding
`pin_budget` returns `over-budget`; the content stays a normal tool result and
decays normally, and a `notice` is emitted. Pinning is intent, expressed by the
component that has the intent — not a string match on `#`.

---

## 7. Cache breakpoints

Two breakpoints: end of prefix, end of digest. Between recompactions both bands
are byte-identical turn over turn, which is what a provider-side cache needs.

Emitted only when `context.cache: true`. On Anthropic this attaches
`cache_control: { type: 'ephemeral' }`; cached reads bill at roughly a tenth of
fresh input.

**Open question, deliberately not assumed:** whether the Anthropic
OpenAI-compatible endpoint used by every Anthropic profile in `profiles/` honours
`cache_control`. If it does not, the win requires a native Anthropic path in
`src/provider/client.ts`, which is out of scope here. The flag therefore ships
**default `false`**, and the implementation must measure — a `cache_read_tokens`
telemetry field, and a documented result — before it is recommended.

Note the interaction: pinning mid-session mutates the prefix and invalidates
the cache **once**, at pin time. That is accepted; pins are append-only and rare.

---

## 8. Eviction order

On each turn, before the request is built:

```
target = window × high_water
if est(projection) ≤ target: send as-is

1. elide tier-1 candidates, largest first, until ≤ window × low_water
2. still over → fold oldest whole turns into digest (one cheap-model call)
3. still over → drop oldest turns from the projection, emit notice
```

Hysteresis (`high_water = 0.80`, `low_water = 0.45`) is what stops the current
every-turn-recompaction behaviour: after step 1 or 2 the session sits well below
the trigger for many turns, which keeps bands 0–1 stable and the cache warm.

Step 2 failing (provider error, malformed JSON) is not fatal — it falls through
to step 3, which always terminates. The spin is structurally impossible.

---

## 9. Configuration

```yaml
context:
  max_tokens: 100000        # else model registry, else Infinity (as today)
  high_water: 0.80
  low_water: 0.45
  tail_turns: 3             # never compressed
  pin_budget: 0.25
  digest_model_id: gpt-5.4-mini   # else models.roles.cheap, else model.id
  cache: false
```

`context_window: { max_tokens, model_id }` stays accepted as a deprecated alias
mapping to `max_tokens` / `digest_model_id`, so no existing profile breaks.

---

## 10. Module layout

New `src/context/`:

| File | Role |
|---|---|
| `projection.ts` | `project()`, band assembly, eviction order (§8) |
| `estimator.ts` | `estimateTokens()`, `calibrate()`, `contextWindowFor()` |
| `digest.ts` | dual-output digest call + fact promotion (§5) |
| `pins.ts` | `pin()`, budget enforcement, prefix rendering (§6) |

`src/loop/context-manager.ts` is deleted; its two import sites
(`agent-loop.ts:12`, `server/index.ts:31`) move to `src/context/`.

New builtin `ContextRestore` in `src/tools/builtin/context-restore.ts`:

```
ContextRestore(id: string, offset?: number, limit?: number) -> string
```

Reads `session.tool_calls`, ACL `allow` by default — it can only surface data
already in the session. `offset`/`limit` exist so restoring a large result does
not immediately re-blow the budget. Restoring by an id that predates this change
(no stored id) returns a clear "not available in this session" string rather
than erroring.

`SessionToolCall` gains an optional `id` field (the `tool_call_id`) — additive,
old sessions degrade to the message above.

---

## 11. Telemetry

`TelemetryEvent` gains, all optional:

| Field | Meaning |
|---|---|
| `context_tokens_est` / `context_tokens_actual` | estimator accuracy over time |
| `calib_ratio` | convergence of §4 |
| `elided_count` / `elided_bytes` | how much tier 1 alone is buying |
| `digest_calls` | how often step 2 is actually reached |
| `restore_calls` | how often the model wanted something back — the honest measure of whether elision is losing anything |
| `cache_read_tokens` | §7, once measurable |

`restore_calls` is the key number. A high rate means elision is too aggressive
and the ladder needs retuning; a near-zero rate means old tool output was dead
weight all along.

---

## 12. What this is expected to buy

Back-of-envelope, 60-turn session, ~40k average prompt:

| | input tokens |
|---|---|
| today | ~2.4M |
| + elision + hysteresis | ~1.5M |
| + prefix/digest caching (if reachable) | ~0.7M equivalent |

Rough, and dominated by the tool-output ratio of the workload. The first row of
savings needs no provider cooperation and is the one to bank on; the second is
contingent on §7's open question.

Correctness wins are not contingent on anything: no spin, no orphan repair, no
data loss, and a projection that provably terminates under budget.
