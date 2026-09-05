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

  let tools = 0
  const tagged: AgentLoopEvents = {
    onToken: (token, nestedAgentId) => parent.onToken(token, agentId(nestedAgentId)),
    onToolStart: (toolCallId, name, input, nestedAgentId) => {
      if (!nestedAgentId) tools++
      parent.onToolStart(toolCallId, name, input, agentId(nestedAgentId))
    },
    onToolEnd: (toolCallId, name, result, ok, nestedAgentId) => parent.onToolEnd(toolCallId, name, result, ok, agentId(nestedAgentId)),
    onToolPrompt: async (id, name, input, risk, reason, nestedAgentId) => {
      const effectiveAgentId = agentId(nestedAgentId)
      if (effectiveAgentId) parent.onAgentState?.(effectiveAgentId, 'waiting_approval', name)
      try {
        return await parent.onToolPrompt(id, name, input, risk, reason, effectiveAgentId)
      } finally {
        if (effectiveAgentId) parent.onAgentState?.(effectiveAgentId, 'running')
      }
    },
    // A child has its own lifecycle; its session_end must not masquerade as root.
    onSessionEnd: () => {},
  }
  if (compatible && parent.onToolParked) tagged.onToolParked = (toolCallId, name, input, nestedAgentId) => parent.onToolParked!(toolCallId, name, input, agentId(nestedAgentId))
  if (compatible && parent.onInputRequest) tagged.onInputRequest = async (id, prompt, kind, options, nestedAgentId) => {
    const effectiveAgentId = agentId(nestedAgentId)
    if (effectiveAgentId) parent.onAgentState?.(effectiveAgentId, 'waiting_input')
    try {
      return await parent.onInputRequest!(id, prompt, kind, options, effectiveAgentId)
    } finally {
      if (effectiveAgentId) parent.onAgentState?.(effectiveAgentId, 'running')
    }
  }
  if (parent.onStats) tagged.onStats = (tokensIn, tokensOut, cost, contextTokens, nestedAgentId, usage) => parent.onStats?.(tokensIn, tokensOut, cost, contextTokens, agentId(nestedAgentId), usage)
  if (compatible && parent.onNotice) tagged.onNotice = (level, message, detail, nestedAgentId) => parent.onNotice!(level, message, detail, agentId(nestedAgentId))
  if (compatible && parent.onArtifacts) tagged.onArtifacts = (sessionId, artifacts, nestedAgentId) => parent.onArtifacts!(sessionId, artifacts, agentId(nestedAgentId))
  if (compatible && parent.onTodosUpdate) tagged.onTodosUpdate = (todos, nestedAgentId) => parent.onTodosUpdate!(todos, agentId(nestedAgentId))
  if (compatible && parent.onCodeExecute) tagged.onCodeExecute = (id, code, language, data, nestedAgentId) => parent.onCodeExecute!(id, code, language, data, agentId(nestedAgentId))
  if (compatible && parent.onRenderUI) tagged.onRenderUI = (surface, nestedAgentId) => parent.onRenderUI!(surface, agentId(nestedAgentId))
  if (compatible && parent.onStage) tagged.onStage = (stage, intensity, tier, model, state, cost, nestedAgentId) => parent.onStage!(stage, intensity, tier, model, state, cost, agentId(nestedAgentId))
  if (compatible && parent.onAgentSpawn) tagged.onAgentSpawn = parent.onAgentSpawn
  if (compatible && parent.onAgentEnd) tagged.onAgentEnd = parent.onAgentEnd
  if (compatible && parent.onAgentMessage) tagged.onAgentMessage = parent.onAgentMessage
  if (compatible && parent.onAgentState) tagged.onAgentState = (nestedAgentId, state, tool) => {
    const effectiveAgentId = agentId(nestedAgentId)
    if (effectiveAgentId) parent.onAgentState!(effectiveAgentId, state, tool)
  }
  if (compatible && parent.onAgentStats) tagged.onAgentStats = (nestedAgentId, tokensIn, tokensOut, cost, nestedTools, usage) => {
    const effectiveAgentId = agentId(nestedAgentId)
    if (effectiveAgentId) parent.onAgentStats!(effectiveAgentId, tokensIn, tokensOut, cost, nestedTools, usage)
  }
  if (compatible && parent.onAgentStats && parent.onStats) {
    tagged.onStats = (tokensIn, tokensOut, cost, contextTokens, nestedAgentId, usage) => {
      parent.onStats!(tokensIn, tokensOut, cost, contextTokens, agentId(nestedAgentId), usage)
      const effectiveAgentId = agentId(nestedAgentId)
      if (effectiveAgentId && !nestedAgentId) parent.onAgentStats!(effectiveAgentId, tokensIn, tokensOut, cost, tools, usage)
    }
  }
  return tagged
}
