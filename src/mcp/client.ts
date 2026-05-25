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
