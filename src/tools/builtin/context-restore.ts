import type { ToolDefinition } from '../types.js'
import { logEvent } from '../../telemetry/logger.js'

export const contextRestoreTool: ToolDefinition = {
  name: 'ContextRestore',
  description: 'Restore the full result of an earlier tool call by its id. Use offset and limit for large results.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The tool_call_id from an elided tool result' },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1 },
    },
    required: ['id'],
  },
  async execute(input, ctx) {
    const { id, offset = 0, limit } = input as { id: string; offset?: number; limit?: number }
    const stored = ctx.session.tool_calls.find(call => call.id === id)
    if (!stored) return `Tool result "${id}" not available in this session.`
    if (ctx.events) {
      logEvent({ session: ctx.session.id, profile: ctx.profile?.name ?? ctx.session.profile, kind: 'tool', name: 'ContextRestore', restore_calls: 1, ok: true })
    }

    const start = Math.max(0, Math.floor(offset))
    const safeLimit = limit === undefined ? undefined : Math.max(0, Math.floor(limit))
    const result = stored.result
    const content = safeLimit === undefined ? result.slice(start) : result.slice(start, start + safeLimit)
    const remaining = Math.max(0, result.length - start - content.length)
    return remaining > 0 ? `${content}\n[… ${remaining} chars remain]` : content
  },
}
