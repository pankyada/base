import { ToolDefinition, ToolContext } from '../types.js'

export const memoryListTool: ToolDefinition = {
  name: 'MemoryList',
  description: 'List all memory entries in a scope.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile'] },
    },
    required: ['scope'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope } = input as { scope: 'session' | 'profile' }
    const entries = await ctx.memory.list(scope)
    if (entries.length === 0) return `(no entries in ${scope} memory)`
    return entries.map(e => `- **${e.key}**: ${e.preview}`).join('\n')
  },
}
