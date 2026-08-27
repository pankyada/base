import { randomUUID } from 'crypto'
import type { AgentFrame } from '../types.js'

export type { AgentFrame } from '../types.js'

export function newAgentId(): string {
  return `ag_${randomUUID().replace(/-/g, '').slice(0, 4)}`
}

export function createRootFrame(profile: string, sessionId: string): AgentFrame {
  return {
    agent_id: 'root',
    agent_name: 'root',
    parent_agent_id: 'root',
    depth: 0,
    origin: 'model',
    profile,
    session_id: sessionId,
  }
}

export const rootFrame = createRootFrame

export function createAgentFrame(params: {
  agentName: string
  parent?: AgentFrame
  profile: string
  sessionId: string
  origin?: AgentFrame['origin']
  depth?: number
}): AgentFrame {
  return {
    agent_id: newAgentId(),
    agent_name: params.agentName,
    parent_agent_id: params.parent?.agent_id ?? 'root',
    depth: params.depth ?? (params.parent ? params.parent.depth + 1 : 1),
    origin: params.origin ?? 'model',
    profile: params.profile,
    session_id: params.sessionId,
  }
}
