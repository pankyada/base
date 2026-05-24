import { ToolDefinition, ToolContext } from '../types.js'
import { queryEvents, summarize } from '../../telemetry/query.js'

export const statsTool: ToolDefinition = {
  name: 'Stats',
  description: 'Show usage stats: top tools, skills, MCP calls, and cost breakdown.',
  parameters: {
    type: 'object',
    properties: {
      since_days: { type: 'number', description: 'Show stats for last N days (default 7)' },
      profile: { type: 'string', description: 'Filter by profile (default: current profile)' },
    },
    required: [],
  },
  async execute(input, ctx: ToolContext) {
    const { since_days = 7, profile } = input as { since_days?: number; profile?: string }
    const since = new Date(Date.now() - since_days * 24 * 60 * 60 * 1000)
    const events = queryEvents({ profile: profile ?? ctx.profile.name, since })
    return summarize(events)
  },
}
