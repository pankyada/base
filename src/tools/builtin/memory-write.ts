import { ToolDefinition, ToolContext } from '../types.js'

export const memoryWriteTool: ToolDefinition = {
  name: 'MemoryWrite',
  description: 'Write a memory entry. "user" scope (default) is private to this user. "profile" scope is shared across all users. "session" scope is in-memory only.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['session', 'profile', 'user'],
        description: 'Defaults to "user" (private). Use "profile" to share with all users.',
      },
      key: { type: 'string', description: 'Short slug (e.g. project-context)' },
      content: { type: 'string', description: 'Markdown content to store' },
    },
    required: ['key', 'content'],
  },
  async execute(input, ctx: ToolContext) {
    const { key, content } = input as { key: string; content: string }
    const scope = ((input as any).scope ?? 'user') as 'session' | 'profile' | 'user'
    await ctx.memory.write(scope, key, content)
    return `Memory written: ${scope}/${key}`
  },
}
