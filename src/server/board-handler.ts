import type { AgentFrame, ClientMessage } from '../types.js'
import type { Bulletin, BulletinPost } from '../agents/bulletin.js'

export interface BoardPostContext {
  bulletin: Bulletin
  sessionId: string
  profileName: string
  agentFrame?: AgentFrame
  /** IDs currently owned by this live session. Targeted posts fail closed without this set. */
  recipientAgentIds?: ReadonlySet<string>
  /** Stable run/turn binding; Bulletin enforces five posts per binding. */
  turnKey: string
  taintSources?: string[]
  onAgentMessage?: (post: BulletinPost) => void
}

/** Route an operator board post through the same Bulletin bounds as Post tool. */
export function postBoardMessage(
  message: Extract<ClientMessage, { type: 'board_post' }>,
  context: BoardPostContext,
): BulletinPost {
  const frame = context.agentFrame
  if (typeof message.subject !== 'string') throw new Error('board post refused: subject must be a string')
  if (typeof message.body !== 'string') throw new Error('board post refused: body must be a string')
  if (typeof context.turnKey !== 'string' || context.turnKey.length === 0) throw new Error('board post refused: turn key is required')
  const recipients = message.to === undefined
    ? 'all' as const
    : Array.isArray(message.to) && message.to.every(value => typeof value === 'string' && value.length > 0)
      ? message.to
      : (() => { throw new Error('board post refused: recipients must be an array of agent IDs') })()
  if (recipients !== 'all') {
    if (recipients.length > 32) throw new Error('board post refused: at most 32 recipients are allowed')
    if (recipients.some(agentId => agentId.length > 256)) throw new Error('board post refused: recipient IDs must be at most 256 characters')
    if (!context.recipientAgentIds) throw new Error('board post refused: recipient ownership unavailable')
    const unknown = recipients.find(agentId => !context.recipientAgentIds!.has(agentId))
    if (unknown) throw new Error(`board post refused: recipient "${unknown}" is not active in this session`)
  }
  const post = context.bulletin.post({
    session_id: context.sessionId,
    from_agent_id: frame?.agent_id ?? 'root',
    from_agent_name: frame?.agent_name ?? context.profileName,
    to: recipients,
    kind: 'post',
    subject: message.subject,
    body: message.body,
    tainted: (context.taintSources?.length ?? 0) > 0,
    taint_sources: context.taintSources,
  }, context.turnKey)
  context.onAgentMessage?.(post)
  return post
}
