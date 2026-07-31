# MCP-out — Expose Any Profile as an MCP Server (Design)

> Feature #14 on the roadmap. Spec for the implementation plan at
> `docs/superpowers/plans/2026-06-10-mcp-out.md`.

## Problem

The harness *consumes* MCP servers (`src/mcp/client.ts`) but cannot *be* one. Today an
agent profile is only reachable through the harness's own protocols: the WebSocket
protocol (TUI/CLI/web) and the REST endpoints (`/run`, `/stream`). Nothing outside the
harness ecosystem can call a profile.

MCP is the lingua franca for tool-calling AI clients (Claude Code, Claude Desktop,
Cursor, other harness instances). If a profile can be served *as* an MCP server, every
profile becomes a composable building block: any MCP client can invoke it, and harness
instances can nest (harness A lists harness B's profile in its `mcp_servers`).

## Goal

One command turns any profile YAML into a standards-compliant MCP server:

```bash
harness-mcp profiles/writer.yaml                          # stdio (default)
harness-mcp profiles/writer.yaml --transport http --port 7338   # Streamable HTTP
```

The whole agent — model, tools, skills, memory, ACL, hooks, improver — runs behind a
single MCP tool. No profile changes required.

## Non-goals (YAGNI)

- **No multi-profile serving.** One process serves one profile, matching
  `harness-server`'s model. Want N profiles? Run N processes.
- **No SSE / WebSocket server transports.** stdio covers local composition; Streamable
  HTTP covers remote. (We *consume* all four transports; we *serve* two.)
- **No streaming progress notifications.** The tool call blocks until the agent loop
  finishes and returns the final text. Progress notifications can be a follow-up.
- **No MCP resources or prompts capabilities.** Tools only.
- **No human-in-the-loop approval.** See ACL semantics below.

## Design

### Tool surface

Each served profile exposes exactly **one MCP tool**, named `run_<slug>` where slug is
the profile name lowercased with non-alphanumeric runs collapsed to `_`
(`writer` → `run_writer`, `My Agent!` → `run_my_agent`).

Tool description comes from the profile's `description:` field, with a generated
fallback.

### Input schema — contract-driven with prompt fallback

| Profile has | MCP tool input schema | What reaches the agent loop |
|---|---|---|
| `contract.input` (e.g. `writer.yaml`) | The contract's JSON Schema, passed through verbatim | Validated args object, serialized by the existing `validateAndBuildInput()` |
| No input contract | `{ prompt: string }` (required) | `args.prompt` as the plain user message |

| Profile has | MCP tool result |
|---|---|
| `contract.output` | `outputSchema` advertised in `tools/list`; result carries `structuredContent` (parsed + Ajv-validated via existing `processOutput()`) plus a JSON text block |
| No output contract | Single text content block with the agent's final message |

This reuses `compileContract` / `validateAndBuildInput` / `processOutput` from
`src/server/contract.ts` unchanged — the MCP layer is a third caller alongside REST and
cron.

### Execution path

`CallTool` → validate input → `runProfileOnce()` (`src/server/run-profile.ts`) with
no-op events → extract final text → contract output processing → MCP result.

`runProfileOnce` already builds the full context (provider client, MCP clients for
*downstream* servers, memory, skills, agent tools, usage ledger), so the served agent
has its complete toolkit including nested MCP servers — this is what makes harness→
harness composition work.

### ACL semantics — headless means prompt = deny

There is no human attached to an MCP tool call. The no-op events object answers
`onToolPrompt` with `false`, so any tool whose ACL resolves to `prompt` is **denied**,
not silently allowed. Profiles intended for MCP serving should use explicit
`allow`/`deny` ACLs (the existing example profiles already do). This matches the
behavior of cron-triggered runs.

### Errors

All failures return an MCP result with `isError: true` and a text explanation (input
validation details, output contract violations, agent run exceptions). Protocol-level
errors are reserved for unknown tool names handled by the SDK.

### Transports

- **stdio** (default): `StdioServerTransport`. The entry point must never write to
  stdout (protocol channel) — all logging goes to stderr. Existing harness logging in
  the `runProfileOnce` path already uses `console.error`/`console.warn` for failures.
- **Streamable HTTP** (`--transport http`): stateless mode — a fresh
  `Server` + `StreamableHTTPServerTransport` pair per POST to `/mcp`
  (`sessionIdGenerator: undefined`). Server construction is cheap (no I/O). Optional
  bearer auth: if `HARNESS_API_KEY` is set, requests must carry
  `Authorization: Bearer <key>`; mirrors the REST endpoints' auth model including the
  unauthenticated warning.

### SDK layer

Use the **low-level `Server`** from `@modelcontextprotocol/sdk/server/index.js` (not
`McpServer`): contracts are already JSON Schema, and the low-level `tools/list` handler
passes JSON Schema through verbatim, while `McpServer.registerTool` wants Zod shapes.
Same pass-through philosophy as the client side (`getMcpToolDefinitions`).

### New files

```
src/mcp-out/tool-spec.ts   profile → MCP tool metadata (name, description, schemas)
src/mcp-out/server.ts      createProfileMcpServer(profile, runner?) → Server
src/mcp-out/http.ts        stateless Streamable HTTP host with bearer auth
src/mcp-out/args.ts        CLI arg parsing
src/mcp-out/index.ts       entry point (bin: harness-mcp)
```

Named `mcp-out/` to avoid colliding with `src/mcp/` (the client side).

`runner` is injectable (defaults to `runProfileOnce`) so tests stub the LLM entirely
and exercise the protocol with `InMemoryTransport`.

### Packaging

- `package.json` bin: `"harness-mcp": "dist/mcp-out/index.js"`
- script: `"dev:mcp": "tsx src/mcp-out/index.ts"`

### Consuming a served profile (the payoff)

From Claude Code / Claude Desktop:

```json
{ "mcpServers": { "writer": { "command": "harness-mcp", "args": ["profiles/writer.yaml"] } } }
```

From another harness profile:

```yaml
tools:
  mcp_servers:
    - name: writer
      transport: stdio
      command: harness-mcp
      args: ["profiles/writer.yaml"]
      acl: { "*": allow }
```

The orchestrating agent sees `writer__run_writer` with the writer's real input schema.

## Future work (explicitly deferred)

- Progress notifications streamed from `onToken`/`onToolStart` events
- Session continuity (multi-turn conversations over one MCP session)
- `--mcp` flag on `harness-server` to co-host alongside WS/REST
- Tool annotations (readOnlyHint etc.) derived from profile ACLs
