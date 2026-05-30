# Harness Roadmap

> Master feature list. Update this file as work is picked up or completed.
> Referenced by `CLAUDE.md` and `AGENTS.md` so all agents (Claude, Jules, etc.) stay aligned.

---

## Status key

| Symbol | Meaning |
|--------|---------|
| ✅ | Done and merged to main |
| 🔄 | In progress |
| ❌ | Not started |

---

## Features

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

### ❌ 5. Triggered + durable agents
Not all agents are interactive. Some wake on a schedule, run for hours, and resume after crashes.

**To build:**
- Cron triggers: `triggers.cron: "0 9 * * *"` in profile — agent wakes on schedule
- Webhook triggers: `triggers.webhook: true` — HTTP POST wakes agent with payload as input
- Durable runs: checkpoint session state to disk mid-run; resume after crash/restart
- Run lifecycle API: `GET /runs`, `GET /runs/:id/status`, `DELETE /runs/:id` (cancel)

**Why:** Unlocks monitoring agents, scheduled pipelines, autonomous workers — a whole class of agents impossible today.

---

### ❌ 6. A2A + ACP compatibility (optional / protocol layer)
Make the harness interoperable with the broader agent ecosystem. Both protocols are optional — no breaking changes to existing WS interface.

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

### ❌ 7. Comprehensive product documentation (GitHub Pages)

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

### ❌ 8. Pluggable code execution (WASM / Docker / E2B / Daytona)

Sandboxed code execution routed by profile config. WASM runs in the user's browser — zero server-side risk. Docker and cloud sandboxes handle heavy workloads and headless contexts.

**Architecture:**

New `ExecuteCode` builtin tool + new WebSocket message pair + optional `<HarnessPython />` React component for WASM clients.

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
- `<HarnessPython />` React component — boots Pyodide, listens for `code_execute`, returns `code_result`
- Client capability handshake: client signals `wasm_supported: true` in `hello` message so server knows which executor to use
- `executor:` block in `ProfileSchema`

**Why WASM-first:** Browser sandbox IS the isolation. Agent never executes code on server. User's data goes to their own tab, runs there, result comes back. No container spin-up, no cloud cost, no server-side attack surface for analyst workloads.

---

### ❌ 9. Instance modes (developer / analyst / assistant / production)

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

**To build:**
- `mode` field in `ProfileSchema` (enum: `developer | analyst | assistant | production`)
- Mode-to-ACL default map: each mode ships with pre-configured `tools.builtin` defaults
- `developer` mode logs a warning if `per_user_isolation: true` (destructive + multi-tenant = unsafe)
- Profile validation: `analyst` mode without `executor:` block warns that code execution falls back to Bash (defeats sandboxing)
- Documentation for each mode's trust model and intended deployment pattern (feeds into #7)

**Why:** Security model needs to be stated, not just implemented. Today a misconfigured profile can silently run Bash in a multi-tenant context. Mode makes the operator's intent explicit and validates it at startup.

---

## Suggested sequencing

```
#4 REST + typed I/O         ← enables #5 and #6 to share HTTP layer
#5 Triggered + durable      ← builds on #4's HTTP foundation
#6 A2A + ACP                ← builds on #4's HTTP layer; do after REST is solid
#7 Docs site                ← can run in parallel with any of the above
#8 Pluggable code execution  ← prerequisite for analyst mode (#9)
#9 Instance modes            ← builds on #8; do after ExecuteCode exists
```

---

## Completed but not on original list

- Rich Ink TUI: breathing orb, activity narrator, token-rate wave, tabbed right panel, multiline input
- MCP per-connection isolation
- Async hooks with timeout
- Context window tracking
- Parallel tool execution in agent loop
- Telemetry rotation + lazy reads
- Delegate tool (sub-agent spawning, foundation for #3)
