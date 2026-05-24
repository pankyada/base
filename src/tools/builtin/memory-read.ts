import { ToolDefinition, ToolContext } from '../types.js'

export const memoryReadTool: ToolDefinition = {
  name: 'MemoryRead',
  description: 'Read a memory entry by key from session or profile scope.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile'] },
      key: { type: 'string' },
    },
    required: ['scope', 'key'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope, key } = input as { scope: 'session' | 'profile'; key: string }
    const val = await ctx.memory.read(scope, key)
    return val ?? `(no memory entry for key: ${key})`
  },
}
