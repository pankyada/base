# Context Projection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Design: [`docs/superpowers/specs/2026-08-01-context-projection-design.md`](../specs/2026-08-01-context-projection-design.md)

**Goal:** Stop mutating history to manage context. `session.messages` becomes an
append-only ledger; what goes to the provider becomes a projection recomputed
each turn from (ledger, budget, policy). Tool results decay to restorable
handles before anything is summarised, the estimator calibrates itself against
real provider token counts, durable facts are promoted into memory instead of
being retained in the transcript, and the prompt prefix is stable enough to
cache.

**Architecture:** New `src/context/` module owns projection, estimation, digest
and pins. `src/loop/context-manager.ts` is deleted and its two import sites move.
New `ContextRestore` builtin. Additive changes only to `src/session/types.ts`,
`src/profiles/schema.ts`, `src/types.ts`, `src/tools/builtin/skill.ts`,
`src/loop/agent-loop.ts`, `src/server/index.ts`.

**Tech Stack:** TypeScript, Zod, OpenAI SDK, Vitest. No new runtime dependency —
in particular no tokenizer package (the estimator calibrates against
`usage.prompt_tokens`).

## Global Constraints

- **Total back-compat.** Sessions written by the current build must load and
  project correctly with no `session.context` block. Profiles using
  `context_window:` must keep working unchanged.
- **The ledger is append-only.** After this change, nothing outside the agent
  loop's own appends may mutate `session.messages`. `/compact` included.
- **`project()` always terminates under budget.** Tier 3 (drop) is the backstop;
  a digest failure must fall through to it, never return over budget, never spin.
- **No message removal during elision.** Tier 1 rewrites `content` only —
  role, order and `tool_call_id` are preserved, so orphan repair is unnecessary.
- **Digest cuts only at turn boundaries.** No partial turns, ever.
- **`cache: false` by default** until §7's open question is measured.
- **No WS protocol change.** `stats.context_tokens` keeps its current meaning.
- Ends green: `pnpm typecheck && pnpm test && cd tui && go test ./...`.

> **Scope note:** this is deliberately one phase, per the decision to ship it as
> a single change. Task 6 (projection wiring) is the only irreversible-feeling
> step; it is ordered after the ladder and estimator are independently green, so
> it lands against tested primitives. Tasks 1–5 are individually revertible.

---

# Phase 1 — Context projection

### Task 1: Session + profile shape

**Files:**
- Modify: `src/session/types.ts`
- Modify: `src/profiles/schema.ts`
- Test: `tests/context-schema.test.ts`

**Interfaces:**
- Produces: `SessionToolCall.id?: string`
- Produces: `Session.context?: ContextState` where
  `ContextState = { pins: Array<{ key: string; text: string }>; digest?: { upto: number; text: string }; calib: { ratio: number; samples: number } }`
- Produces: profile `context:` block (`max_tokens`, `high_water`, `low_water`, `tail_turns`, `pin_budget`, `digest_model_id`, `cache`) with defaults per design §9.

- [ ] **Step 1:** Write failing test: a session JSON with no `context` field parses and `ensureContextState()` initialises it with `calib.ratio === 1`.
- [ ] **Step 2:** Write failing test: a profile with `context_window: { max_tokens: 50000, model_id: 'x' }` and no `context:` block resolves to `context.max_tokens === 50000` and `context.digest_model_id === 'x'`.
- [ ] **Step 3:** Write failing test: `high_water` must be > `low_water`; schema rejects otherwise.
- [ ] **Step 4:** Add the types, the Zod block, the deprecated-alias mapping, and `ensureContextState()`.
- [ ] **Step 5:** Verify `pnpm typecheck && npx vitest run tests/context-schema.test.ts tests/profile-schema.test.ts tests/session-store.test.ts`.

---

### Task 2: Self-calibrating estimator

**Files:**
- Create: `src/context/estimator.ts`
- Test: `tests/context-estimator.test.ts`

**Interfaces:**
- Produces: `rawTokens(msgs: unknown[]): number`
- Produces: `estimateTokens(msgs: unknown[], session?: Session): number` — same signature shape as the current export so `server/index.ts` needs no logic change.
- Produces: `calibrate(session: Session, actualPromptTokens: number, sentRaw: number): void`
- Produces: `contextWindowFor(profile: Profile): number` — replaces `contextWindowForProfile`, same fallback chain (profile → model registry → `Infinity`).

- [ ] **Step 1:** Write failing test: `calibrate` moves `ratio` toward `actual/raw` with α = 0.3 and converges within 3 samples for a constant true ratio.
- [ ] **Step 2:** Write failing test: `ratio` is clamped to `[0.5, 3]` for absurd inputs (zero, negative, huge).
- [ ] **Step 3:** Write failing test: `estimateTokens` with no session (or `samples === 0`) equals `rawTokens` exactly — no behaviour change before calibration.
- [ ] **Step 4:** Write failing test: `contextWindowFor` returns `Infinity` for an unknown model with no configured `max_tokens`.
- [ ] **Step 5:** Implement.
- [ ] **Step 6:** Verify `npx vitest run tests/context-estimator.test.ts`.

---

### Task 3: `ContextRestore` builtin + tool-call ids

**Files:**
- Create: `src/tools/builtin/context-restore.ts`
- Modify: `src/tools/builtin/index.ts`
- Modify: `src/loop/agent-loop.ts` (record `id` when pushing to `session.tool_calls`)
- Test: `tests/context-restore.test.ts`

**Interfaces:**
- Produces: `contextRestoreTool` — `ContextRestore(id: string, offset?: number, limit?: number) -> string`
- Consumes: `session.tool_calls[].id`

- [ ] **Step 1:** Write failing test: after a loop run, every entry in `session.tool_calls` carries the matching `tool_call_id`.
- [ ] **Step 2:** Write failing test: `ContextRestore` with a known id returns the full stored result.
- [ ] **Step 3:** Write failing test: `offset`/`limit` return the requested slice and append a `[… N chars remain]` marker when truncated.
- [ ] **Step 4:** Write failing test: an unknown id — and an id from a session whose `tool_calls` have no `id` — returns a clear "not available in this session" string and does **not** throw.
- [ ] **Step 5:** Implement the tool, register it in `registerAll()`, populate `id` at `agent-loop.ts:290`.
- [ ] **Step 6:** Verify `npx vitest run tests/context-restore.test.ts tests/registry.test.ts tests/agent-loop.test.ts`.

---

### Task 4: Pins

**Files:**
- Create: `src/context/pins.ts`
- Modify: `src/tools/builtin/skill.ts`
- Test: `tests/context-pins.test.ts`

**Interfaces:**
- Produces: `pin(session, profile, key, text): 'ok' | 'over-budget'`
- Produces: `renderPins(session): string`
- Consumes: `context.pin_budget`

- [ ] **Step 1:** Write failing test: pinning the same key twice does not duplicate and does not grow the rendered prefix.
- [ ] **Step 2:** Write failing test: a pin that would push the prefix past `pin_budget × window` returns `'over-budget'` and leaves `session.context.pins` unchanged.
- [ ] **Step 3:** Write failing test: `renderPins` output is byte-identical across two calls with no intervening pin (prefix stability — the precondition for Task 7).
- [ ] **Step 4:** Write failing test: the `Skill` tool pins the SKILL.md body it returns, keyed by skill name.
- [ ] **Step 5:** Implement; keep `Skill`'s return value unchanged so an over-budget pin degrades to a plain tool result.
- [ ] **Step 6:** Verify `npx vitest run tests/context-pins.test.ts tests/skills.test.ts`.

---

### Task 5: Digest with fact promotion

**Files:**
- Create: `src/context/digest.ts`
- Test: `tests/context-digest.test.ts`

**Interfaces:**
- Produces: `buildDigest(session, profile, openai, upto): Promise<{ text: string; facts: Fact[] } | null>`
- Consumes: `MemoryProvider.write()` for the `project` scope
- Consumes: `context.digest_model_id ?? models.roles.cheap ?? model.id`

- [ ] **Step 1:** Write failing test: the digest call requests JSON with `digest` and `facts` keys, and a well-formed response promotes each fact via `memory.write()` into the `project` scope.
- [ ] **Step 2:** Write failing test: malformed JSON, a provider throw, and an empty `facts` array each return the best available result without throwing — `null` only when no digest text could be produced.
- [ ] **Step 3:** Write failing test: `buildDigest` regenerates from `ledger[1..upto]` — calling it twice with a larger `upto` does not nest the previous digest inside the new one.
- [ ] **Step 4:** Write failing test: model selection honours the fallback chain.
- [ ] **Step 5:** Implement.
- [ ] **Step 6:** Verify `npx vitest run tests/context-digest.test.ts tests/memory.test.ts`.

---

### Task 6: Projection + eviction, and delete the condenser

**Files:**
- Create: `src/context/projection.ts`
- Delete: `src/loop/context-manager.ts`
- Delete: `tests/context-manager.test.ts` (superseded)
- Modify: `src/loop/agent-loop.ts`
- Modify: `src/server/index.ts`
- Test: `tests/context-projection.test.ts`

**Interfaces:**
- Produces: `project(session, profile, openai): Promise<unknown[]>`
- Consumes: everything from Tasks 1–5.

- [ ] **Step 1:** Write failing test — **band order**: projection is `[system, digest?, ...live]`, system always index 0, digest (when present) always index 1.
- [ ] **Step 2:** Write failing test — **tail is sacred**: with a tiny window, the last `tail_turns` turns are still verbatim.
- [ ] **Step 3:** Write failing test — **elision first**: a session over `high_water` purely from large tool results comes under `low_water` with zero calls to the digest model, and every elided message keeps its role, position and `tool_call_id`.
- [ ] **Step 4:** Write failing test — **no orphans, ever**: for every projected assistant message with `tool_calls`, all matching `role:'tool'` messages are present in the projection, in every tier combination.
- [ ] **Step 5:** Write failing test — **turn-boundary digest**: the digest never folds a partial turn (never splits an assistant/tool group).
- [ ] **Step 6:** Write failing test — **termination**: with a window smaller than prefix + tail, `project()` returns under budget by dropping oldest turns and emits a notice. It does not throw and does not loop.
- [ ] **Step 7:** Write failing test — **digest failure falls through**: a throwing digest model still yields an under-budget projection via tier 3.
- [ ] **Step 8:** Write failing test — **ledger untouched**: `session.messages` is deep-equal before and after `project()` in all of the above.
- [ ] **Step 9:** Write failing test — **hysteresis**: after one compaction, N subsequent turns project without re-running the digest.
- [ ] **Step 10:** Implement `project()` with the §8 eviction order.
- [ ] **Step 11:** Wire `agent-loop.ts`: replace `maybeCondenseMessages(...)` + `messages: session.messages` with `messages: await project(session, profile, openai)`; call `calibrate()` from the `chunk.usage` branch.
- [ ] **Step 12:** Wire `server/index.ts`: update the two imports; make the `compact` handler lower the water line and re-project for its before/after report **without mutating the ledger**; keep the `stats` payload shape identical.
- [ ] **Step 13:** Delete `src/loop/context-manager.ts` and its test.
- [ ] **Step 14:** Verify `pnpm typecheck && pnpm test`.

---

### Task 7: Cache breakpoints (flagged, default off)

**Files:**
- Create: `src/context/cache.ts`
- Modify: `src/context/projection.ts`
- Test: `tests/context-cache.test.ts`

- [ ] **Step 1:** Write failing test: with `cache: false` the projection is byte-identical to Task 6's output — no markers anywhere.
- [ ] **Step 2:** Write failing test: with `cache: true`, breakpoints land at end-of-prefix and end-of-digest, and nowhere else.
- [ ] **Step 3:** Write failing test: across two consecutive turns with no pin and no recompaction, bands 0 and 1 serialise byte-identically.
- [ ] **Step 4:** Implement, defaulting to off.
- [ ] **Step 5:** **Measure and record.** Run a real multi-turn session against the Anthropic OpenAI-compatible endpoint used by `profiles/*.yaml` with `cache: true`. Record in the design doc §7 whether `cache_read_tokens` comes back non-zero. If it does not, state plainly that the win needs a native Anthropic path and leave the flag off.
- [ ] **Step 6:** Verify `npx vitest run tests/context-cache.test.ts`.

---

### Task 8: Telemetry

**Files:**
- Modify: `src/types.ts`
- Modify: `src/context/projection.ts`
- Test: `tests/context-telemetry.test.ts`

- [ ] **Step 1:** Write failing test: old-shape telemetry lines still parse (all new fields optional).
- [ ] **Step 2:** Write failing test: a projection that elides emits `elided_count` / `elided_bytes`; one that digests emits `digest_calls`; a `ContextRestore` call increments `restore_calls`.
- [ ] **Step 3:** Write failing test: `context_tokens_est` and `context_tokens_actual` are both recorded on each `llm` event so estimator drift is queryable.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Verify `npx vitest run tests/context-telemetry.test.ts tests/telemetry.test.ts`.

---

### Task 9: Docs + roadmap

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/ROADMAP.md`
- Create: `docs-site/context.md`
- Modify: `docs-site/index.md`, `docs-site/builtin-tools.md`

- [ ] **Step 1:** `CLAUDE.md` — add `src/context/` to the key-modules table; replace the context-window line with the ledger/projection model in two sentences.
- [ ] **Step 2:** `docs-site/context.md` — bands, the decay ladder, `ContextRestore`, pins, the `context:` block, and the deprecated `context_window:` alias.
- [ ] **Step 3:** `docs-site/builtin-tools.md` — document `ContextRestore`.
- [ ] **Step 4:** `docs/ROADMAP.md` — add this as a completed item with an honest "what shipped" list; state the Task 7 measurement result rather than claiming a caching win.
- [ ] **Step 5:** Verify `pnpm typecheck && pnpm test && cd tui && go test ./...`.

---

## Verification

Final gate, all green:

```bash
pnpm typecheck && pnpm test && cd tui && go test ./...
```

Manual smoke, since the suite is entirely mocked:

- [ ] Long real session against a live profile until compaction triggers; confirm the transcript stays coherent and the agent can still answer about earlier turns.
- [ ] Force elision, then ask the agent something that needs an elided file; confirm it calls `ContextRestore` and recovers.
- [ ] `/compact` in the TUI; confirm the notice reports sensible before/after numbers and that `session.messages` length is unchanged on disk.
- [ ] `harness stats` after the above; confirm `restore_calls` and estimator drift are queryable.
