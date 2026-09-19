import type { ToolDefinition, ToolContext } from '../types.js'

export const memoryReviewTool: ToolDefinition = {
  name: 'MemoryReview',
  description: 'Run the configured reversible retention review for a memory scope. Archived records remain restorable.',
  parameters: { type: 'object', properties: { scope: { type: 'string', enum: ['session', 'profile', 'user', 'project'] } }, required: ['scope'] },
  async execute(input, ctx: ToolContext) {
    if (!ctx.memoryRetention) return 'Memory retention review is disabled for this profile.'
    const scope = ((input as any).scope ?? 'user') as 'session' | 'profile' | 'user' | 'project'
    const archived = await ctx.memoryRetention.retain(ctx.memory, scope, await ctx.memory.list(scope))
    return { content: archived.length ? `Memory review archived: ${archived.join(', ')}` : 'Memory review found no entries to archive.' }
  },
}
