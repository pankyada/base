# MCP Transport Support + Tool Schemas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `streamable-http`, `sse`, and `websocket` transport support to MCP servers (alongside existing `stdio`), and fix tool schemas so the LLM sees real parameter definitions instead of a generic passthrough.

**Architecture:** `McpServerSchema` in `schema.ts` becomes a Zod discriminated union keyed on `transport` (defaulting to `stdio`); `initMcpClients` in `mcp/client.ts` selects the correct SDK transport class and captures each tool's `inputSchema` from `listTools`; `getMcpToolDefinitions` passes real schemas through to `ToolDefinition.parameters`. Existing `stdio`-only profiles work unchanged (no `transport` key → defaults to `stdio`).

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (`StdioClientTransport`, `StreamableHTTPClientTransport`, `SSEClientTransport`, `WebSocketClientTransport`), Zod v4, vitest

---

## File Map

| File | Change |
|------|--------|
| `src/profiles/schema.ts` | Replace flat `McpServerSchema` with discriminated union on `transport` |
| `src/mcp/client.ts` | Select transport by type; capture & store `inputSchema`; pass through in `getMcpToolDefinitions` |
| `tests/acl.test.ts` | Update `baseProfile` fixture — `mcp_servers` entry needs `transport: 'stdio'` |
| `tests/profile-loader.test.ts` | Same fixture update if it includes `mcp_servers` |
| `CLAUDE.md` | Update MCP section with new profile config examples |

---

### Task 1: Update `McpServerSchema` to discriminated union

**Files:**
- Modify: `src/profiles/schema.ts`
- Modify: `tests/acl.test.ts`
- Modify: `tests/profile-loader.test.ts`

- [ ] **Step 1: Write failing typecheck — add a `transport` field to the ACL test fixture and verify it's rejected by the current schema**

Run: `cd /Users/pankajkumaryadav/Desktop/development/base && pnpm typecheck`
Expected: PASS (baseline — schema doesn't know `transport` yet, so `satisfies Profile` on the fixture will error once we add the field in Step 3)

- [ ] **Step 2: Replace `McpServerSchema` in `src/profiles/schema.ts`**

Replace the entire `McpServerSchema` constant and its usages with this discriminated union. Keep everything else in the file identical.

```typescript
// src/profiles/schema.ts
import { z } from 'zod'

const AclValue = z.enum(['allow', 'prompt', 'deny'])

const BuiltinToolsSchema = z.object({
  Read: AclValue.default('allow'),
  Write: AclValue.default('allow'),
  Edit: AclValue.default('allow'),
  Bash: AclValue.default('prompt'),
  Grep: AclValue.default('allow'),
  Glob: AclValue.default('allow'),
  Skill: AclValue.default('allow'),
  MemoryRead: AclValue.default('allow'),
  MemoryWrite: AclValue.default('allow'),
  MemoryList: AclValue.default('allow'),
  Stats: AclValue.default('allow'),
  Delegate: AclValue.default('prompt'),
}).passthrough()

const McpAcl = z.record(z.string(), AclValue).default({ '*': 'prompt' })

// stdio (default — existing profiles work without adding transport:)
const StdioMcpServerSchema = z.object({
  name: z.string(),
  transport: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  acl: McpAcl,
})

// Streamable HTTP (modern MCP standard)
const StreamableHttpMcpServerSchema = z.object({
  name: z.string(),
  transport: z.literal('streamable-http'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  acl: McpAcl,
})

// SSE (legacy, still common)
const SseMcpServerSchema = z.object({
  name: z.string(),
  transport: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  acl: McpAcl,
})

// WebSocket
const WebSocketMcpServerSchema = z.object({
  name: z.string(),
  transport: z.literal('websocket'),
  url: z.string(),
  acl: McpAcl,
})

// Preprocess: if no transport field, default to 'stdio'
const McpServerSchema = z.preprocess(
  (val) => {
    if (val && typeof val === 'object' && !('transport' in (val as object))) {
      return { ...(val as object), transport: 'stdio' }
    }
    return val
  },
  z.discriminatedUnion('transport', [
    StdioMcpServerSchema,
    StreamableHttpMcpServerSchema,
    SseMcpServerSchema,
    WebSocketMcpServerSchema,
  ])
)

export type McpServerConfig = z.infer<typeof McpServerSchema>

export const ProfileSchema = z.object({
  name: z.string(),
  model: z.object({
    base_url: z.string().url(),
    api_key_env: z.string(),
    id: z.string(),
    fallback_id: z.string().optional(),
  }),
  system_prompt: z.string(),
  working_dir: z.string().default('$CWD'),
  artifact_dir: z.string(),
  tools: z.preprocess(
    (val) => val ?? {},
    z.object({
      builtin: z.preprocess((val) => val ?? {}, BuiltinToolsSchema),
      mcp_servers: z.array(McpServerSchema).default([]),
    })
  ),
  hooks: z.preprocess(
    (val) => val ?? {},
    z.object({
      pre_tool: z.array(z.string()).default([]),
      post_tool: z.array(z.string()).default([]),
      on_stop: z.array(z.string()).default([]),
    })
  ),
  improvement: z.preprocess(
    (val) => val ?? {},
    z.object({
      enabled: z.boolean().default(true),
      model_id: z.string().optional(),
      mine_skills_every_n_sessions: z.number().default(10),
    })
  ),
})

export type Profile = z.infer<typeof ProfileSchema>
```

- [ ] **Step 3: Update `tests/acl.test.ts` fixture**

The `baseProfile` `mcp_servers` entry must now include `transport: 'stdio'` (since `satisfies Profile` enforces the discriminated union):

```typescript
// in tests/acl.test.ts — update only the mcp_servers entry:
mcp_servers: [{
  name: 'pg',
  transport: 'stdio' as const,
  command: 'pg-mcp',
  args: [],
  env: {},
  acl: { '*': 'prompt', query: 'allow' } as any,
}],
```

- [ ] **Step 4: Check `tests/profile-loader.test.ts` for `mcp_servers` fixtures**

Read the file. If any fixture includes an `mcp_servers` entry without a `transport` field, add `transport: 'stdio' as const`. If there are no `mcp_servers` fixtures, skip this step.

- [ ] **Step 5: Run typecheck and tests**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && pnpm typecheck && pnpm test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git add src/profiles/schema.ts tests/acl.test.ts tests/profile-loader.test.ts
git commit -m "feat(profiles): discriminated union MCP transport schema (stdio/streamable-http/sse/websocket)"
```

---

### Task 2: Update `src/mcp/client.ts` — multi-transport support + real tool schemas

**Files:**
- Modify: `src/mcp/client.ts`

- [ ] **Step 1: Write the updated `src/mcp/client.ts`**

Full replacement (no tests for this module — it requires live MCP servers; covered by typecheck + integration):

```typescript
// src/mcp/client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Profile, McpServerConfig } from '../profiles/schema.js'
import { ToolDefinition } from '../tools/types.js'

interface McpToolMeta {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

interface McpEntry {
  client: Client
  serverName: string
  tools: McpToolMeta[]
}

const entries: McpEntry[] = []

function buildTransport(cfg: McpServerConfig): Transport {
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

export async function initMcpClients(profile: Profile): Promise<void> {
  for (const cfg of profile.tools.mcp_servers) {
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
  }
}

export async function closeMcpClients(): Promise<void> {
  for (const e of entries) await e.client.close()
  entries.length = 0
}

export function getMcpToolDefinitions(profile: Profile): ToolDefinition[] {
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

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && pnpm typecheck
```

Expected: no errors. If the SDK doesn't export `Transport` from `shared/transport.js`, check the import path:

```bash
ls /Users/pankajkumaryadav/Desktop/development/base/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/
```

Use whatever path exports the `Transport` interface, or inline the type as `{ start(): Promise<void>; close(): Promise<void>; send(msg: unknown): Promise<void> }` if needed.

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && pnpm test
```

Expected: all 68 tests PASS (no MCP live-server tests exist; this is safe).

- [ ] **Step 4: Commit**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git add src/mcp/client.ts
git commit -m "feat(mcp): add streamable-http/sse/websocket transports; pass real tool schemas to LLM"
```

---

### Task 3: Update CLAUDE.md and push

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the MCP tool naming section in `CLAUDE.md`**

Find the existing `### MCP tool naming` section and replace it with:

```markdown
### MCP servers

Configured in `tools.mcp_servers` of the profile YAML. Four transports supported:

```yaml
tools:
  mcp_servers:
    # stdio — local subprocess (default when transport: omitted)
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
```

- [ ] **Step 2: Run full test suite one final time**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && pnpm test
```

Expected: all PASS.

- [ ] **Step 3: Commit and push**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git add CLAUDE.md
git commit -m "docs: update MCP section with all transports and schema passthrough"
git push
```
