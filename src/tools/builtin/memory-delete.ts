import { ToolDefinition, ToolContext } from '../types.js'

export const memoryDeleteTool: ToolDefinition = {
  name: 'MemoryDelete',
  description: 'Delete a memory entry by key. Scopes: session, profile (shared), user (private), project (project-scoped).',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile', 'user', 'project'] },
      key: { type: 'string', description: 'Key to delete' },
    },
    required: ['scope', 'key'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope, key } = input as { scope: 'session' | 'profile' | 'user' | 'project'; key: string }
    const existing = await ctx.memory.read(scope, key)
    if (existing === null) return `No memory entry found for key: ${key} (scope: ${scope})`
    await ctx.memory.delete(scope, key)
    return { content: `Memory deleted: ${scope}/${key}`, undo: { kind: 'memory_restore', payload: { scope, key, before: existing, project: ctx.session.project } } }
  },
}
