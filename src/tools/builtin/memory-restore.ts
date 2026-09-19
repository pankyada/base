import { ToolDefinition, ToolContext } from '../types.js'
import type { MemoryCaptureService } from '../../decisions/memory.js'

export const memoryRestoreTool: ToolDefinition = {
  name: 'MemoryRestore',
  description: 'Restore an archived memory entry by stable key. This is reversible retention state, not deletion recovery.',
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
    const existing = await ctx.memory.read(scope, key)
    if (!existing) return `(no memory entry for key: ${key})`
    const capture = (ctx as ToolContext & { memoryCapture?: MemoryCaptureService }).memoryCapture
    if (capture) await capture.restore(ctx.memory, scope, key)
    else if (ctx.memory.restore) await ctx.memory.restore(scope, key)
    else return 'Memory provider does not support restore.'
    return { content: `Memory restored: ${scope}/${key}`, undo: { kind: 'memory_restore', payload: { scope, key, before: existing, project: ctx.session.project } } }
  },
}
