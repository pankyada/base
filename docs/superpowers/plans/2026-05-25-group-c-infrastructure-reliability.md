# Group C — Infrastructure Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix unbounded telemetry growth with rotation + lazy reads, and replace shared MCP clients with per-connection isolation.

**Architecture:** Two sequential tasks. Task 1 (telemetry) is fully self-contained. Task 2 (MCP isolation) touches four files — client, tool types, agent loop, server — in a coordinated change.

**Tech Stack:** TypeScript, Node.js `fs`, `@modelcontextprotocol/sdk`, Vitest

---

## File Map

| File | Task | Change |
|------|------|--------|
| `src/telemetry/logger.ts` | 1 | Add `rotateTelemetry()`, call after append |
| `src/telemetry/query.ts` | 1 | Tail-read last 2000 lines instead of full file |
| `tests/telemetry.test.ts` | 1 | Add rotation + tail-read tests |
| `src/mcp/client.ts` | 2 | Remove global `entries`; export `McpEntry`, `createMcpClients`, `destroyMcpClients`; update `getMcpToolDefinitions` signature |
| `src/tools/types.ts` | 2 | Add `mcpEntries: McpEntry[]` to `ToolContext` |
| `src/loop/agent-loop.ts` | 2 | Pass `context.mcpEntries ?? []` to `getMcpToolDefinitions` |
| `src/server/index.ts` | 2 | Per-connection `createMcpClients` / `destroyMcpClients`; remove global init/close |

---

## Task 1: Telemetry Rotation + Lazy Reads

**Files:**
- Modify: `src/telemetry/logger.ts`
- Modify: `src/telemetry/query.ts`
- Modify: `tests/telemetry.test.ts`

Current state: `logEvent` appends to a single `~/.harness/telemetry.jsonl` forever. `queryEvents` reads the entire file. The existing test file imports `TELEMETRY_PATH` directly.

- [ ] **Step 1: Update `beforeEach` in `tests/telemetry.test.ts` to clean up rotated files**

The existing `beforeEach` only deletes the current file. After this change, rotated files (`.1` through `.5`) also need cleanup. Replace the existing `beforeEach`:

```typescript
beforeEach(() => {
  if (existsSync(TELEMETRY_PATH)) unlinkSync(TELEMETRY_PATH)
  for (let i = 1; i <= 5; i++) {
    const p = `${TELEMETRY_PATH}.${i}`
    if (existsSync(p)) unlinkSync(p)
  }
})
```

Also add `writeFileSync`, `mkdirSync`, `readFileSync` to the existing `fs` import at the top of the test file:

```typescript
import { existsSync, unlinkSync, writeFileSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
```

- [ ] **Step 2: Write the failing tests — add to `tests/telemetry.test.ts`**

Add these three tests inside the existing `describe('telemetry', ...)` block:

```typescript
  it('rotates current file to .1 when size exceeds 5MB', () => {
    // Write >5MB so next logEvent triggers rotation
    mkdirSync(join(homedir(), '.harness'), { recursive: true })
    writeFileSync(TELEMETRY_PATH, 'x'.repeat(5 * 1024 * 1024 + 1))
    logEvent({ session: 'abc', profile: 'test', kind: 'tool', name: 'Read', ok: true })
    expect(existsSync(`${TELEMETRY_PATH}.1`)).toBe(true)
    // New file has only the one appended event
    const events = queryEvents({})
    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('Read')
  })

  it('shifts existing rotated files and deletes oldest beyond .5', () => {
    mkdirSync(join(homedir(), '.harness'), { recursive: true })
    // Pre-create .1 through .5
    for (let i = 1; i <= 5; i++) {
      writeFileSync(`${TELEMETRY_PATH}.${i}`, `content-${i}`)
    }
    // Write >5MB and trigger rotation
    writeFileSync(TELEMETRY_PATH, 'x'.repeat(5 * 1024 * 1024 + 1))
    logEvent({ session: 'abc', profile: 'test', kind: 'tool', name: 'Read', ok: true })
    // Old .5 is gone
    expect(readFileSync(`${TELEMETRY_PATH}.5`, 'utf-8')).toBe('content-4')
    expect(readFileSync(`${TELEMETRY_PATH}.4`, 'utf-8')).toBe('content-3')
    expect(readFileSync(`${TELEMETRY_PATH}.2`, 'utf-8')).toBe('content-1')
    // .1 now holds the big pre-rotation file
    expect(readFileSync(`${TELEMETRY_PATH}.1`, 'utf-8').length).toBeGreaterThan(5 * 1024 * 1024)
  })

  it('queryEvents returns only the last 2000 lines when file has more', () => {
    // Write 2500 JSON lines directly
    mkdirSync(join(homedir(), '.harness'), { recursive: true })
    const lines = Array.from({ length: 2500 }, (_, i) =>
      JSON.stringify({ ts: new Date().toISOString(), session: 'x', profile: 'test', kind: 'tool' as const, name: `T${i}`, ok: true })
    ).join('\n') + '\n'
    writeFileSync(TELEMETRY_PATH, lines)
    const events = queryEvents({})
    expect(events).toHaveLength(2000)
    expect(events[events.length - 1].name).toBe('T2499')
  })
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/telemetry.test.ts
```

Expected: 3 new tests FAIL (rotation not yet implemented, queryEvents still reads all lines)

- [ ] **Step 4: Rewrite `src/telemetry/logger.ts`**

Replace the entire file with:

```typescript
import { appendFileSync, mkdirSync, statSync, renameSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { TelemetryEvent } from '../types.js'

export const TELEMETRY_PATH = join(homedir(), '.harness', 'telemetry.jsonl')

const MAX_TELEMETRY_BYTES = 5 * 1024 * 1024  // 5MB
const MAX_ROTATED_FILES = 5

function rotateTelemetry(): void {
  // Delete the oldest rotated file if it exists
  const oldest = `${TELEMETRY_PATH}.${MAX_ROTATED_FILES}`
  if (existsSync(oldest)) unlinkSync(oldest)
  // Shift .4→.5, .3→.4, .2→.3, .1→.2
  for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
    const from = `${TELEMETRY_PATH}.${i}`
    const to = `${TELEMETRY_PATH}.${i + 1}`
    if (existsSync(from)) renameSync(from, to)
  }
  // Rotate current file to .1
  renameSync(TELEMETRY_PATH, `${TELEMETRY_PATH}.1`)
}

export function logEvent(event: Omit<TelemetryEvent, 'ts'>): void {
  mkdirSync(join(homedir(), '.harness'), { recursive: true })
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event })
  appendFileSync(TELEMETRY_PATH, line + '\n', 'utf-8')
  try {
    const { size } = statSync(TELEMETRY_PATH)
    if (size > MAX_TELEMETRY_BYTES) rotateTelemetry()
  } catch {
    // statSync can fail in rare race conditions — rotation is best-effort
  }
}
```

- [ ] **Step 5: Update `src/telemetry/query.ts`**

Replace the entire file with:

```typescript
import { readFileSync, existsSync } from 'fs'
import { TelemetryEvent } from '../types.js'
import { TELEMETRY_PATH } from './logger.js'

const QUERY_TAIL_LINES = 2000

export function queryEvents(opts: {
  profile?: string
  since?: Date
  kind?: TelemetryEvent['kind']
}): TelemetryEvent[] {
  if (!existsSync(TELEMETRY_PATH)) return []
  const allLines = readFileSync(TELEMETRY_PATH, 'utf-8').split('\n').filter(Boolean)
  const lines = allLines.slice(-QUERY_TAIL_LINES)
  return lines
    .map(l => JSON.parse(l) as TelemetryEvent)
    .filter(e => {
      if (opts.profile && e.profile !== opts.profile) return false
      if (opts.since && new Date(e.ts) < opts.since) return false
      if (opts.kind && e.kind !== opts.kind) return false
      return true
    })
}

export function summarize(events: TelemetryEvent[]): string {
  const toolCounts = new Map<string, number>()
  const skillCounts = new Map<string, number>()
  const mcpCounts = new Map<string, number>()
  let totalCost = 0

  for (const e of events) {
    if (e.kind === 'tool' && e.name) toolCounts.set(e.name, (toolCounts.get(e.name) ?? 0) + 1)
    if (e.kind === 'skill' && e.name) skillCounts.set(e.name, (skillCounts.get(e.name) ?? 0) + 1)
    if (e.kind === 'mcp') {
      const key = `${e.server ?? '?'}/${e.name ?? '?'}`
      mcpCounts.set(key, (mcpCounts.get(key) ?? 0) + 1)
    }
    if (e.cost_usd) totalCost += e.cost_usd
  }

  const top5 = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => `  ${k}: ${v}`).join('\n') || '  (none)'

  return [
    `Total events: ${events.length}`,
    `Total cost: $${totalCost.toFixed(4)}`,
    `\nTop tools:\n${top5(toolCounts)}`,
    `\nTop skills:\n${top5(skillCounts)}`,
    `\nTop MCP calls:\n${top5(mcpCounts)}`,
  ].join('\n')
}
```

- [ ] **Step 6: Run telemetry tests to verify they pass**

```bash
npx vitest run tests/telemetry.test.ts
```

Expected: all 6 tests PASS

- [ ] **Step 7: Run full suite**

```bash
pnpm test
```

Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/telemetry/logger.ts src/telemetry/query.ts tests/telemetry.test.ts
git commit -m "feat: telemetry rotation (5 files, 5MB) and lazy tail-read queries"
```

---

## Task 2: MCP Per-Connection Isolation

**Files:**
- Modify: `src/mcp/client.ts`
- Modify: `src/tools/types.ts`
- Modify: `src/loop/agent-loop.ts`
- Modify: `src/server/index.ts`

No new test file — MCP servers can't be mocked without subprocess machinery. Existing tests must continue to pass (they use `mcp_servers: []` in profiles, so `createMcpClients` returns `[]` and `getMcpToolDefinitions` returns `[]`).

- [ ] **Step 1: Rewrite `src/mcp/client.ts`**

Replace the entire file with:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import { Profile, McpServerConfig } from '../profiles/schema.js'
import { ToolDefinition } from '../tools/types.js'

export interface McpToolMeta {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpEntry {
  client: Client
  serverName: string
  tools: McpToolMeta[]
}

function buildTransport(cfg: McpServerConfig) {
  switch (cfg.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: { ...process.env as Record<string, string>, ...cfg.env },
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit: { headers: cfg.headers },
      })
    case 'sse':
      return new SSEClientTransport(new URL(cfg.url), {
        requestInit: { headers: cfg.headers },
      })
    case 'websocket':
      return new WebSocketClientTransport(new URL(cfg.url))
  }
}

export async function createMcpClients(profile: Profile): Promise<McpEntry[]> {
  const entries: McpEntry[] = []
  for (const cfg of profile.tools.mcp_servers) {
    try {
      const transport = buildTransport(cfg)
      const client = new Client({ name: 'harness', version: '0.1.0' })
      await client.connect(transport)
      const { tools } = await client.listTools()
      entries.push({
        client,
        serverName: cfg.name,
        tools: tools.map((t: any) => ({
          name: t.name as string,
          description: (t.description as string | undefined) ?? '',
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object' },
        })),
      })
    } catch (e: any) {
      console.error(`[mcp] failed to connect to ${cfg.name}: ${e.message}`)
    }
  }
  return entries
}

export async function destroyMcpClients(entries: McpEntry[]): Promise<void> {
  for (const e of entries) {
    try {
      await e.client.close()
    } catch {
      // Ignore — connection may already be dead
    }
  }
}

export function getMcpToolDefinitions(profile: Profile, entries: McpEntry[]): ToolDefinition[] {
  const result: ToolDefinition[] = []
  for (const entry of entries) {
    const cfg = profile.tools.mcp_servers.find(s => s.name === entry.serverName)
    if (!cfg) continue
    for (const tool of entry.tools) {
      result.push({
        name: `${entry.serverName}__${tool.name}`,
        description: `[MCP:${entry.serverName}] ${tool.description || tool.name}`,
        parameters: tool.inputSchema,
        async execute(input) {
          const r = await entry.client.callTool({ name: tool.name, arguments: input })
          const content = r.content as Array<{ type: string; text?: string }>
          return content.map(c => c.text ?? JSON.stringify(c)).join('\n')
        },
      })
    }
  }
  return result
}
```

Key changes from original:
- `McpEntry` and `McpToolMeta` are now exported interfaces (needed by `ToolContext`)
- No module-level `entries` array
- `createMcpClients` replaces `initMcpClients` — returns `McpEntry[]` instead of mutating global state
- `destroyMcpClients` replaces `closeMcpClients` — takes `McpEntry[]` parameter
- `getMcpToolDefinitions` takes `entries: McpEntry[]` as second parameter
- `createMcpClients` catches per-server errors and logs them (connection to one server failing doesn't abort others)

- [ ] **Step 2: Update `src/tools/types.ts`**

Replace the entire file with:

```typescript
import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { MemoryProvider } from '../memory/interface.js'
import type { McpEntry } from '../mcp/client.js'

export interface Skill {
  name: string
  description: string
  content: string
  filePath: string
}

export interface ToolContext {
  profile: Profile
  session: Session
  workingDir: string
  memory: MemoryProvider
  skills: Skill[]
  mcpEntries: McpEntry[]
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(input: Record<string, unknown>, context: ToolContext): Promise<string>
}
```

- [ ] **Step 3: Update `src/loop/agent-loop.ts`**

Find the line:
```typescript
  const allTools = [...getAllTools(), ...getMcpToolDefinitions(profile)]
```

Replace with:
```typescript
  const allTools = [...getAllTools(), ...getMcpToolDefinitions(profile, context.mcpEntries ?? [])]
```

The `?? []` fallback ensures existing tests that don't include `mcpEntries` in the context continue to work.

- [ ] **Step 4: Update `src/server/index.ts`**

**4a.** Update the import line at the top. Find:
```typescript
import { initMcpClients, closeMcpClients } from '../mcp/client.js'
```
Replace with:
```typescript
import { createMcpClients, destroyMcpClients } from '../mcp/client.js'
```

**4b.** In the `main()` function, remove the global MCP init call. Find and delete this line:
```typescript
  await initMcpClients(profile)
```

**4c.** In the `wss.on('connection', ...)` handler, add per-connection MCP init right after the session/memory/abort setup. Find:
```typescript
    let session = createSession(profile.name)
    let memory = new FsMemoryProvider(profile.artifact_dir, session)
    let abortController = new AbortController()
    const pendingApprovals = new Map<string, (approved: boolean) => void>()
```
Replace with:
```typescript
    let session = createSession(profile.name)
    let memory = new FsMemoryProvider(profile.artifact_dir, session)
    let abortController = new AbortController()
    const pendingApprovals = new Map<string, (approved: boolean) => void>()
    const mcpEntries = await createMcpClients(profile)
```

**4d.** Update the context object that's passed to `runAgentLoop`. Find:
```typescript
        const context = {
          profile, session, workingDir: profile.working_dir, memory, skills,
        }
```
Replace with:
```typescript
        const context = {
          profile, session, workingDir: profile.working_dir, memory, skills, mcpEntries,
        }
```

**4e.** In `ws.on('close', ...)`, add MCP cleanup before the improvement logic. Find:
```typescript
    ws.on('close', () => {
      saveSession(session)

      // on_stop hooks (fire-and-forget — close handler cannot be async)
      void runHooks('on_stop', profile, { SESSION_ID: session.id, PROFILE: profile.name })
        .catch(e => console.error('[on_stop hook] error:', e.message))
```
Replace with:
```typescript
    ws.on('close', () => {
      saveSession(session)

      // Destroy per-connection MCP clients (fire-and-forget)
      void destroyMcpClients(mcpEntries).catch(e => console.error('[mcp] destroy error:', e.message))

      // on_stop hooks (fire-and-forget — close handler cannot be async)
      void runHooks('on_stop', profile, { SESSION_ID: session.id, PROFILE: profile.name })
        .catch(e => console.error('[on_stop hook] error:', e.message))
```

**4f.** Update the SIGINT handler to remove the global MCP close. Find:
```typescript
  process.on('SIGINT', async () => {
    console.log('\nShutting down...')
    await closeMcpClients()
    wss.close()
    process.exit(0)
  })
```
Replace with:
```typescript
  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    wss.close()
    process.exit(0)
  })
```

Each connection's MCP clients are cleaned up individually when the WS closes.

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS (no MCP tests exist that need updating — existing tests use `mcp_servers: []`)

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/mcp/client.ts src/tools/types.ts src/loop/agent-loop.ts src/server/index.ts
git commit -m "feat: per-connection MCP client isolation"
```

---

## Final Verification

- [ ] **Full test suite**

```bash
pnpm test
```

Expected: all 90+ tests PASS

- [ ] **Typecheck**

```bash
pnpm typecheck
```

Expected: no errors
