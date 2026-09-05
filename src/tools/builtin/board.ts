import type { ToolDefinition } from '../types.js'

export const boardTool: ToolDefinition = {
  name: 'Board',
  description: 'Read bulletin-board posts addressed to this agent or the whole team.',
  parameters: { type: 'object', properties: { since_seq: { type: 'number' }, mine_only: { type: 'boolean' }, subject_contains: { type: 'string' }, limit: { type: 'number' } } },
  async execute(input, context) {
    if (!context.bulletin) return 'Error: bulletin board is unavailable for this session'
    const posts = context.bulletin.read(context.agentFrame?.agent_id ?? 'root', { sinceSeq: typeof input.since_seq === 'number' ? input.since_seq : undefined, mineOnly: input.mine_only === true, subjectContains: typeof input.subject_contains === 'string' ? input.subject_contains : undefined, limit: typeof input.limit === 'number' ? input.limit : undefined })
    if (!posts.length) return '(no board posts match)'
    const content = posts.map(post => `#${post.seq} ${post.from_agent_name}: ${post.subject}\n${post.body}`).join('\n\n')
    const tainted = posts.filter(post => post.tainted)
    return tainted.length ? { content, provenance: 'untrusted' as const, source: `tainted board posts: ${tainted.map(post => `#${post.seq}`).join(', ')}` } : content
  },
}
