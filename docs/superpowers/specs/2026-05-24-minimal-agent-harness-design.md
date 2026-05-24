# Minimal Agent Harness — Design Spec

**Date:** 2026-05-24
**Status:** Approved (brainstorm) → ready for implementation plan

## 1. Goal

Build a minimal, extensible TypeScript agent harness with **profiles** that bundle model, tools, skills, MCP servers, working dir, and permissions. Two reference profiles ship in v1:

- **coding** — Read/Write/Edit/Bash/Grep/Glob, code-focused system prompt
- **data** — markdown artifact-heavy (plans, todos, insights, learnings), DB access exclusively via MCP

Harness must support skills (Claude-Code-style), MCP servers, a basic memory + improvement layer, and usage telemetry. Wrappers must be able to extend memory and improver via interfaces.

## 2. Non-Goals (v1)

- Multi-provider abstraction (we use OpenAI-compatible endpoints only — LiteLLM/Portkey/OpenAI/Ollama all route through one client).
- Built-in DB drivers (DB access is MCP-only so ACL stays in MCP layer).
- Web UI (server exposes WS; CLI is the only v1 client).
- Embeddings / vector memory (defer; interface must allow it later).

## 3. Stack

- **Lang:** TypeScript, Node ≥ 20
- **LLM client:** `openai` SDK pointed at configurable `baseURL`
- **Transport:** WebSocket server + thin CLI client
- **Tests:** vitest
- **Dev:** tsx, pnpm

## 4. Architecture

```
CLI (thin client) ──ws──▶ Harness Server
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   Profile Loader         Session Store          OpenAI Client
   (yaml)                 (json + artifacts)     (configurable baseURL)
                                │
                                ▼
                          Agent Loop
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   Tool Registry          Skill Registry           MCP Client(s)
   (builtin + ACL)        (md + frontmatter)       (DB, GitHub, etc.)
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
           Memory          Improver         Telemetry
           (fs default)    (reflect +       (jsonl)
                            mineSkills)
```

Single Node process. Stateful server hosts loop, tools, MCP clients. CLI streams events over WS.

## 5. Profile Schema

```yaml
# profiles/coding.yaml
name: coding
model:
  base_url: https://api.portkey.ai/v1
  api_key_env: PORTKEY_API_KEY
  id: claude-opus-4-7
  fallback_id: gpt-5
system_prompt: ./prompts/coding.md
working_dir: $CWD
artifact_dir: .harness/coding
skills_dirs:
  - ~/.harness/skills
  - ./.harness/skills
tools:
  builtin:
    Read:  allow
    Write: allow
    Edit:  allow
    Bash:  prompt        # ACL: allow | prompt | deny
    Grep:  allow
    Glob:  allow
    Skill: allow
    MemoryRead:  allow
    MemoryWrite: allow
    MemoryList:  allow
    Stats: allow
    Delegate: prompt
  mcp_servers:
    - name: github
      command: gh-mcp
      acl: { "*": prompt }
hooks:
  pre_tool: []
  post_tool: []
  on_stop: []
improvement:
  enabled: true
  model_id: gpt-5-mini
  mine_skills_every_n_sessions: 10
```

**Data profile differences:**
- `Edit`/`Write` scoped to artifact dir, code edits disallowed
- `Bash: deny`
- `artifact_dir: .harness/data` with subdirs `plans/`, `sql/`, `insights/`, `learnings/`
- DB MCP servers wired in (Postgres/BQ/Snowflake/DuckDB — config only)

## 6. Agent Loop

```
load profile + session
build system prompt:
  base_instructions
  + profile.system_prompt
  + skill_index (name + description for each skill)
  + tool_index
  + memory_section (MEMORY.md from profile memory)
on user message:
  append → messages
  loop:
    response = openai.chat(messages, tools, stream=true)
    if response has tool_calls:
      for call in tool_calls:
        resolve tool (builtin | mcp | skill)
        check ACL → allow | prompt user via WS | deny
        exec → tool_result
        log telemetry event
        append tool_result to messages
      continue loop
    else: # end_turn
      persist session
      await next user message
on session_end:
  improver.reflect(session, memory)
  if session_count % N == 0:
    improver.mineSkills(recent_sessions)
```

Cancellation: WS `cancel` aborts in-flight LLM call + kills running tool subprocess.

## 7. Skills

Claude-Code-style:

- Markdown file with YAML frontmatter (`name`, `description`)
- Discovered from `skills_dirs` at session start
- Index (name + description) injected into system prompt
- Model invokes via `Skill({name})` tool → harness reads full md and injects as user msg
- Project-local skills under `<working_dir>/.harness/skills/` override global

## 8. Tool Execution

Hybrid:

- **Builtin tools** run in-process as TS functions (Read, Write, Edit, Bash, Grep, Glob, Skill, Memory\*, Stats, Delegate)
- **MCP tools** run out-of-process via standard MCP client. Harness manages lifecycle.
- Per-tool ACL declared in profile: `allow | prompt | deny`. MCP servers can use wildcard `"*": prompt`.
- `Bash` always runs as subprocess; output captured + truncated.

## 9. Memory Layer

Two scopes:

- **session memory** — kv stored in `session.json`
- **profile memory** — markdown files in `<artifact_dir>/memory/`

Tools: `MemoryRead({scope, key})`, `MemoryWrite({scope, key, content})`, `MemoryList({scope})`.

On session start: `MEMORY.md` index from profile memory auto-injected into system prompt (Claude-Code-style).

Interface for wrappers to swap implementation:

```ts
interface MemoryProvider {
  read(scope: 'session' | 'profile', key: string): Promise<string | null>
  write(scope: 'session' | 'profile', key: string, content: string): Promise<void>
  list(scope: 'session' | 'profile'): Promise<MemoryEntry[]>
  buildSystemPromptSection(): Promise<string>
}
```

Default impl = filesystem + session.json.

## 10. Improvement Layer

Single `on_session_end` reflection hook. Feeds session transcript + current memory + recent telemetry to a small "improver" model. Outputs:

- new/updated memory files
- append to `<artifact_dir>/learnings/<date>.md`
- optional proposed skill file in `<skills_dir>/_proposed/` (user must move to active)

**Skill mining** (v1):

- Runs every N sessions (configurable per profile)
- Reads recent sessions + telemetry
- Detects repeated tool sequences / recurring task shapes
- Drafts skill md with frontmatter, steps, example invocation → `<skills_dir>/_proposed/`
- Inspectable markdown. User reviews + activates.

Interface:

```ts
interface Improver {
  reflect(session: Session, memory: MemoryProvider): Promise<void>
  mineSkills(sessions: Session[], telemetry: TelemetryEvent[]): Promise<ProposedSkill[]>
}
```

Default impl uses the configured improver model.

## 11. Telemetry

Append-only `~/.harness/telemetry.jsonl`:

```json
{"ts":"...","session":"abc123","profile":"coding","kind":"tool","name":"Edit","duration_ms":42,"ok":true,"tokens_in":120,"tokens_out":15,"cost_usd":0.0003}
{"ts":"...","kind":"skill","name":"test-driven-development","trigger":"model"}
{"ts":"...","kind":"mcp","server":"postgres","tool":"query","ok":true,"duration_ms":88}
{"ts":"...","kind":"llm","model":"claude-opus-4-7","tokens_in":2400,"tokens_out":180,"cost_usd":0.012}
```

Built-in `Stats` tool + CLI: `harness stats --profile coding --since 7d` → top tools, top skills, top MCP calls, cost breakdown, failure rates.

Improver consumes telemetry for smarter skill mining.

## 12. Sessions + Artifacts on Disk

```
~/.harness/
  profiles/
    coding.yaml
    data.yaml
  skills/                       # global skills
  sessions/
    2026-05-24_abc123.json      # messages, tool calls, costs, profile ref
  telemetry.jsonl

<working_dir>/.harness/
  <profile_name>/
    memory/
      MEMORY.md                 # index, auto-loaded
      <topic>.md                # individual memory files
    plans/
    todos/
    insights/
    learnings/
      2026-05-24.md             # appended by improver
    skills/                     # project-local skills
      _proposed/                # improver drafts
```

**session.json shape:**

```json
{
  "id": "abc123",
  "profile": "coding",
  "created_at": "2026-05-24T...",
  "messages": [],
  "tool_calls": [],
  "usage": { "input": 0, "output": 0, "cost_usd": 0 },
  "session_memory": {}
}
```

Sessions resumable by id.

## 13. Project Structure

```
src/
  server/       # ws server, session mgr
  cli/          # thin ws client
  loop/         # agent loop
  provider/     # openai-compatible client wrapper
  profiles/     # loader, schema, validation
  tools/
    builtin/    # Read, Write, Edit, Bash, Grep, Glob, Skill, Memory*, Stats, Delegate
    registry.ts
    acl.ts
  skills/       # loader, indexer, miner
  mcp/          # mcp client mgr
  memory/       # default fs impl + interface
  improver/     # reflect + mineSkills + interface
  telemetry/    # jsonl logger + query
  session/      # store, json shape
  hooks/        # pre/post tool, on_stop
  types.ts
profiles/       # example coding.yaml, data.yaml
prompts/        # example system prompts
tests/
```

## 14. Extension Points (for wrappers)

- `MemoryProvider` interface (swap fs for sqlite/vector/etc.)
- `Improver` interface (custom reflection / skill mining)
- Hooks (`pre_tool`, `post_tool`, `on_stop`) — shell commands or TS functions
- Custom builtin tools registered via plugin loader
- Custom MCP servers via profile config

## 15. Out-of-Scope / Deferred (v2 ideas)

- Inter-profile delegation as first-class (`Delegate` tool stub ships, full impl deferred)
- Triggers / watchers (cron, file, webhook → spawn session)
- Branch / replay sessions
- Cost-aware model downshifting per turn
- Web UI on top of WS server
