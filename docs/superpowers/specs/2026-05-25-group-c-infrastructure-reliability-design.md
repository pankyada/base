# Group C — Infrastructure Reliability Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two infrastructure reliability issues: unbounded telemetry growth and shared MCP client state across WebSocket connections.

**Architecture:** Two independent tasks — telemetry rotation first (self-contained file changes), then MCP isolation (touches server, agent loop, and tool context). Each produces working, testable changes on its own.

**Tech Stack:** TypeScript, Node.js `fs`, `@modelcontextprotocol/sdk`, Vitest

---

## C.1 — Telemetry Rotation + Lazy Reads

### Problem

`logEvent` appends to a single `~/.harness/telemetry.jsonl` file that grows forever. `queryEvents` (called in `mineSkills`) reads the entire file into memory on every invocation — gets slower as history accumulates.

### Design

**Rotation threshold:** `MAX_TELEMETRY_BYTES = 5 * 1024 * 1024` (5MB) — module constant, not profile-configurable.

**Max rotated files:** 5 (`.jsonl.1` through `.jsonl.5`) — ~30MB max total disk usage.

**Rotation algorithm** (triggered in `logEvent` after every append, when file size > threshold):
1. Delete `telemetry.jsonl.5` if it exists
2. Rename `telemetry.jsonl.4` → `telemetry.jsonl.5` (if exists)
3. Rename `telemetry.jsonl.3` → `telemetry.jsonl.4` (if exists)
4. Rename `telemetry.jsonl.2` → `telemetry.jsonl.3` (if exists)
5. Rename `telemetry.jsonl.1` → `telemetry.jsonl.2` (if exists)
6. Rename `telemetry.jsonl` → `telemetry.jsonl.1`
7. Fresh `telemetry.jsonl` starts on next write

**Lazy query:** `queryEvents` reads only the last `QUERY_TAIL_LINES = 2000` lines of `telemetry.jsonl`. It does NOT read rotated files — `mineSkills` only needs recent tool frequency data. Existing filter logic unchanged. `queryEvents` signature unchanged.

### Files Changed

| File | Change |
|------|--------|
| `src/telemetry/logger.ts` | Add `rotateTelemetry()` helper; call after `appendFileSync` |
| `src/telemetry/query.ts` | Replace full `readFileSync` with tail-read (last 2000 lines) |
| `tests/telemetry.test.ts` | Add rotation and tail-read tests |

### Constants

```typescript
// src/telemetry/logger.ts
const MAX_TELEMETRY_BYTES = 5 * 1024 * 1024  // 5MB
const MAX_ROTATED_FILES = 5

// src/telemetry/query.ts
const QUERY_TAIL_LINES = 2000
```

---

## C.2 — MCP Per-Connection Isolation

### Problem

`src/mcp/client.ts` stores all MCP client connections in a module-level `entries: McpEntry[]` singleton. All WebSocket connections share the same MCP clients. If an MCP server crashes, all active sessions lose those tools simultaneously. Full isolation requires each connection to own its MCP clients.

### Design

Remove the module-level `entries` array. Replace `initMcpClients` / `closeMcpClients` with per-connection functions that return and accept the connection's own `McpEntry[]`.

**New API in `src/mcp/client.ts`:**

```typescript
// Create MCP clients for one connection — returns the connection's entries
export async function createMcpClients(profile: Profile): Promise<McpEntry[]>

// Destroy MCP clients for one connection
export async function destroyMcpClients(entries: McpEntry[]): Promise<void>

// Get tool definitions for agent loop — takes connection's entries
export function getMcpToolDefinitions(profile: Profile, entries: McpEntry[]): ToolDefinition[]
```

`McpEntry` is exported so `ToolContext` can reference it.

**`src/tools/types.ts` (`ToolContext`):** add `mcpEntries: McpEntry[]` field.

**`src/loop/agent-loop.ts`:** change `getMcpToolDefinitions(profile)` → `getMcpToolDefinitions(profile, context.mcpEntries)`.

**`src/server/index.ts`:** per WS connection:
```typescript
// on connect
const mcpEntries = await createMcpClients(profile)

// build context with mcpEntries
const context = { profile, session, workingDir: profile.working_dir, memory, skills, mcpEntries }

// on close (fire-and-forget)
void destroyMcpClients(mcpEntries).catch(e => console.error('[mcp] destroy error:', e.message))
```

Remove `initMcpClients` / `closeMcpClients` calls from `main()` and the SIGINT handler (each connection cleans up its own clients on close).

### Files Changed

| File | Change |
|------|--------|
| `src/mcp/client.ts` | Remove global `entries`; add `createMcpClients`, `destroyMcpClients`; update `getMcpToolDefinitions` signature |
| `src/tools/types.ts` | Add `mcpEntries: McpEntry[]` to `ToolContext` |
| `src/loop/agent-loop.ts` | Pass `context.mcpEntries` to `getMcpToolDefinitions` |
| `src/server/index.ts` | Per-connection `createMcpClients` / `destroyMcpClients`; remove global init/close |
| `tests/` | Update any tests that mock MCP tool definitions |

### Removed Exports

`initMcpClients` and `closeMcpClients` are removed entirely. Any callers (currently only `src/server/index.ts`) must migrate to the new per-connection API.
