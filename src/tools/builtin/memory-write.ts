import { ToolDefinition, ToolContext } from '../types.js'

export const memoryWriteTool: ToolDefinition = {
  name: 'MemoryWrite',
  description: 'Write a memory entry. Profile scope persists to disk across sessions.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile'] },
      key: { type: 'string', description: 'Short slug (e.g. project-context)' },
      content: { type: 'string', description: 'Markdown content to store' },
    },
    required: ['scope', 'key', 'content'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope, key, content } = input as { scope: 'session' | 'profile'; key: string; content: string }
    await ctx.memory.write(scope, key, content)
    return `Memory written: ${scope}/${key}`
  },
}
