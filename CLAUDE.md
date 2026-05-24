# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev (no compile step needed)
pnpm dev                        # start WebSocket server (default profile)
pnpm dev:tui                    # start Ink TUI
pnpm dev:cli                    # start readline CLI client

# Build
pnpm build                      # tsc → dist/
pnpm typecheck                  # type-check without emitting

# Test
pnpm test                       # vitest run (all)
pnpm test:watch                 # vitest watch
npx vitest run tests/agent-loop.test.ts   # single test file
```

All entry points are in `dist/` after build; binary aliases are `harness`, `harness-server`, `harness-tui`.

## Architecture

This is a **generic agent harness** — a thin WebSocket-based runtime that wires an LLM to tools, skills, memory, MCP servers, and hooks. Everything is profile-driven (YAML).

### Runtime flow

```
Profile YAML
  ↓ loadProfile()
Server (ws:7337)
  ↓ per-connection
  Session  ←→  FsMemoryProvider (profile-scoped + session-scoped)
  ↓ on user message
  AgentLoop  →  OpenAI-compatible API (streaming)
                  ↓ tool calls
                  ACL check (allow / prompt / deny)
                  ↓ approved
                  runHooks(pre_tool) → execute() → runHooks(post_tool)
                  → telemetry (~/.harness/telemetry.jsonl)
  ↓ session end
  DefaultImprover.reflect() → memory.write() + proposed skills
```

### Key modules

| Path | Role |
|------|------|
| `src/types.ts` | Shared WS protocol types (`ClientMessage` / `ServerMessage`) |
| `src/profiles/schema.ts` | Zod schema for profiles — **start here** when changing config shape |
| `src/loop/agent-loop.ts` | Core streaming agentic loop; handles tool call fan-out, ACL, hooks, telemetry |
| `src/server/index.ts` | WS server; one `Session` + `FsMemoryProvider` per connection |
| `src/tools/registry.ts` | Global tool registry; `registerAll()` in `src/tools/builtin/index.ts` registers built-ins |
| `src/tools/acl.ts` | ACL resolution: profile `tools.builtin[name]` for built-ins; `tools.mcp_servers[].acl` for MCP |
| `src/skills/loader.ts` | Auto-discovers `SKILL.md` dirs across 4 path levels; `resolveSkillsDirs()` + `loadAllSkills()`; last-write-wins |
| `src/skills/indexer.ts` | Builds the skill list injected into the system prompt |
| `src/memory/fs-memory.ts` | Two scopes: `session` (in-memory on `Session`) and `profile` (`<artifact_dir>/memory/*.md`) |
| `src/session/store.ts` | Sessions persisted to `~/.harness/sessions/<date>_<id>.json` |
| `src/hooks/runner.ts` | `pre_tool` / `post_tool` / `on_stop` shell hooks from profile; env vars `TOOL_NAME`, `TOOL_OK` |
| `src/mcp/client.ts` | Connects to MCP servers (stdio/streamable-http/sse/websocket); tools exposed as `<serverName>__<toolName>` with real schemas |
| `src/improver/default-improver.ts` | Post-session reflection → memory writes; skill mining every N sessions |
| `src/telemetry/logger.ts` | Appends JSONL events to `~/.harness/telemetry.jsonl` |
| `src/tui/` | Ink-based TUI; `App` fans WS messages out to `useMessages`, `useTools`, `useMemory` hooks |

### Profiles

Profiles live in `profiles/` (project-local) or `~/.harness/profiles/`. Load order for paths in profile YAML: `$CWD` expands to `process.cwd()`, `~` to `homedir()`.

### Skills

Skills are directories under `.agents/skills/<name>/` containing a `SKILL.md` file with gray-matter frontmatter (`name`, `description`). Optional subdirs: `scripts/`, `references/`, `assets/`.

Four roots are auto-discovered at startup (most-specific wins on name collision):

| Level | Path |
|-------|------|
| User | `~/.agents/skills/` |
| Project | `<git-repo-root>/.agents/skills/` |
| Sub-project | `<CWD>/../.agents/skills/` |
| Folder | `<CWD>/.agents/skills/` |

No profile configuration needed. The `Skill` tool returns `SKILL.md` content; use the `Read` tool for files in subdirectories.

### MCP servers

Configured in `tools.mcp_servers` of the profile YAML. Four transports supported (`transport` defaults to `stdio` if omitted):

```yaml
tools:
  mcp_servers:
    # stdio — local subprocess (default)
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      env: {}
      acl:
        "*": prompt
        read_file: allow

    # Streamable HTTP — modern remote MCP standard
    - name: my-remote
      transport: streamable-http
      url: https://my-mcp-server.com/mcp
      headers:
        Authorization: "Bearer ${MY_TOKEN}"
      acl:
        "*": prompt

    # SSE — legacy remote (still common)
    - name: legacy
      transport: sse
      url: https://legacy.example.com/sse
      headers: {}
      acl:
        "*": prompt

    # WebSocket
    - name: ws-server
      transport: websocket
      url: ws://localhost:8080/mcp
      acl:
        "*": prompt
```

Tools are exposed as `<serverName>__<toolName>` in the agent loop. ACL: `tools.mcp_servers[].acl` with `*` wildcard fallback. Tool parameter schemas are passed through from the MCP server's `listTools` response so the LLM sees real parameter definitions.

### Provider

Uses the OpenAI SDK pointed at any `base_url` — model is fully configurable per profile. API key is read from `process.env[profile.model.api_key_env]`.

### Cost estimation

Hardcoded in `agent-loop.ts::estimateCost`: `$0.000003/input token`, `$0.000015/output token`. Update when switching models.
