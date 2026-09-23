# Harness Roadmap

> Master feature list. Update this file as work is picked up or completed.
> Current implementation, acceptance, component state, and task tracking: **[`PRODUCT_STATE.md`](PRODUCT_STATE.md)**.
> Seven primary product areas and stable feature IDs: **[`FEATURES.md`](FEATURES.md)**. The new Multi Agent Orchestrator is a separate discovery track, not the already-implemented delegation feature #3.
> This roadmap retains feature scope and sequencing. Historical gap descriptions below may predate implementation; check the tracker before selecting work. Update both documents when a feature's status or scope changes.
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

### ✅ 18. Deferred asks — durable human-in-loop

**What shipped:**
- Durable pending records, `waiting_input` run state, park/resume across REST,
  channels, and WebSocket, TTL expiry sentinels, cancellation, and unattended
  approval reuse
- Go TUI inbox with pending-question list, text/select/multi-select answers,
  option validation, `/inbox`, and `pending`/`pending_list`/`pending_answer`
  protocol support
- End-to-end restart acceptance coverage for answered and expired questions,
  including append-only session-ledger verification

`AskUser` awaits an in-memory promise held by a live connection, so an
unattended run cannot ask, and a restart destroys the question. Makes a question
a durable object: parked to disk, delivered over a channel, answerable hours
later, resumable across restarts.

**Design:** [`deferred-asks-design.md`](superpowers/specs/2026-08-02-deferred-asks-design.md)

---

### ✅ 19. Temporal memory

Every memory fact is currently implicitly eternal and implicitly current, which
produces confidently stale answers. Adds validity intervals, bounded recurrence,
entity grouping, and supersession-instead-of-overwrite.

**What shipped:**
- Shared temporal parsing, validation, ISO-offset frontmatter round-trip, legacy compatibility, and FS/Graph provider conformance
- `Recall` instant/window/entity/relation/text filtering with supersession history, specificity/recency/confidence/lexical ranking, and imminent-memory prefix pinning
- Bounded in-tree RRULE subset with interval, weekday, ordinal weekday, month-day, UNTIL, COUNT, DST, month-end, and leap-day coverage
- Improver and workflow knowledge producers accept explicit temporal metadata without domain-specific date parsing

**Design:** [`temporal-memory-design.md`](superpowers/specs/2026-08-02-temporal-memory-design.md)

---

### ✅ 20. Watch & poll triggers

Generalizes `triggers` beyond a clock. The critical property is that the
no-change path is **free**: a poll's cursor probe runs one tool call and no model
call, turning ~288 wasted turns/day per watched source into a handful of real runs.

**What shipped:**
- Unified cron/watch/poll lifecycle with contract-validated inputs, per-trigger
  overlap modes, queue depth one, and global concurrency protection
- Chokidar watch debounce/coalescing, batch caps, default/profile ignores, and
  harness-write suppression to prevent self-trigger storms
- Deterministic poll probes with no model path, JSONPath-lite cursors, cold-start
  recording, corruption-safe persistence, jitter, and exponential error backoff
- Source-tagged fire/skip telemetry plus budget-hook integration; legacy cron
  import path and untouched cron tests remain compatible

**Design:** [`watch-poll-triggers-design.md`](superpowers/specs/2026-08-02-watch-poll-triggers-design.md)

---

### ✅ 21. Autonomy budget & conditional ACL

ACL cannot currently express "allow when the arguments look like this, ask
otherwise", so unattended profiles must choose between over-permission and
constant interruption. Triggered runs also have no spend ceiling and leave no
record of *why* an action was permitted.

**What shipped:**
- Fail-closed per-run cost, tool-count, and wall-time budgets with model/tool
  checkpoints, delegated ledger inheritance, budget-exceeded run status, audit,
  and channel notification
- Conditional ACLs with closed predicates, profile and memory-backed lists,
  short-cache resolution, symlink-safe path containment, and deny-unbeatable
  composition across approval modes
- Complete effectful-call JSONL audit records with decision provenance/reason,
  redacted bounded input digests, `harness audit --since/--tool`, and best-effort
  core undo for file and memory writes/deletes

**Design:** [`autonomy-budget-acl-design.md`](superpowers/specs/2026-08-02-autonomy-budget-acl-design.md)

---

### ✅ 22. Provenance gating

**What shipped:** typed provenance, monotonic taint, untrusted inbound-channel
handling, action gates, audit attribution, core undo, exact-only provenance
overrides, and a permanent red-team corpus covering direct and laundering paths.

**The security keystone of this track.** Once an agent reads content other people
wrote, its context contains instructions from strangers that are
token-indistinguishable from the user's. Prompt-level defenses are probabilistic;
this closes the path structurally.

Claim is deliberately narrow: *content the agent read can never silently
authorize an action.* The model may still be fooled — the gate holds anyway.

**Safety contract:**
- `provenance` on tool results; **untrusted by default** for anything network-sourced
- Monotonic per-turn taint stored on the ledger (not derived — projection would silently un-taint it); resets only on a genuine human message
- `safety.gate_untrusted_actions`: in a tainted turn, `outbound`/`destructive` tools escalate to approval regardless of ACL, quoting the tainting source
- Predicates (#21) and `yolo` cannot bypass the gate
- Laundering closures: memory, delegation, and file round-trips
- Permanent red-team corpus in CI that grows and never shrinks

Default `false` in the harness; `true` under `mode: assistant` / `production`.

**Design:** [`provenance-gating-design.md`](superpowers/specs/2026-08-02-provenance-gating-design.md)

---

### 🔄 23. Multi-profile server & audio transport

**In progress on `feat/17-channels`:** profile directories, per-entry routing
and isolation, lazy/idle MCP clients, pooled provider clients, voice plugin
interfaces, binary audio transport, endpointing, voice prompts, sentence TTS,
and interrupted-ledger handling are implemented. Full multi-profile server
acceptance and main-branch merge remain.

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

### ✅ 24. TUI/runtime parity

The TUI/runtime parity surface shipped, then received a correctness and security
hardening pass covering effect-derived ACLs, workflow-stage propagation, plan
approval routing, undo staleness, and unified slash invocables.

**Design:** [`tui-parity-plan.md`](superpowers/specs/2026-08-14-tui-parity-plan.md) ·
[`tui-parity-fixes-plan.md`](superpowers/specs/2026-08-15-tui-parity-fixes-plan.md)

---

## Track: web surface (#25–#29)

The backend grew twenty-seven subsystems; the web client still speaks the protocol
of #8. Five items turn it into the control plane, with three faces — **analyst**,
**operator**, **assistant** — over one runtime, one token system, one component kit.

Posture is **single operator, localhost**. No login, no multi-tenancy — which makes
the transport the only boundary, so #25 makes that boundary real before anything is
built on it.

**Master design:** [`web-surface-design.md`](superpowers/specs/2026-08-16-web-surface-design.md)
**Plan (all phases):** [`web-surface.md`](superpowers/plans/2026-08-16-web-surface.md)

Measured gap at time of writing:

| Evidence | Location |
|---|---|
| Nine artifact widgets are stubs returning `<div>BarChart Widget</div>` | `web/widgets/GenWidget.tsx:4-12` |
| 17 of 35 `ServerMessage` variants dropped by the reducer | `web/components/HarnessApp.tsx:90-157` |
| `cost_usd` / `context_tokens` / `context_window` arrive and are discarded | `web/components/HarnessApp.tsx:127` |
| `ui_render` surfaces produced by the runtime, never mounted | `src/tools/builtin/render-ui.ts:81` |
| `user_id` hardcoded; `yolo` asserted by the browser | `web/hooks/useHarnessWS.ts:27-30` |
| No `Origin` validation on WS upgrade | `src/server/index.ts` (absent) |
| Telemetry / usage / audit / routing stats have no HTTP surface | `src/telemetry/`, `src/usage/`, `src/audit/`, `src/analysis/` |

---

### ✅ 25. Transport hardening & read APIs

**Ships first, and is worth shipping even if nothing else in this track does** —
the exposure exists whether or not the web client is used.

WebSocket upgrades are exempt from same-origin policy and the server checks no
`Origin`. Any page the operator visits can open `ws://localhost:7337`, send
`hello { yolo: true }`, and drive a `developer`-mode profile with `Bash`, with no
approval prompt because the browser asserts its own bypass.

**To build:**
- `src/server/origin.ts` — exact-match allowlist (`HARNESS_ALLOWED_ORIGINS`), applied to the WS upgrade and to REST before route matching; explicit browserless branch for TUI/CLI
- `hello.yolo` ignored; approval mode resolves server-side as `profile ⊓ env ⊓ mode ceiling`, and `set_approval_mode` is clamped to that ceiling
- Read-only HTTP layer: `GET /metrics`, `/usage`, `/audit`, `/memory`, `/triggers`, `/sessions/:id/messages`, `/stats/routing` — thin wrappers over `queryEvents`, `readUsage`, `listAudit`, `MemoryProvider`, and `aggregateRouting`
- `src/telemetry/aggregate.ts` — pure aggregation for `/metrics`
- `src/datasets/` + `POST /datasets` — the only new write endpoint in the track; server-generated ids, fixed root, extension allowlist, size cap, provenance-`untrusted`

**Why:** every dashboard below reads state that exists on disk and has no HTTP
surface. And a localhost-only posture is only a posture if the transport holds.

**Design:** [`web-read-api-design.md`](superpowers/specs/2026-08-16-web-read-api-design.md)

---

### ✅ 26. Web protocol parity

**To build:**
- `web/lib/protocol.ts` generated from `src/types.ts` with a CI freshness check — the hand-copied duplicate in `web/lib/types.ts` is the root cause of the drift
- Exhaustive reducer: every variant handled or explicitly ignored with a reason; `never`-checked default so a new variant breaks the build
- State keyed by `run_id` — concurrent runs currently interleave into one transcript
- Surfaces for `stage`, `plan`, `notice`, `models`, `approval_mode_changed`, `skills`, `commands`, `pending`, `undo_entries`
- Context gauge, live cost ticker, stage strip, toast stack, model switcher, cancel, compact
- Design tokens v2: chart series ramp, sequential/diverging ramps, status colours, density steps — both themes, test-enforced
- Transcript rehydration on reload via `GET /sessions/:id/messages`

**Why:** the reducer's silent `default:` branch is what let seventeen messages go
unnoticed. Generating the types makes the gap a build failure instead of a
discovery.

---

### ❌ 27. Generative surfaces & widget kit

Two rendering paths, kept on purpose: the **fixed kit** for anything that must be
themed, exported, and pinned; the **generative surface** for bespoke UI no kind
covers. Surfaces are the escape hatch, not the default — a surface cannot be
re-themed, exported to CSV, or diffed.

**To build:**
- `SurfaceHost` — opaque-origin sandboxed iframe (`allow-scripts` without `allow-same-origin`), strict CSP, `connect-src 'none'`, allowlisted `postMessage` bridge, `ui_result` diagnostics back to the agent, 10s render timeout, permanent escape-attempt corpus
- `Plot` shell + eight marks: `metrics`, `bar`, `line`, `area`, `scatter`, `histogram`, `heatmap`, `box`, plus `correlation`, `table`, `diff`, `filetree`, `terminal`, `doc`
- Honesty rules in the kit: zero baseline unless explicitly opted out (which draws an axis-break marker), `null` as gap never zero, stable series colours, >8 series collapse
- `DataTable` — sort, filter, pin, virtualization, CSV export of the filtered view
- Notebook cells: `ExecutionResult.files` rendered inline (images) or as download chips — **matplotlib output is currently invisible**
- Pyodide fixes: pass `executor.allowed_packages` (hardcoded `[]` today at `HarnessApp.tsx:375`), lazy boot with progress, worker thread

**Why:** `mode: analyst` shipped its runtime half and none of its surface half.

**Design:** [`analyst-workbench-design.md`](superpowers/specs/2026-08-16-analyst-workbench-design.md)

---

### ❌ 28. Analyst workbench

**To build:**
- Dataset drawer — upload, schema card (dtype, null %, distinct, mini distribution per column), preview grid, context injection into the next message, untrusted-provenance badge
- Canvas — pin any artifact with its provenance (session, tool call, generating code); reorder, resize, refresh in place; a failed refresh keeps the last good render and badges staleness
- Export — table→CSV (formula-injection safe), canvas→PNG/PDF, session→self-contained HTML bundle
- Three-pane desktop-first layout; workspace tabs become Artifacts · Surfaces · Canvas

**Why:** an analyst agent that cannot receive a CSV, show a chart, or hand back a
file is a chat window.

**Design:** [`analyst-workbench-design.md`](superpowers/specs/2026-08-16-analyst-workbench-design.md)

---

### ❌ 29. Operator console & assistant surface

2026-09-12 checkpoint: PT-008 typed deferred answers and live snapshot refresh implemented and locally validated (tracker E-020). PT-044 now provides bounded same-process approval recovery and Web acceptance (E-021); PT-007 retained state/ACK work still needs TUI recovery-control acceptance. Overall #29 remains partial; major layout/assistant work and broader acceptance are open.

Everything #17–#23 built is invisible in a browser. Two faces close that.

**To build (operator, `/ops`):**
- Run board with lanes, live overlay, and `waiting_input` visually distinct from `running`
- Approval centre — `risk`/`reason` displayed including the provenance gate's quoted tainting source, per-tool argument previews, an approval *queue* (unattended runs stack them), and "always allow" that reports what the server actually granted ✅ ([#29 closeout G2](superpowers/plans/2026-08-22-web-surface-closeout.md#sprint-2-always-allow-for-the-approval-queue))
- Deferred-ask inbox with TTL countdown; undo drawer grouped by run with staleness and explicit `force`
- Audit table with a first-class `tainted` filter — the review workflow #22 was built for and has had no interface
- Observability: cost/day by profile, tool volume with ok-rate and p95, model mix, stage funnel, routing efficacy from `aggregateRouting`
- Budget meter per run; budget-exceeded as its own terminal state, not a generic failure ✅ ([#29 closeout G3](superpowers/plans/2026-08-22-web-surface-closeout.md#sprint-3-budget-exceeded-live-wiring))

**To build (assistant, `/home`):**
- Brief cards: needs-you, overnight, next fires, spend, expiring beliefs, tainted-turn attention
- Memory explorer with a temporal timeline — supersession as one belief replacing another, open intervals as ongoing arrows, never invented end dates; edits route through `MemoryWrite` so ACL/provenance/audit apply
- Trigger console showing the fire/skip ratio — #20's central claim (the no-change path is free) is invisible anywhere else
- Skills review queue and channels view over the existing protocol messages

**Why:** the ops charts are the widget kit's first internal consumer. If the kit
cannot draw the harness's own metrics, it is not ready for the analyst.

**Design:** [`operator-assistant-console-design.md`](superpowers/specs/2026-08-16-operator-assistant-console-design.md)

---

### ✅ 30. Guided install & first-run onboarding

Installing now reaches first run on macOS, Linux, and Windows. The onboarding
flow persists a selected profile pointer, contained credentials, and a
validated provider setup before the first message.

**What shipped:**
- `~/.harness/config.json` + `resolveDefaultProfile()` pointer; profile-directory fallback and `--default-profile`
- `loadUserEnv()` + `~/.harness/env` mode `0600`; ambient `process.env` wins
- `harness doctor` with human/JSON output, offline mode, and non-zero failures
- `harness init` with derived use-case menu, provider/model choices, masked key input, diff guard, backups, and doctor handoff
- TTY-only `install.sh` and PowerShell installer handoff; piped installs stay non-interactive
- Go TUI delegates onboarding to Node and re-reads the selected profile
- Windows server, CLI, and TUI build targets plus release assets

**Why:** the multi-profile-with-one-default mechanism remains a reversible
pointer, not a pruning operation: all nine profiles stay installed and
switchable.

**Design:** [`guided-install-onboarding-design.md`](superpowers/specs/2026-08-23-guided-install-onboarding-design.md)
**Plan:** [`2026-08-23-guided-install-onboarding.md`](superpowers/plans/2026-08-23-guided-install-onboarding.md)

---

### 🔄 31. Request routing graph (Jev fan-out · policy · edge checks)

**In progress — phases 1–5 done (PT-076–PT-080: routing, enforce, edge checks, claim-check); next PT-081 learning loop, then PT-082 live acceptance.** Route each workflow request by typed Jev
judgments instead of a profile-fixed playbook: a parallel fan-out (domain Noul
per playbook, scale Score, existing-work, ambiguity, follow-up) feeds a pure
policy function that picks playbook(s), an intensity floor, or a single
clarifying question. Jev then judges each stage edge (continue / promote /
re-route / stuck / done), a claim-check gates delivery, and telemetry tunes
thresholds and proposes new playbooks.

Built on the #15 runner, not a new engine: Jev judges edges, LLMs work at nodes,
policy stays in code. Recon gate, default parity, and Jev-failure fallback are
invariants. Shadow before enforce at every phase.

**Phases:** PT-076 groundwork · PT-077 fan-out + policy (shadow) · PT-078 enforce
route + ask-user + session route + multi-domain · PT-079 edge checks + re-route ·
PT-080 claim-check · PT-081 learning loop · PT-082 live acceptance.

**Spec:** [`2026-09-23-request-routing-graph-spec.md`](superpowers/specs/2026-09-23-request-routing-graph-spec.md)

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
✅ #21 budget + conditional ACL ──┐
✅ #22 provenance gating ─────────┘  shipped together — #21 without #22
  ↓                               widens autonomy with no injection defense
#23 multi-profile + audio
```

**#21 and #22 ship as a pair.** #21 makes unattended action easier; #22 is what
keeps that safe when the agent is reading other people's content. Shipping the
first without the second is the one ordering mistake in this track that produces
a genuinely dangerous build.

Web surface track — **next up is #27**:

```
#25 transport hardening + read APIs   ✅
  ↓
#26 protocol parity            ✅
  ↓                           │  #26 and #27 are the floor for the three faces
#27 surfaces + widget kit ────┘
  ↓
#28 analyst workbench      #29 operator console + assistant surface
```

Onboarding track — **independent of the web surface track, start any time**:

```
#30 guided install & first-run onboarding
```

**#30 does not queue behind #27–#29.** It touches the CLI, the installer, and
profile resolution — none of which the web surface work owns — and it is the
only item that changes whether a brand-new install can send a first message
at all.

**#25 is not optional and does not wait for the UI.** The cross-site WebSocket
hole and the browser-asserted `yolo` flag are exploitable today, independent of
whether anyone opens the web client. Everything after it is additive product work.

---

## Completed but not on original list

- Rich Go TUI: activity timeline, token-rate sparkline, tabbed right panel, multiline input
- MCP per-connection isolation
- Async hooks with timeout
- Context window tracking
- Parallel tool execution in agent loop
- Telemetry rotation + lazy reads
- Delegate tool (sub-agent spawning, foundation for #3)

## Explicitly requested integration track — Codex subscription

🔄 Codex OAuth alongside API-key defaults. Local implementation and automated regression validation passed; live account/client compatibility, subscription attribution, and Windows acceptance pending. No Claude subscription scope. See [design](superpowers/specs/2026-09-05-codex-subscription-design.md), [plan](superpowers/plans/2026-09-05-codex-subscription-plan.md), and [operator guide](CODEX_AUTH.md).

## Explicitly requested plan — Model-aware effort selection

🔄 Core backend slice implemented; full UI/setup picker, live provider and
transport acceptance remain open. Draft spec and phased plan cover
capability-aware model/effort selection, shared setup/runtime discovery,
acknowledged preferences, and transport-specific validation. See
[spec](superpowers/specs/2026-09-06-model-effort-selection-spec.md) and
[plan](superpowers/plans/2026-09-06-model-effort-selection-plan.md).

## Explicitly requested product area — Multi Agent Orchestrator

🚧 PT-052 implementation in progress. Scope:
multiple Base agents on the same or different projects, task assignment and
agent-to-agent collaboration, direct user interaction, optional orchestrator
agent, and a game-like live world reflecting actual runtime activity.

Existing #3 delegation and Studio/live-session foundations are candidates for
reuse, not completion evidence for this experience. [PT-020 town discovery](superpowers/specs/2026-09-13-orchestrator-town-discovery.md)
captures the landscape, project buildings and central board. User confirmed a navigable
simulated 3D medieval town with orbit/pan/tilt/zoom and town/building viewing interactions;
a single fixed isometric view is rejected and roof-off interiors remain optional.
Orchestrator assignment/start and provider remaining subscription/API quota
as the dispatch gate are confirmed. Detailed layout/rendering,
team lifetime, workspace/merge policy, quota freshness/reservation/limits and product
placement are now frozen in the [PT-052 build specification](superpowers/specs/2026-09-13-orchestrator-town-spec.md). PT-052 implementation, bounded provider-bridge compatibility and live runtime/browser evidence are recorded; user landscape acceptance remains PT-053 and headless queue wake/account-specific catalog reconciliation remain PT-054. No release or deployment follows this evidence. See [ORCH features](FEATURES.md#7-multi-agent-orchestrator--collaborative-agent-workspace) and [task tracker](PRODUCT_STATE.md).

## Active implementation track — Core uplift

✅ Core local implementation and corrective acceptance complete through PT-030/PT-037
on 2026-09-11. Corrective changes included in delivery PT-038; see E-018 in tracker.
Order: scope → recovery → human decisions → provider/effort → lifecycle/history/platform
→ prompt/execution/telemetry cleanup → existing orchestration contract groundwork.

[Spec](superpowers/specs/2026-09-07-core-uplift-spec.md) ·
[Plan](superpowers/plans/2026-09-07-core-uplift-plan.md) ·
[State/tasks PT-023–PT-030](PRODUCT_STATE.md).
Handwritten client/UI changes excluded; generated contracts and compatibility
checks allowed. This does not complete client recovery, effort pickers, live
provider/platform acceptance, or the proposed Orchestrator product.
