import type { BulletinKind } from '../../agents/bulletin.js'
import type { ToolDefinition } from '../types.js'

export const postTool: ToolDefinition = {
  name: 'Post',
  description: 'Pin a concise note, question, handoff, or result on the session bulletin board.',
  parameters: { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' }, to: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: ['post', 'ask', 'answer', 'handoff', 'standup'] }, artifact_ids: { type: 'array', items: { type: 'string' } } }, required: ['subject', 'body'] },
  async execute(input, context) {
    if (!context.bulletin) return 'Error: bulletin board is unavailable for this session'
    const frame = context.agentFrame
    const post = context.bulletin.post({
      session_id: context.session.id, from_agent_id: frame?.agent_id ?? 'root', from_agent_name: frame?.agent_name ?? context.profile.name,
      to: Array.isArray(input.to) && input.to.every(value => typeof value === 'string') ? input.to : 'all',
      kind: (typeof input.kind === 'string' ? input.kind : 'post') as BulletinKind,
      subject: typeof input.subject === 'string' ? input.subject : '', body: typeof input.body === 'string' ? input.body : '',
      artifact_ids: Array.isArray(input.artifact_ids) ? input.artifact_ids.filter((value): value is string => typeof value === 'string') : undefined,
      tainted: (context.taintSources?.length ?? 0) > 0, taint_sources: context.taintSources,
    }, `${frame?.agent_id ?? 'root'}:${context.session.messages.length}`)
    context.events.onAgentMessage?.(post)
    return `Posted #${post.seq}: ${post.subject}`
  },
}
