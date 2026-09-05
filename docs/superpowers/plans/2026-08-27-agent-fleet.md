# Agent Fleet — implementation plan (FLEET)

> Date: 2026-08-27
> Design: [`2026-08-27-agent-fleet-design.md`](../specs/2026-08-27-agent-fleet-design.md)
> Roadmap: extends #3 (multi-agent composition), touches #14 (TUI), web surface

Six sprints. Sprint 1 is load-bearing — everything after it is presentation over
the identity it establishes. Sprints 3 and 4 (TUI, web) are independent of each
other and can run in parallel once 2 lands.

---

## Sprint 1 — Agent identity on the wire

**Goal:** every sub-agent event is attributable; nothing renders differently yet.

- [ ] `src/agents/frames.ts` — `AgentFrame` type, `newAgentId()`, root frame
      constructor.
- [ ] `src/agents/events.ts` — `tagEvents(parent, frame)` wrapping
      `AgentLoopEvents`; stamps `agent_id` on token / tool_start / tool_end /
      tool_prompt / stats.
- [ ] Replace the hand-rolled pass-through in
      [`src/agents/runner.ts:66`](../../../src/agents/runner.ts) and
      [`src/tools/builtin/delegate.ts:78`](../../../src/tools/builtin/delegate.ts)
      with `tagEvents`.
- [ ] `src/types.ts` — `AgentFrame`, `agent_spawn` / `agent_state` /
      `agent_stats` / `agent_end` server messages; optional `agent_id` on
      existing streaming messages; `PROTOCOL_VERSION = 3`.
- [ ] Protocol-2 degradation branch in the tagger (child events forwarded
      untagged, exactly as today).
- [ ] Emit `agent_spawn` / `agent_end` from `runSubAgent`, including the child's
      `session_id` and duration.
- [ ] Unify depth: `Delegate`'s hardcoded `>= 1` becomes `context.maxDepth ?? 2`.
- [ ] `tests/agent-frames.test.ts`.

**Done when:** a fan-out run's WS trace shows every child event tagged, and a
client pinned to protocol 2 sees a byte-identical stream to today.

---

## Sprint 2 — Spawn verb, catalog, and the bounded pool

**Goal:** a human can dispatch a sub-agent; fan-out stops being all-or-nothing.

- [ ] `src/profiles/schema.ts` — optional `spawn` block on `AgentEntrySchema`
      (`label`, `hint`, `prompt_field`, `example`, `max_concurrent`,
      `budget_usd`). Strictly additive; absent block changes nothing.
- [ ] `src/agents/catalog.ts` — build `AgentCatalogEntry[]` from
      `profile.agents` + discoverable profiles for `Delegate`.
- [ ] `ClientMessage`: `spawn`, `agent_cancel`, `agents_list`;
      `ServerMessage`: `agent_catalog`.
- [ ] `src/server/index.ts` — handle the three verbs. `spawn` resolves the
      executor from the map `loadAgentTools` already built (no second dispatch
      path), applies `prompt_field` shorthand, validates, runs with
      `origin: 'operator'`.
- [ ] Budget share of parent remainder, refused before start with numbers in the
      `notice` (ADR-43).
- [ ] Taint inheritance for operator spawn (ADR-50).
- [ ] `src/agents/pool.ts` — bounded concurrency, per-child `AbortController`
      chained off `context.signal`; `DelegateFanout` switches to it and to
      `allSettled`.
- [ ] `tests/spawn-contract.test.ts`, `tests/fanout-pool.test.ts`,
      `tests/spawn-taint.test.ts` (permanent red-team fixture, ADR-51).
- [ ] `profiles/research.yaml` gains `spawn:` blocks for `researcher` and
      `summariser` as the worked example.

**Done when:** `wscat`-level spawn works end to end, cancelling one child of a
three-way fan-out leaves the other two running, and the taint fixture is green.

---

## Sprint 3 — TUI fleet surface *(parallel with Sprint 4)*

**Goal:** the operator can see, follow, and steer children from the terminal.

- [ ] `tui/internal/protocol/msg.go` — mirror the new messages and `AgentId`
      field; constructors for `spawn` / `agent_cancel` / `agents_list`.
- [ ] `tui/internal/ui/fleet.go` — fleet model: `map[agentID]*FleetChild`
      (name, state, tool, elapsed, spend, sections).
- [ ] `rail.go` — `FLEET` section, rendered only when children exist; `RailHit`
      entries per row.
- [ ] `section.go` — child agent names join `toolCategory` as `agents`;
      timeline key becomes `category|label|agent_id` so same-named siblings do
      not merge.
- [ ] `activity_group.go` — one level of nesting: a child renders as an `AGENTS`
      group that expands into its own sections; deeper descendants fold into the
      nearest displayed ancestor with a depth badge.
- [ ] Follow mode — `Enter` on a fleet row / `/follow <agent>`; transcript
      filters by `agent_id`; status bar affordance; `esc` restores.
- [ ] `modals.go` — approval modal renders agent provenance when
      `agent_id != root`.
- [ ] `/spawn` slash command with catalog completion; `/fleet` overlay tab
      listing every child with output or error.
- [ ] Unfocused children render state only, never prose; follow mode streams
      that child's tokens (resolved question 3).
- [ ] `tui/internal/ui/fleet_test.go` + app-flow coverage in `app_test.go`.

**Done when:** `cd tui && go test ./...` is green and a three-way fan-out is
legible, followable, and individually cancellable in the terminal.

---

## Sprint 4 — Web fleet surface *(parallel with Sprint 3)*

**Goal:** the same three verbs in the browser, with room to show more.

- [ ] Reducer — `Map<agent_id, AgentLane>` alongside the message list; root view
      filters to `agent_id === 'root' || undefined`. Root is never drawn as a
      lane (resolved question 1).
- [ ] `web/components/fleet/FleetLanes.tsx` — swimlane per live child; state
      pill, elapsed, spend, current tool, cancel.
- [ ] `web/components/fleet/AgentDrawer.tsx` — per-child transcript reusing
      `Message` / `ToolCall`; shows validated output or contract violation on
      completion.
- [ ] Inline completion marker in the parent transcript where the delegation
      happened (ADR-81).
- [ ] `SpawnChip` — `@agent` in the composer opens a picker from
      `agent_catalog`; `prompt_field` agents take the rest of the line, others
      get a schema-generated form.
- [ ] `ApprovalQueue` renders agent provenance; child `AskUser` prompts are
      labelled and individually cancellable (resolved question 2).
- [ ] `RunBoard` — nested rows via `parent_run_id`; `mergeRunEvent` learns
      `agent_*` events.
- [ ] Component tests + one Playwright e2e over a scripted fan-out fixture.

**Done when:** `pnpm test` and the web e2e are green and a fan-out reads as
lanes, not interleaved prose.

---

## Sprint 5 — Persistence and history

- [ ] `Run` gains `parent_run_id?` and `agent_name?`; `runner.ts` links the child
      session it already creates.
- [ ] `GET /runs` returns tree shape; `GET /runs/:id` includes children.
- [ ] Session history shows "spawned by" for child sessions.
- [ ] Telemetry: `agent_id` / `parent_agent_id` on delegated tool and llm events
      so `harness stats` can attribute spend per sub-agent.

---

## Sprint 6 — Docs and decisions

- [ ] ADR-78 … ADR-81 appended to [`docs/ADR.md`](../../ADR.md), index rows
      included.
- [ ] `docs/ROADMAP.md` #3 updated with the shipped fleet surface.
- [ ] `docs-site/architecture.md` system map gains the agent-frame boundary.
- [ ] `CLAUDE.md` key-modules table: `src/agents/{frames,events,pool,catalog}.ts`.

---

## Sequencing notes

- Sprint 1 is a **prerequisite for everything**. Do not start UI work against a
  guessed frame shape.
- Sprints 3 and 4 share only the protocol mirror; assign them separately.
- Sprint 5 is safely deferrable — it improves after-the-fact analysis, not the
  live experience the request is about.
- Landing Sprints 1–2 alone already fixes the anonymous-approval safety gap and
  the fan-out isolation bug, so they are worth shipping even if the UI sprints
  slip.

## Risks

| Risk | Mitigation |
|---|---|
| Protocol churn breaks the Go client silently | `PROTOCOL_VERSION = 3` with an explicit degradation branch and a protocol-2 regression test in Sprint 1 |
| Nested rendering makes the TUI transcript unreadable | Nesting hard-capped at one visual level; unfocused children emit state only |
| Operator spawn becomes a safety bypass | Taint inheritance fixture is written in the same sprint as the feature, not after |
| Two surfaces drift on tree semantics | Parentage is stamped server-side (ADR-78); neither client reconstructs it |
