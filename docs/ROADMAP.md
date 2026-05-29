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

### 🔄 3. First-class multi-agent composition
**Priority: HIGH — biggest leverage multiplier.**

Any profile callable as a tool by another agent. Orchestrator spawns workers, collects results. Parallel fan-out.

**To build:**
- Agent-as-tool: expose a profile as a callable tool (input → run agent loop → return output)
- Named sub-agent registry in profile YAML: `agents: [{ name: researcher, profile: ./researcher.yaml }]`
- Parallel fan-out: spawn N sub-agents concurrently, gather results (map-reduce pattern)
- Typed contracts: sub-agent declares input/output schema; orchestrator validates

**Why first:** Complex agent = composition of simple ones. One harness, infinite agent types.

---

### ❌ 4. Programmatic agent contracts (REST + typed I/O)
Today the only interface is WS streaming chat. This makes the harness usable as a backend component.

**To build:**
- Typed input/output schema per profile (Zod/JSON schema in YAML)
- One-shot `POST /run` HTTP endpoint: `{ profile, input }` → `{ output, usage }` (no WS)
- Streaming `POST /stream` SSE endpoint for callers that want token streaming without WS
- Profile-level output shape definition (structured JSON vs freeform text)

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

## Suggested sequencing

```
#3 Multi-agent composition  ← next, highest leverage
#4 REST + typed I/O         ← enables #5 and #6 to share HTTP layer
#5 Triggered + durable      ← builds on #4's HTTP foundation
#6 A2A + ACP                ← builds on #4's HTTP layer; do after REST is solid
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
