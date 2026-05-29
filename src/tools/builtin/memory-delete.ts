import { ToolDefinition, ToolContext } from '../types.js'

export const memoryDeleteTool: ToolDefinition = {
  name: 'MemoryDelete',
  description: 'Delete a memory entry by key. Scopes: session, profile (shared), user (private).',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile', 'user'] },
      key: { type: 'string', description: 'Key to delete' },
    },
    required: ['scope', 'key'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope, key } = input as { scope: 'session' | 'profile' | 'user'; key: string }
    const existing = await ctx.memory.read(scope, key)
    if (existing === null) return `No memory entry found for key: ${key} (scope: ${scope})`
    await ctx.memory.delete(scope, key)
    return `Memory deleted: ${scope}/${key}`
  },
}
