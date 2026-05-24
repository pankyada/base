import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Profile } from '../profiles/schema.js'
import { ToolDefinition } from '../tools/types.js'

interface McpEntry {
  client: Client
  serverName: string
  toolNames: string[]
}

const entries: McpEntry[] = []

export async function initMcpClients(profile: Profile): Promise<void> {
  for (const cfg of profile.tools.mcp_servers) {
    const transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args,
      env: { ...process.env as Record<string, string>, ...cfg.env },
    })
    const client = new Client({ name: 'harness', version: '0.1.0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    entries.push({
      client,
      serverName: cfg.name,
      toolNames: tools.map((t: any) => t.name),
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
    for (const toolName of entry.toolNames) {
      result.push({
        name: `${entry.serverName}__${toolName}`,
        description: `[MCP:${entry.serverName}] ${toolName}`,
        parameters: { type: 'object', properties: {}, additionalProperties: true },
        async execute(input) {
          const r = await entry.client.callTool({ name: toolName, arguments: input })
          const content = r.content as Array<{ type: string; text?: string }>
          return content.map(c => c.text ?? JSON.stringify(c)).join('\n')
        },
      })
    }
  }
  return result
}
