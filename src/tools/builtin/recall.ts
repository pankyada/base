import type { ToolDefinition, ToolContext } from '../types.js'
import type { MemoryScope, RecallQuery } from '../../memory/interface.js'

export const recallTool: ToolDefinition = {
  name: 'Recall',
  description: 'Find memories true at a time or during a time window. Filters by entity, relation, and text; superseded facts collapse to the current valid fact.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile', 'user', 'project'], description: 'Defaults to user memory.' },
      at: { type: 'string', description: 'ISO-8601 instant with offset; defaults to now.' },
      window: { type: 'string', description: 'next 7d, last 30d, or an ISO range joined with ..' },
      entity: { type: 'string', description: 'Exact entity or prefix ending in /' },
      relation: { type: 'string', description: 'Filter linked memories by relation' },
      text: { type: 'string', description: 'Lexical filter' },
      limit: { type: 'number', description: 'Maximum results, default 20' },
    },
  },
  async execute(input, ctx: ToolContext) {
    const scope = (input.scope ?? 'user') as MemoryScope
    const query: RecallQuery = {
      at: typeof input.at === 'string' ? input.at : undefined,
      window: typeof input.window === 'string' ? input.window : undefined,
      entity: typeof input.entity === 'string' ? input.entity : undefined,
      relation: typeof input.relation === 'string' ? input.relation : undefined,
      text: typeof input.text === 'string' ? input.text : undefined,
      limit: typeof input.limit === 'number' ? input.limit : undefined,
    }
    const entries = await ctx.memory.query(scope, query)
    if (!entries.length) return `(no memories match in ${scope} scope)`
    return entries.map(entry => {
      const temporal = entry.temporal
      const timing = temporal?.valid_from || temporal?.valid_until || temporal?.recur
        ? ` [${temporal?.valid_from ?? '−∞'} → ${temporal?.valid_until ?? '∞'}${temporal?.recur ? `; ${temporal.recur}${temporal.timezone ? ` (${temporal.timezone})` : ''}` : ''}]`
        : ''
      return `- **${entry.key}**${timing}: ${entry.content ?? entry.preview}`
    }).join('\n')
  },
}
