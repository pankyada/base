import type { AgentFrame } from './frames.js'
import type { AgentLoopEvents } from '../tools/types.js'

/** Add child identity at the single delegation boundary. */
export function tagEvents(parent: AgentLoopEvents, frame: AgentFrame, protocolVersion?: number): AgentLoopEvents {
  const negotiatedVersion = protocolVersion ?? (parent as AgentLoopEvents & { protocolVersion?: number }).protocolVersion ?? 3
  const compatible = negotiatedVersion >= 3
  const agentId = (nestedAgentId?: string): string | undefined => {
    if (!compatible) return undefined
    if (nestedAgentId && nestedAgentId !== 'root') return nestedAgentId
    return frame.agent_id === 'root' ? undefined : frame.agent_id
  }

  const tagged: AgentLoopEvents = {
    onToken: (token, nestedAgentId) => parent.onToken(token, agentId(nestedAgentId)),
    onToolStart: (toolCallId, name, input, nestedAgentId) => parent.onToolStart(toolCallId, name, input, agentId(nestedAgentId)),
    onToolEnd: (toolCallId, name, result, ok, nestedAgentId) => parent.onToolEnd(toolCallId, name, result, ok, agentId(nestedAgentId)),
    onToolPrompt: (id, name, input, risk, reason, nestedAgentId) => parent.onToolPrompt(id, name, input, risk, reason, agentId(nestedAgentId)),
    // A child has its own lifecycle; its session_end must not masquerade as root.
    onSessionEnd: () => {},
  }
  if (parent.onStats) tagged.onStats = (tokensIn, tokensOut, cost, contextTokens, nestedAgentId) => parent.onStats?.(tokensIn, tokensOut, cost, contextTokens, agentId(nestedAgentId))
  if (compatible && parent.onAgentSpawn) tagged.onAgentSpawn = parent.onAgentSpawn
  if (compatible && parent.onAgentEnd) tagged.onAgentEnd = parent.onAgentEnd
  return tagged
}
