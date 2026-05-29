import { ToolDefinition, ToolContext } from '../types.js'

export const memoryLinkedTool: ToolDefinition = {
  name: 'MemoryLinked',
  description: 'Find memory entries related to a given key. Returns entries that the key links TO, and entries that link FROM other nodes TO this key. Useful for graph traversal.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile', 'user'] },
      key: { type: 'string', description: 'The memory key to find related entries for' },
      relation: { type: 'string', description: 'Optional: filter by relation type (e.g. depends_on, relates_to)' },
    },
    required: ['scope', 'key'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope, key } = input as { scope: 'session' | 'profile' | 'user'; key: string; relation?: string }
    const relation = (input as any).relation as string | undefined

    // Forward: what does this key link to?
    const node = await ctx.memory.read(scope, key)
    const forwardLinks = node?.links?.filter(l => !relation || l.relation === relation) ?? []

    // Reverse: what links TO this key?
    const all = await ctx.memory.list(scope)
    const reverseLinks = all.filter(e =>
      e.key !== key &&
      e.links?.some(l => l.target === key && (!relation || l.relation === relation))
    )

    if (forwardLinks.length === 0 && reverseLinks.length === 0) {
      return `No linked memories found for key: ${key}${relation ? ` (relation: ${relation})` : ''}`
    }

    const lines: string[] = []

    if (forwardLinks.length > 0) {
      lines.push(`**${key} links to:**`)
      lines.push(...forwardLinks.map(l => `  - ${l.target}${l.relation ? ` (${l.relation})` : ''}`))
    }

    if (reverseLinks.length > 0) {
      lines.push(`**Links to ${key}:**`)
      lines.push(...reverseLinks.map(e => {
        const matchingLinks = e.links!.filter(l => l.target === key && (!relation || l.relation === relation))
        return `  - ${e.key}${matchingLinks[0].relation ? ` (${matchingLinks[0].relation})` : ''}`
      }))
    }

    return lines.join('\n')
  },
}
