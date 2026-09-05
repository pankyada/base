# Agent Fleet — spawn & watch sub-agents from the TUI and web — Design (FLEET)

> Date: 2026-08-27
> Status: Draft (design)
> Related: `src/agents/loader.ts`, `src/agents/runner.ts`,
> `src/tools/builtin/delegate.ts`, `src/tools/builtin/delegate-fanout.ts`,
> `src/types.ts`, `src/runs/store.ts`, `src/server/index.ts`,
> `tui/internal/ui/{section,activity_group,rail,overlay}.go`,
> `web/components/ops/RunBoard.tsx`, `docs/ROADMAP.md` #3, ADR-13, ADR-43, ADR-50

## Goal

Make delegation a thing an operator can **see, steer, and start** — not an
opaque pause in the parent's stream.

Concretely, three verbs:

- **Spawn** — a human, not only the model, can launch a named sub-agent with a
  task, from the TUI composer or the web composer, without hand-writing JSON.
- **Watch** — every sub-agent has a visible identity, live state, spend, and its
  own readable transcript, in both surfaces, while it runs.
- **Steer** — cancel one child without killing the turn; know which child is
  asking for an approval; give a child its own budget slice.

## What already exists (verified 2026-08-27, do not rebuild)

| Piece | State | Where |
|---|---|---|
| Profiles-as-tools (ADR-13) | Shipped — `agents:` block compiles each entry into a `ToolDefinition` with ajv-validated I/O | [`src/agents/loader.ts:22`](../../../src/agents/loader.ts) |
| Sub-agent execution | Shipped — fresh profile, session, memory, skills, MCP clients per child; depth cap; JSON contract parse | [`src/agents/runner.ts:26`](../../../src/agents/runner.ts) |
| Parallel fan-out | Shipped — `DelegateFanout` over `Promise.all` | [`src/tools/builtin/delegate-fanout.ts:36`](../../../src/tools/builtin/delegate-fanout.ts) |
| Ad-hoc delegation | Shipped — `Delegate` tool takes a profile name + free-text task | [`src/tools/builtin/delegate.ts:26`](../../../src/tools/builtin/delegate.ts) |
| Run records | Shipped — `~/.harness/runs/<user>/<date>_<id>.json`, status lifecycle, `GET /runs`, cancel | [`src/runs/store.ts`](../../../src/runs/store.ts), [`web/components/ops/RunBoard.tsx`](../../../web/components/ops/RunBoard.tsx) |
| Per-run event tagging | Shipped — `run_id` on `token`/`tool_*`/`stats`/`session_end` | [`src/types.ts:181`](../../../src/types.ts) |
| TUI activity grouping | Shipped — sections merge by category; **an `agents` category already exists** for `Delegate`/`DelegateFanout` | [`tui/internal/ui/section.go:12`](../../../tui/internal/ui/section.go) |
| TUI overlay tabs, rail, modals | Shipped — tabs for tasks/skills, rail sections, approval + input modals | `tui/internal/ui/` |
| Budget inheritance, taint across delegation | Shipped (ADR-43, ADR-50) | `src/runs/budget.ts`, `src/safety/` |

**So the delegation engine is not missing. Its observability is.**

### The five real gaps

1. **Sub-agent events are laundered into the parent's stream.**
   [`runner.ts:66`](../../../src/agents/runner.ts) builds `subEvents` as a
   pass-through: `onToken: t => context.events.onToken(t)`, and the same for
   `onToolStart` / `onToolEnd` / `onToolPrompt`. The child's prose and tool
   calls arrive on the socket **indistinguishable from the parent's**.
   `Delegate` does the same at [`delegate.ts:78`](../../../src/tools/builtin/delegate.ts).
   Nothing downstream can attribute them, because nothing upstream tagged them.
   Every UI symptom below is downstream of this one line.

2. **The protocol has no agent axis.** `run_id` distinguishes *concurrent top-level
   runs*; there is no `agent_id`, no parent link, no depth, and no
   spawn/end event. A Go or React client cannot render a tree it is never told
   about.

3. **Only the model can spawn.** `ClientMessage` has no spawn verb. An operator
   who wants "run the researcher on these three queries" must ask the model in
   prose and hope it emits the right tool call with schema-valid JSON.

4. **Approvals are anonymous.** A child's `tool_prompt` reaches the operator with
   no indication of which agent wants to run `Bash`. In a 3-way fan-out the
   operator is approving blind — a safety gap, not a cosmetic one.

5. **Fan-out is unbounded and all-or-nothing.** `Promise.all` over N tasks: no
   concurrency cap, no per-child cancel, and one rejection is not isolated from
   the rest. `cancel` kills the whole turn via the shared `context.signal`.

Two smaller inconsistencies worth fixing while in here: `Delegate` caps depth at
1 ([`delegate.ts:42`](../../../src/tools/builtin/delegate.ts)) while agents-as-tools
caps at `maxDepth ?? 2` ([`runner.ts:36`](../../../src/agents/runner.ts)); and
child agent names (`researcher`, `summariser`) are absent from
[`toolCategory`](../../../tui/internal/ui/section.go), so they render as `MISC`
even though an `AGENTS` category already exists.

## Non-goals

- **No new sub-agent runtime.** ADR-13 is deliberate: a profile is the only
  agent abstraction. The `spawn` client message must land on the *same*
  `AgentExecutor` the model's tool call lands on, or we have two policy
  surfaces that will drift.
- **No cross-machine fleet.** Children run in-process under the parent session,
  as today. Distributing them is a separate concern (A2A, #6) and would change
  the cancellation and budget stories entirely.
- **No editable child transcript.** Watching is read-only plus cancel. Injecting
  a mid-flight instruction into a running child is out of scope; the child's
  contract is its declared input schema.
- **No graph/DAG authoring UI.** Spawn is one-shot task dispatch. Chaining
  belongs to `workflow:` (#15), which already owns stages.
- **No persistent fleet dashboard across sessions.** The Fleet surface is
  session-scoped and live; historical children are reachable through the
  existing run/session history, extended with a parent link.

## Design

### 1. Agent identity is the load-bearing change

Every child run gets an **agent frame**:

```ts
export interface AgentFrame {
  agent_id: string          // stable per spawn, e.g. "ag_7f3a"
  agent_name: string        // "researcher" | profile name for Delegate
  parent_agent_id: string   // "root" for the top-level turn
  depth: number             // root = 0
  origin: 'model' | 'operator'
  profile: string
  session_id: string        // the child's own persisted session
}
```

`root` is a real frame, synthesised at `turn_start`, so clients have one
uniform model rather than "the main stream plus some others".

**Tagging happens at exactly one seam.** A helper —
`src/agents/events.ts: tagEvents(parent: AgentLoopEvents, frame: AgentFrame)` —
wraps the parent's event sink and stamps `agent_id` on every forwarded event.
`runner.ts` and `delegate.ts` both call it instead of hand-rolling the
pass-through object. That is the fix for gap 1, and it is a small one; the rest
of this design is the surface area it unlocks.

### 2. Protocol delta (`src/types.ts`, mirrored in `tui/internal/protocol/msg.go`)

New server messages:

```
| { type: 'agent_spawn'; frame: AgentFrame; input: Record<string, unknown>; budget?: { max_cost_usd: number }; run_id?: string }
| { type: 'agent_state'; agent_id: string; state: 'running' | 'waiting_approval' | 'waiting_input'; tool?: string; run_id?: string }
| { type: 'agent_stats'; agent_id: string; tokens_in: number; tokens_out: number; cost_usd: number; tools: number; run_id?: string }
| { type: 'agent_end'; agent_id: string; status: 'completed' | 'failed' | 'cancelled' | 'budget_exceeded' | 'contract_violation'; error?: string; output?: unknown; duration_ms: number; run_id?: string }
```

New client messages:

```
| { type: 'spawn'; agent: string; input: Record<string, unknown>; count?: number; budget_usd?: number }
| { type: 'agent_cancel'; agent_id: string }
| { type: 'agents_list' }
```

`agents_list` replies with `{ type: 'agent_catalog'; agents: AgentCatalogEntry[] }`
so a picker can be built without the client parsing profile YAML.

**Every existing streaming message gains an optional `agent_id`.** Optional, and
omitted for root, so a client that has not been updated keeps working exactly as
today — the field is additive and ignorable. `PROTOCOL_VERSION` goes to 3; the
server keeps emitting untagged events to clients that negotiated 2, by dropping
child frames' events into the parent stream as it does now. That degradation is
one branch in the tagger, not a second code path.

### 3. Spawn without JSON literacy

An operator typing `/spawn researcher` should not have to know the ajv schema.
The profile gains an optional presentation block per agent entry:

```yaml
agents:
  - name: researcher
    profile: ./researcher.yaml
    spawn:
      label: "Research a question"
      hint: "One question per spawn. Give sources if you have them."
      prompt_field: query        # free text from the composer lands here
      example: { query: "How does X compare to Y?", sources: ["arxiv"] }
      max_concurrent: 3
      budget_usd: 0.50
    input: { ... }
    output: { ... }
```

`spawn` is entirely optional and **never affects the model-facing tool** — it is
picker metadata. `prompt_field` is the ergonomic core: with it, `/spawn
researcher how does X compare to Y` is a complete, schema-valid dispatch. Without
it, the surface falls back to a field-by-field form generated from the input
schema (string/number/enum/boolean only; anything more exotic gets a raw JSON
box).

Server-side, `spawn` resolves the named executor from the same map
`loadAgentTools` built, validates against the same compiled validator, and calls
it with `origin: 'operator'`. Rejecting an unknown or schema-invalid spawn is a
`notice`, not an error frame — the turn is unaffected.

**Taint (ADR-50):** an operator spawn inside a tainted turn inherits the turn's
taint. Human origin is not a laundering path; the frame records `origin` for
audit, and the safety layer reads the parent turn's taint exactly as it does for
a model-issued delegation.

**Budget (ADR-43):** `budget_usd` is a *share of the parent's remainder*, never a
fresh allowance. A spawn whose requested share exceeds the remainder is refused
before the child starts, with the numbers in the notice.

### 4. Fan-out gets a governor

`DelegateFanout` moves from bare `Promise.all` to a bounded pool
(`max_concurrent`, default 3, per-agent override from the `spawn` block) with
per-child `AbortController`s chained off `context.signal`. `agent_cancel` aborts
one child's controller; the parent's `Promise.allSettled` records that child as
`cancelled` and the remaining children continue. Cancelling the turn still
cancels everything, because the parent signal is the pool's root.

This also fixes the isolation bug: `allSettled` means one child's throw no
longer discards the siblings' completed work.

### 5. TUI — the Fleet rail section and follow mode

Three additive pieces, all reusing existing machinery:

**Rail section `FLEET`** (`tui/internal/ui/rail.go`) — appears only while
children exist. One line per child:

```
FLEET  2 running
 ▸ researcher   ⠹ 0:12  WebFetch      $0.04
 ▸ researcher   ⠹ 0:11  brave_search  $0.03
 ▪ summariser   waiting                $0.00
```

State glyph, elapsed, current tool, spend. Clickable (the rail already has a
`RailHit` model) — a click focuses that child.

**Transcript nesting** (`section.go`, `activity_group.go`) — a child's activity
becomes one `AGENTS` group section titled by agent name, whose expansion shows
the child's own sections one level in. `BuildTimeline` already groups by
`category|label`; the key becomes `category|label|agent_id`, so two concurrent
`researcher` children stay separate lanes rather than merging into one pile.
Child agent names join `toolCategory` as `agents`, so they stop rendering as
`MISC`. Nesting is capped at one visual level regardless of `depth`, because a
terminal column is not a tree viewer — deeper descendants render inside their
nearest displayed ancestor with a depth badge.

**Follow mode** — `Enter` on a rail fleet row (or `/follow <agent>`) filters the
transcript to that `agent_id`; the status bar shows `following researcher · esc
to return`. This is a view filter over sections already held in the model — no
new state, no re-fetch. `esc` restores the root view.

**Approval provenance** — the approval modal gains an agent line whenever
`agent_id != root`: `researcher (depth 1) wants to run Bash`. This is the
smallest change in the design and closes gap 4.

**Composer** — `/spawn` with completion over the agent catalog, and `/fleet` to
open an overlay tab listing every child of the session (running and finished)
with its output or error, reusing the existing tab and modal infrastructure.

### 6. Web — lanes, not a log

`web/components/fleet/`:

- **`FleetLanes.tsx`** — a horizontal swimlane per live child under the
  transcript: name, state pill, elapsed, spend, current tool, cancel button.
  Collapsed to a single summary strip when idle.
- **`AgentDrawer.tsx`** — click a lane to open a side drawer with that child's
  own transcript, tool calls, input, and (on completion) validated output or
  contract violation. Reuses `Message` / `ToolCall` unchanged, fed a filtered
  event list.
- **`SpawnChip`** — typing `@researcher` in the composer opens the picker built
  from `agent_catalog`; a `prompt_field` agent needs only the rest of the line.
- **`RunBoard`** gains parent/child nesting via the frame's `parent_agent_id`,
  and `mergeRunEvent` learns the new event types.

The reducer keeps one `Map<agent_id, AgentLane>` alongside the existing message
list; messages carry `agent_id` and the root view filters to `agent_id ===
'root' || undefined`. Sub-agent prose no longer interleaves into the main
transcript at all — it lives in its lane, with a one-line "researcher finished ·
4 findings" marker inline where the delegation happened.

### 7. Persistence

`Run` gains `parent_run_id?` and `agent_name?`; the child session created in
`runner.ts` is already persisted, so linking it costs one field. `GET /runs`
returns the tree shape; session history can show "spawned by" without a new
store.

## Safety review

| Concern | Resolution |
|---|---|
| Operator spawn as a taint-laundering path | Spawn inherits the parent turn's taint; `origin` is audit metadata only (ADR-50) |
| Fan-out multiplying spend | Bounded pool + budget share of parent's remainder, checked before the child starts (ADR-43) |
| Child ACL escalation | Unchanged — the child's own profile ACL governs it; parent cannot widen it |
| Anonymous approvals | Frame is attached to `tool_prompt`; modal and web queue both render it |
| Deep recursion | `maxDepth` unified at 2 across `Delegate` and agents-as-tools; `spawn` counts as depth 0 → child at 1 |

## Test plan

- `tests/agent-frames.test.ts` — every event a child emits carries its
  `agent_id`; root events carry none; a protocol-2 client sees today's stream.
- `tests/fanout-pool.test.ts` — concurrency never exceeds the cap; one child's
  rejection does not discard siblings; `agent_cancel` kills exactly one.
- `tests/spawn-contract.test.ts` — operator spawn hits the same validator as the
  model path; schema-invalid spawn returns a notice and leaves the turn intact;
  budget over-request is refused before the child starts.
- `tests/spawn-taint.test.ts` — permanent red-team fixture (ADR-51): a tainted
  turn cannot produce an untainted child via operator spawn.
- `tui/internal/ui/fleet_test.go` — timeline keys separate two same-named
  children; follow mode filters and restores; approval modal renders provenance.
- `web/components/fleet/*.test.ts` — lane reducer, drawer filtering, nested
  `RunBoard` rows.

## Proposed ADRs

- **ADR-78 — Agent identity is stamped at one seam, not reconstructed by clients.**
  Tagging in `tagEvents` rather than letting each surface infer parentage from
  timing keeps TUI and web from drifting into two different (both wrong) trees.
- **ADR-79 — Operator spawn reuses the model's executor path.**
  A second dispatch path would duplicate validation, budget, and taint policy.
- **ADR-80 — Fan-out is a bounded pool with per-child cancellation.**
  `Promise.all` cannot express "stop that one" and cannot bound spend.
- **ADR-81 — Sub-agent output leaves the parent transcript.**
  Child prose renders in its own lane with an inline completion marker; the
  parent transcript stays readable as the parent's reasoning.

## Resolved questions (2026-08-27)

1. **Root is a frame on the wire, not a lane in the UI.** Clients get one
   uniform model server-side; neither surface draws a "root" row, because the
   transcript already is root and a lane restating it is redundant.
2. **A child may block on a human — labelled and individually cancellable.**
   `AskUser` and tool approvals from a child surface with agent provenance, and
   the child can be cancelled without killing the turn. Provenance is what makes
   this safe; without it the same behaviour was the blind-approval gap. Revisit
   only if unattended runs start wedging on prompts nobody is watching.
3. **Prose only when followed.** An unfocused child renders state, current tool,
   elapsed and spend — never tokens. Follow mode streams that child's prose.
   This keeps the default view calm and bounds render cost as N children grow.
