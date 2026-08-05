# Harness Roadmap

> Master feature list. Update this file as work is picked up or completed.
> Referenced by `CLAUDE.md` and `AGENTS.md` so all agents (Claude, Jules, etc.) stay aligned.
> **Why** things are built the way they are lives in [`docs/ADR.md`](ADR.md) — read it
> before changing an existing subsystem's shape.

---

## Status key

| Symbol | Meaning |
|--------|---------|
| ✅ | Done and merged to main |
| 🔄 | In progress |
| ❌ | Not started |

---

## Features

### ✅ 14. Go/Bubble Tea TUI revamp

The Go control surface is replacing the deleted legacy client. Current shipped
surface: streaming transcript, tool sections, approval modes and modals,
model switching with filtering/custom IDs, skills review/edit/promote/discard/
mine, context rail, cost/context gauges, queueing, autocomplete, local shell
and memory shortcuts, themes, motion, focus-aware notifications, reconnect
handling, cross-platform binaries, and scripted app-flow coverage.

### ✅ 1. Per-user isolation
Sessions, memory, and usage all scoped per user. A single server instance serves multiple users without cross-contamination.

**What shipped:**
- `src/session/user-paths.ts` — `sanitizeUserId`, `userPaths` helper
- `Session.user` field; `createSession(profile, user)`, `loadSession(user, id)`, `listSessions(user)`
- Two-tier memory: shared (`profile` scope) + private (`user` scope) with merged system prompt
- Per-user usage ledger at `~/.harness/usage/{user}.json` with month buckets
- `hello` WS message carries user identity from client; server re-initialises session on receipt
- Memory tools (`MemoryWrite`, `MemoryRead`, `MemoryDelete`, `MemoryList`) support `user` scope; `MemoryWrite` defaults to `user` (private)

---

### ✅ 2. Profile-defined custom tools + pluggable memory
Drop files into `.agents/tools/` and they're auto-registered. Swap the memory backend per profile.

**What shipped:**
- `src/tools/loader.ts` — dynamic tool loader, discovers `.agents/tools/**/*.{ts,js}` across 4 path levels
- `GraphMemoryProvider` — graph-native memory with nodes + typed relation links (`graph.json`)
- `FsMemoryProvider` enhanced — links stored in gray-matter frontmatter of `.md` files
- `MemoryLinked` tool — bidirectional graph traversal (forward + reverse, optional relation filter)
- Profile schema gains `provider: 'fs' | 'graph'` field

---

### ✅ 3. First-class multi-agent composition
**Priority: HIGH — biggest leverage multiplier.**

Any profile callable as a tool by another agent. Orchestrator spawns workers, collects results. Parallel fan-out.

**To build:**
- Agent-as-tool: expose a profile as a callable tool (input → run agent loop → return output)
- Named sub-agent registry in profile YAML: `agents: [{ name: researcher, profile: ./researcher.yaml }]`
- Parallel fan-out: spawn N sub-agents concurrently, gather results (map-reduce pattern)
- Typed contracts: sub-agent declares input/output schema; orchestrator validates

**Why first:** Complex agent = composition of simple ones. One harness, infinite agent types.

---

### ✅ 4. Programmatic agent contracts (REST + typed I/O)
Today the only interface is WS streaming chat. This makes the harness usable as a backend component.

**What shipped:**
- Shared `http.Server` hosts REST + WS on one port (7337)
- `POST /run` — one-shot `{ profile?, user?, input }` → `{ output, usage, session_id }`
- `POST /stream` — SSE: token / tool_start / tool_end / stats / result / error events
- `GET /health` — liveness + profile name + version
- Optional per-profile `contract: { input?, output? }` block; ajv hard-validation (422 on violation)
- Optional bearer auth via `HARNESS_API_KEY`; `user` body field scopes session/memory/usage
- Headless tool safety: REST runs auto-deny `prompt`-ACL tools (no interactive approver)
- `runProfileOnce()` shared one-shot helper; `src/shared/json-contract.ts` shared with `runner.ts`

**Why:** Turns harness from "chat tool" into a building block for apps and pipelines.

---

### ✅ 5. Triggered + durable agents
Not all agents are interactive. Some wake on a schedule, run for hours, and resume after crashes.

**To build:**
- Cron triggers: `triggers.cron: "0 9 * * *"` in profile — agent wakes on schedule
- Webhook triggers: `triggers.webhook: true` — HTTP POST wakes agent with payload as input
- Durable runs: checkpoint session state to disk mid-run; resume after crash/restart
- Run lifecycle API: `GET /runs`, `GET /runs/:id/status`, `DELETE /runs/:id` (cancel)

**Why:** Unlocks monitoring agents, scheduled pipelines, autonomous workers — a whole class of agents impossible today.

---

### ✅ 6. A2A + ACP compatibility (optional / protocol layer)
Make the harness interoperable with the broader agent ecosystem. Both protocols are optional — no breaking changes to existing WS interface.

### ✅ 6a. A2A server-side compatibility
**A2A (Google Agent-to-Agent protocol):**
- Expose `GET /.well-known/agent.json` Agent Card (name, description, capabilities, skills)
- Implement A2A task endpoint: `POST /a2a` receives tasks from other A2A agents
- A2A client tool: lets an agent call any external A2A-compatible agent as a tool
- Profile flag: `interop.a2a: true` to enable

**ACP (IBM/BeeAI Agent Communication Protocol):**
- Expose ACP-compliant REST endpoints: `/agents`, `/agents/:id/runs`, `/runs/:id/messages`
- ACP client tool: lets an agent call ACP agents
- Profile flag: `interop.acp: true` to enable

**Shared work:**
- Abstract `AgentCard` type describing a harness profile's public identity
- Common HTTP server layer shared by A2A, ACP, and the REST (#4) endpoints

**Why:** Lets harness agents participate in multi-vendor agent networks. Deployable alongside OpenAI Agents, Google ADK, CrewAI etc. without custom integration.

---

### ✅ 7. TUI uplift — richer power and animation

Evolve the Go/Bubble Tea TUI from functional to genuinely impressive: more visual density, smoother animation, and new power-user capabilities that make the terminal experience feel native and fast.

**To build:**
- **Live diff view** — when the agent writes/edits a file, render a side-by-side or inline diff panel in the TUI (syntax-highlighted, scrollable)
- **Tool timeline** — replace the flat tool log with a collapsible timeline: each tool call shows duration bar, status icon (✓ / ✗ / ⏳), and output preview on expand
- **Animated token stream** — smooth character-by-character typewriter rendering with configurable speed; cursor blink synced to streaming state
- **Memory panel** — live tab showing active memory keys (session + profile scope) updated in real time as agent writes
- **Session breadcrumb** — persistent header bar: profile name, user, session ID, elapsed time, live cost ticker
- **Keyboard power-ups** — `/` to open command palette (switch profile, clear session, export transcript); `Ctrl+T` to toggle tool timeline; `Ctrl+M` to toggle memory panel
- **Spinners and transitions** — replace static "thinking…" with per-tool spinners (braille unicode); smooth panel slide-in/out using Bubble Tea frame ticks

**What shipped:** Breathing orb, animated token stream, tool timeline with status icons, memory panel, session breadcrumb with live cost ticker, keyboard palette (`Ctrl+K`), per-tool spinners, tabbed workspace panel, multiline composer.

**Why:** The TUI is the primary dev interface. A richer experience reduces cognitive load and makes debugging agent behavior faster.

---

### ✅ 8. Web client (Next.js)

A first-class browser client for the harness — connects to the WS server, renders the agent conversation, and exposes the full tool/memory/session surface in a polished UI.

**Stack:** Next.js (App Router) · TypeScript · Tailwind CSS

**To build:**
- **Chat interface** — streaming message view; token-by-token rendering via WS `token` events; tool calls shown inline as collapsible cards
- **Tool approval UI** — when the agent hits a `prompt`-ACL tool, render an approval modal with the tool name, input preview, and Allow / Deny buttons; resolves the `tool_approve` / `tool_deny` WS messages
- **Profile selector** — sidebar dropdown to choose active profile; sends `hello` message on switch
- **Memory explorer** — read/write/delete memory entries from the browser; live-synced via `MemoryRead` / `MemoryWrite` tool calls
- **Session history** — list past sessions (from `GET /runs`); click to load transcript
- **Multi-user auth** — user identity set in profile settings; passed as `user_id` in `hello` message
- **Connection status** — banner showing WS connection state; auto-reconnect with exponential backoff
- **Responsive layout** — full-screen on desktop; mobile-friendly single-column on small screens

**What shipped:** Streaming chat UI, tool approval modal, hero screen, workspace panel with artifact widgets, session management, WS auto-reconnect, Tweaks panel (theme/palette/density), keyboard shortcuts (`Cmd+K` palette, `Cmd+L` clear, `Cmd+,` tweaks).

**Why:** Opens the harness to non-terminal users and makes it deployable as a product surface (internal tool, customer-facing assistant, etc.).

---

### ✅ 9. Agent input requests + todo tool

Agent can pause its loop and ask the user a question; agents get a built-in todo list with live display in both TUI and web.

**What shipped:**
- `AskUser` built-in tool — suspends loop, sends `input_request` ServerMessage, awaits `input_response`; supports `text`, `select`, `multi_select` kinds
- `TodoWrite` / `TodoRead` built-in tools — session-scoped todo list, broadcasts `todos` ServerMessage on every write
- Protocol: `input_request`, `input_response`, `todos` message types in `src/types.ts` + `web/lib/types.ts`
- TUI: `InputRequestModal` + `TodoPanel` components
- Web: `InputRequestModal` + `TodoPanel` components

**Why:** Agents that can ask clarifying questions and track their own tasks are dramatically more reliable for multi-step work.

---

### ✅ 10. Comprehensive product documentation (GitHub Pages)

Public-facing docs site hosted on GitHub Pages covering everything a developer needs to understand, configure, and extend the harness.

**To build:**
- Static site generator setup (VitePress recommended — zero-config, Markdown-native, fast)
- GitHub Actions workflow to build and deploy to `gh-pages` branch on every push to `main`
- Documentation sections:
  - **Getting started** — install, run, connect a client
  - **Profiles** — full YAML reference with annotated examples
  - **Built-in tools** — each tool documented (name, params, ACL default, example)
  - **Skills** — how skills are discovered, SKILL.md format, example
  - **Memory** — fs vs graph provider, scopes (session / profile / user), MemoryLinked
  - **MCP servers** — all 4 transports, ACL config, tool naming convention
  - **Multi-agent composition** — `agents:` block, typed contracts, DelegateFanout, depth
  - **Hooks** — pre_tool / post_tool / on_stop, env vars, timeout
  - **Self-improvement** — reflection loop, skill mining
  - **Telemetry** — JSONL schema, querying
  - **CLI & TUI** — startup flags, keyboard shortcuts

**Why:** Discoverability bottleneck. Everything is powerful but undocumented outside CLAUDE.md and code comments.

---

### ✅ 11. Pluggable code execution (WASM / Docker / E2B / Daytona)

Sandboxed code execution routed by profile config. WASM runs in the user's browser — zero server-side risk. Docker and cloud sandboxes handle heavy workloads and headless contexts.

**Architecture:**

New `ExecuteCode` builtin tool + new WebSocket message pair + optional browser `<HarnessPython />` component for WASM clients.

```
executor: wasm    → code_execute WS message → Pyodide in browser → code_result back
executor: docker  → containerised subprocess on server (read-only data mount)
executor: e2b     → E2B cloud API call
executor: daytona → Daytona cloud sandbox API call
```

**Profile config block:**
```yaml
executor:
  default: wasm             # used when client signals Pyodide support
  fallback: docker          # headless clients or unsupported WASM
  e2b_api_key_env: E2B_KEY  # required for executor: e2b
  docker_image: python:3.12-slim
  allowed_packages:         # pre-loaded into Pyodide on client boot
    - pandas
    - numpy
    - matplotlib
```

**To build:**
- New WS message types: `code_execute { id, code, data }` (server → client) and `code_result { id, output, error }` (client → server)
- `ExecuteCode` builtin tool — routes to executor backend, awaits result (mirrors `tool_prompt` approval pattern)
- Executor backends: WASM relay, Docker subprocess, E2B API client, Daytona API client
- `<HarnessPython />` browser component — boots Pyodide, listens for `code_execute`, returns `code_result`
- Client capability handshake: client signals `wasm_supported: true` in `hello` message so server knows which executor to use
- `executor:` block in `ProfileSchema`

**Why WASM-first:** Browser sandbox IS the isolation. Agent never executes code on server. User's data goes to their own tab, runs there, result comes back. No container spin-up, no cloud cost, no server-side attack surface for analyst workloads.

---

### ✅ 12. Instance modes (developer / analyst / assistant / production)

First-class `mode:` field on profiles that sets the trust model, default tool ACLs, and documentation for what kind of deployment this is. Operators know what they're running; users know what they're connecting to.

**Modes:**

| Mode | Analogy | Default tools | Multi-tenant safe? |
|------|---------|--------------|-------------------|
| `developer` | Claude Code, opencode | Bash, exec, full FS, MCP anything | No — single-tenant, operator owns the machine |
| `analyst` | Notebook AI | `ExecuteCode` (sandboxed), Memory, Read (data dir only) | Yes — code runs in sandbox, no shell |
| `assistant` | ChatGPT, Claude.ai | Memory, web search, no exec | Yes — no destructive capability |
| `production` | Customer-facing agent | Approved tool allowlist only | Yes — zero shell access |

**Profile usage:**
```yaml
mode: analyst   # sets defaults; individual tools.builtin overrides still apply
```

**What shipped:**
- `mode: developer | analyst | assistant | production` field in `ProfileSchema`
- `MODE_DEFAULTS` constant with per-mode ACL presets; mode wins on conflict with profile `tools.builtin`
- `applyModeDefaults()` — merges mode ACLs into profile at load time; production unlisted tools → `prompt`
- `validateMode()` — hard error for developer+triggers; soft warnings for developer, analyst-without-executor, production-without-contract

**Why:** Security model needs to be stated, not just implemented. Today a misconfigured profile can silently run Bash in a multi-tenant context. Mode makes the operator's intent explicit and validates it at startup.

---

### ✅ 13. Simplified deployment & usage

Make the harness trivial to run. Today a TUI session needs two terminals (server + TUI) and there is no container story.

**What shipped:** `pnpm tui` single-command launcher (auto-spawns server), backend `Dockerfile`, frontend `web/Dockerfile`, `docker-compose.yml` with bind-mounted persistence, `.env.example`, `docs/DEPLOYMENT.md`.

---

### ✅ 15. Adaptive workflow routing (stages · intensity · model tiers)

**Shipped.** Replace the flat single-model loop with a generic stage pipeline —
`recon → plan → design → build → verify → review` — where a cheap triage model
picks each stage's *intensity* (0–3) from evidence gathered in recon, a routing
policy picks each stage's *model tier* (cheap / balanced / frontier / critic) and
escalates only on observed failure, and telemetry records enough to answer
empirically which tier each kind of work actually needs.

Profile-agnostic by design: stages are abstract, and per-profile **playbooks**
(`.agents/playbooks/<name>/PLAYBOOK.md`, discovered like skills) bind each
(stage, intensity) to a concrete artifact contract — coding, research, data,
writing, security.

**What shipped:**
- `src/workflow/` — playbook loader, triage, policy/escalation, stage runner, artifacts, knowledge extraction, deferred labeler
- `src/analysis/` — stratified aggregation + `harness stats routing`
- Telemetry gains `task_id`/`stage`/`tier`/`intensity` tags and `stage`/`outcome` event kinds
- `models.roles` + `workflow` profile blocks; per-call model override in `src/loop/agent-loop.ts`
- Project knowledge graph written at stage close via the existing `project` memory scope + `GraphMemoryProvider`; enforced recon gate and review-time generalization probe
- TUI stage strip + per-stage cost

**Why:** model choice is currently a static guess in YAML with no feedback loop,
and no structure forces "understand before planning". Phase 0 ships
observability only — the dataset comes first, adaptivity after.

**Design:** [`docs/superpowers/specs/2026-08-01-adaptive-workflow-routing-design.md`](superpowers/specs/2026-08-01-adaptive-workflow-routing-design.md)
**Plan:** [`docs/superpowers/plans/2026-08-01-adaptive-workflow-routing.md`](superpowers/plans/2026-08-01-adaptive-workflow-routing.md)

### ✅ 16. Context projection

**Shipped:** append-only session ledger with a recomputed budgeted projection;
self-calibrating estimator; tiered tool-result elision with `ContextRestore`;
explicit Skill pins; whole-turn digest with project-memory fact promotion;
termination-safe turn dropping; non-destructive `/compact`; optional cache
breakpoints; and context telemetry.

**Cache result:** a live two-call probe against the Anthropic
OpenAI-compatible endpoint returned ordinary `prompt_tokens` but no
`cache_read_tokens` field. Cache markers ship behind `context.cache`, default
`false`; no caching win is claimed.

---

## Track: unattended & ambient agents (#17–#23)

Seven primitives that together let a profile run unattended, reach a human, ask
a question that outlives a process, act within bounds, and be audited afterward.
Motivated by the separate product plan ([plan](superpowers/plans/2026-08-02-personal-assistant-plan.md)),
but every item is profile-agnostic: **no vendor, no life-domain, and no product
vocabulary enters `src/`.** A boundary CI check (H0.1 in the plan) enforces this
mechanically and shipped before #17.

The product itself lives in a **separate repo**, consuming this harness as a
pinned dependency. Nothing below is specific to it.

---

### ✅ H0.1. Harness/product boundary guard

**What shipped:** `scripts/check-boundary.sh` scans executable source under
`src/`, ignores comments, rejects product/vendor vocabulary, and applies a
narrow reviewed allowlist for pre-existing generic protocol identifiers. The
guard runs in `.github/workflows/boundary.yml` on every push and pull request.

### ✅ 17. Channels — outbound + inbound transports

A named, pluggable, bidirectional transport between a profile and a human.
Closes the gap where triggered runs (#5) are write-only: they can spend tokens
but cannot report, ask, or be approved.

**What shipped:**
- `ChannelAdapter` interface, registry, and `.agents/channels/` loader
- Adapter-opaque `channels:` profile block with env-var-name secret references
- Conditional `Notify` builtin, persistent bindings, pairing, and fail-closed routing
- Channel approvals and input requests for unattended runs
- Capability degradation, chunking, rate limits, and correlation routing
- Core `stdout` and `webhook` reference adapters; no vendor adapters in core

**Design:** [`channels-design.md`](superpowers/specs/2026-08-02-channels-design.md)

**Shipped:** Opaque adapter API, builtin/custom registry and loader, capability
degradation, persistent bindings with paired/open/off routing, fail-closed
unbound inbound handling, correlation-based channel approvals, webhook ingress,
stdout/webhook reference adapters, and conditional `Notify` registration.

---

### 🔄 18. Deferred asks — durable human-in-loop

**In progress on `feat/17-channels`:** durable pending records, `waiting_input`
run state, park/resume across REST, channels, and WebSocket, TTL expiry
sentinels, cancellation, and unattended approval reuse are implemented. Final
client inbox rendering and end-to-end restart acceptance remain before marking
this item shipped.

`AskUser` awaits an in-memory promise held by a live connection, so an
unattended run cannot ask, and a restart destroys the question. Makes a question
a durable object: parked to disk, delivered over a channel, answerable hours
later, resumable across restarts.

**To build:**
- Pending-input store + TTL sweeper; new run status `waiting_input`
- `AskUser` gains `defer` / `ttl` / `channel`; non-deferred path byte-identical
- `ParkSignal` + checkpoint/resume; same run id, append-only ledger
- `GET /pending`, `POST /runs/:id/input`, `DELETE /pending/:id` + WS equivalents
- Unattended `tool_prompt` becomes a pending record — one mechanism, two entry points

**Design:** [`deferred-asks-design.md`](superpowers/specs/2026-08-02-deferred-asks-design.md)

---

### ❌ 19. Temporal memory

Every memory fact is currently implicitly eternal and implicitly current, which
produces confidently stale answers. Adds validity intervals, bounded recurrence,
entity grouping, and supersession-instead-of-overwrite.

**To build:**
- Optional `valid_from` / `valid_until` / `recur` / `entity` / `confidence` frontmatter
- `Recall` tool: query by instant, window, entity, relation; filter → collapse → rank
- Bounded RRULE subset in-tree (no dependency); DST, month-end, leap-day tests
- Supersession collapse — current view deduplicated, history still queryable at a past instant
- Projection integration: expired facts evict first, imminent facts pin

**Design:** [`temporal-memory-design.md`](superpowers/specs/2026-08-02-temporal-memory-design.md)

---

### ❌ 20. Watch & poll triggers

Generalizes `triggers` beyond a clock. The critical property is that the
no-change path is **free**: a poll's cursor probe runs one tool call and no model
call, turning ~288 wasted turns/day per watched source into a handful of real runs.

**To build:**
- `triggers.watch` (chokidar + debounce + batch cap + ignore) and `triggers.poll` (interval + probe + persisted cursor)
- Write-suppression window so a run writing into its own watched path cannot self-trigger
- Overlap policy (`skip` default) + global concurrency cap
- `CronScheduler` → `TriggerManager`; **existing cron tests must pass untouched**
- Telemetry `skip_reason` — the operational health signal for ambient agents

**Design:** [`watch-poll-triggers-design.md`](superpowers/specs/2026-08-02-watch-poll-triggers-design.md)

---

### ❌ 21. Autonomy budget & conditional ACL

ACL cannot currently express "allow when the arguments look like this, ask
otherwise", so unattended profiles must choose between over-permission and
constant interruption. Triggered runs also have no spend ceiling and leave no
record of *why* an action was permitted.

**To build:**
- `triggers.budget` (cost / tool count / wall time), fail-closed, checked before every model and tool call; delegated children inherit a share, not a fresh allowance
- Object ACL form with `allow_if` / `deny_if` over a **closed, data-only predicate set** (`equals`, `in_list`, `matches`, `under_path`, `lt`/`gt`, `absent`/`present`) — no code evaluation, unknown predicate fails the load
- `lists:` in profile or sourced from memory; read failure denies
- Append-only audit journal recording `decided_by` + `decided_reason` per effectful call
- `harness audit [--undo]`; core inverses for `Write` / `MemoryWrite` / `MemoryDelete`

**Design:** [`autonomy-budget-acl-design.md`](superpowers/specs/2026-08-02-autonomy-budget-acl-design.md)

---

### ❌ 22. Provenance gating

**The security keystone of this track.** Once an agent reads content other people
wrote, its context contains instructions from strangers that are
token-indistinguishable from the user's. Prompt-level defenses are probabilistic;
this closes the path structurally.

Claim is deliberately narrow: *content the agent read can never silently
authorize an action.* The model may still be fooled — the gate holds anyway.

**To build:**
- `provenance` on tool results; **untrusted by default** for anything network-sourced
- Monotonic per-turn taint stored on the ledger (not derived — projection would silently un-taint it); resets only on a genuine human message
- `safety.gate_untrusted_actions`: in a tainted turn, `outbound`/`destructive` tools escalate to approval regardless of ACL, quoting the tainting source
- Predicates (#21) and `yolo` cannot bypass the gate
- Laundering closures: memory, delegation, and file round-trips
- Permanent red-team corpus in CI that grows and never shrinks

Default `false` in the harness; `true` under `mode: assistant` / `production`.

**Design:** [`provenance-gating-design.md`](superpowers/specs/2026-08-02-provenance-gating-design.md)

---

### ❌ 23. Multi-profile server & audio transport

One process serves one profile today, so a multi-agent deployment means N ports
and N MCP subprocess sets with no shared session view. Separately, the protocol
is text-only. Both are harness-shaped gaps; neither needs a vendor in core.

**To build:**
- Profile-directory loading; routing via `hello.profile`, `?profile=`, trigger owner, or channel binding; `set_profile` message
- Shared server/telemetry/`user` memory; isolated sessions, `profile` memory, MCP sets, tool views, budgets
- Lazy MCP connect + idle close + **global** concurrency cap
- Binary `audio_chunk` / `audio_out_chunk` / `transcript_partial` frames, gated on `hello.audio_supported`
- Streaming `SpeechToText` / `TextToSpeech` **interfaces only** — providers load from `.agents/voice/`; core gains no audio dependency
- Sentence-level TTS chunking; barge-in cancels synthesis, playback, *and* the in-flight LLM turn, appending an interrupted-marked partial
- `system_prompt_voice` selected by channel capability

**Design:** [`multi-profile-audio-design.md`](superpowers/specs/2026-08-02-multi-profile-audio-design.md)

---

## Suggested sequencing

```
✅ #4 REST + typed I/O
✅ #5 Triggered + durable
✅ #6 A2A + ACP
✅ #7 TUI uplift
✅ #8 Web client (Next.js)
✅ #9 Agent input + todos
✅ #10 Docs site
✅ #11 Pluggable code execution
✅ #12 Instance modes
✅ #13 Simplified deployment
✅ #15 Adaptive workflow routing
✅ #16 Context projection
```

Unattended track — **boundary guard shipped; next up is #17**:

```
✅ H0.1 boundary guard   (CI scan: no vendor/product vocabulary in src/)
  ↓
#17 channels ─────────────┐
  ↓                       │
#18 deferred asks         │  first three unlock proactive agents
#19 temporal memory       │
#20 watch/poll triggers ──┘
  ↓
#21 budget + conditional ACL ──┐
#22 provenance gating ─────────┘  must land together — #21 without #22
  ↓                               widens autonomy with no injection defense
#23 multi-profile + audio
```

**#21 and #22 ship as a pair.** #21 makes unattended action easier; #22 is what
keeps that safe when the agent is reading other people's content. Shipping the
first without the second is the one ordering mistake in this track that produces
a genuinely dangerous build.

---

## Completed but not on original list

- Rich Go TUI: activity timeline, token-rate sparkline, tabbed right panel, multiline input
- MCP per-connection isolation
- Async hooks with timeout
- Context window tracking
- Parallel tool execution in agent loop
- Telemetry rotation + lazy reads
- Delegate tool (sub-agent spawning, foundation for #3)
