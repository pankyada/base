import { ToolDefinition, ToolContext } from '../types.js'

export const memoryWriteTool: ToolDefinition = {
  name: 'MemoryWrite',
  description: 'Write a memory entry. "user" scope (default) is private to this user. "profile" scope is shared across all users. "session" scope is in-memory only. "project" scope is shared across sessions in the current project.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['session', 'profile', 'user', 'project'],
        description: 'Defaults to "user" (private). Use "profile" to share with all users. "project" is shared across sessions in the current project.',
      },
      key: { type: 'string', description: 'Short slug (e.g. project-context)' },
      content: { type: 'string', description: 'Markdown content to store' },
      links: {
        type: 'array',
        description: 'Optional links to other memories to form a graph',
        items: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Key of the target memory' },
            relation: { type: 'string', description: 'Relationship type (e.g., depends_on, relates_to)' }
          },
          required: ['target']
        }
      },
      valid_from: { type: 'string', description: 'ISO-8601 validity start with offset' },
      valid_until: { type: 'string', description: 'ISO-8601 validity end with offset' },
      recur: { type: 'string', description: 'Bounded RRULE subset' },
      timezone: { type: 'string', description: 'IANA timezone for DST-safe wall-clock recurrence' },
      entity: { type: 'string', description: 'Stable entity identifier for supersession' },
      confidence: { type: 'number', description: 'Confidence from 0 to 1' },
      supersedes: { type: 'string', description: 'Key of superseded memory' },
      claim: { type: 'object', description: 'Optional structured claim metadata for conflict detection', properties: { entity: { type: 'string' }, predicate: { type: 'string' }, normalized_value: { type: 'string' }, source_evidence: { type: 'array', items: { type: 'string' } }, last_verified_at: { type: 'string' } }, required: ['entity', 'predicate'] },
    },
    required: ['key', 'content'],
  },
  async execute(input, ctx: ToolContext) {
    const { key, content, links, valid_from, valid_until, recur, timezone, entity, confidence, supersedes, claim } = input as { key: string; content: string; links?: { target: string, relation?: string }[]; valid_from?: string; valid_until?: string; recur?: string; timezone?: string; entity?: string; confidence?: number; supersedes?: string; claim?: { entity: string; predicate: string; normalized_value?: string; source_evidence?: string[]; last_verified_at?: string } }
    const scope = ((input as any).scope ?? 'user') as 'session' | 'profile' | 'user' | 'project'
    const temporal = { valid_from, valid_until, recur, timezone, entity, confidence, supersedes }
    const before = typeof ctx.memory.read === 'function' ? await ctx.memory.read(scope, key) : null
    await ctx.memory.write(scope, key, content, links, Object.values(temporal).some(value => value !== undefined) ? temporal : undefined, {
      tainted: (ctx.taintSources?.length ?? 0) > 0,
      source: ctx.taintSources?.[0],
    }, claim)
    return {
      content: `Memory written: ${scope}/${key}${links?.length ? ` (with ${links.length} links)` : ''}`,
      undo: { kind: 'memory_restore', payload: { scope, key, before, project: ctx.session?.project } },
    }
  },
}
