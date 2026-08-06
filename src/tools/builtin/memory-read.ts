import { ToolDefinition, ToolContext } from '../types.js'

export const memoryReadTool: ToolDefinition = {
  name: 'MemoryRead',
  description: 'Read a memory entry by key. Scopes: session, profile (shared), user (private), project (project-scoped).',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile', 'user', 'project'] },
      key: { type: 'string' },
    },
    required: ['scope', 'key'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope, key } = input as { scope: 'session' | 'profile' | 'user' | 'project'; key: string }
    const val = await ctx.memory.read(scope, key)
    if (!val) return `(no memory entry for key: ${key})`

    let output = val.content
    if (val.links && val.links.length > 0) {
      output += '\n\nLinked Memories:\n'
      output += val.links.map(l => `- ${l.target}${l.relation ? ` (${l.relation})` : ''}`).join('\n')
    }
    return val.provenance === 'untrusted'
      ? { content: output, provenance: 'untrusted', source: val.source ?? `memory ${scope}/${key}` }
      : output
  },
}
