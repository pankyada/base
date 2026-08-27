import { describe, expect, it, vi } from 'vitest'
import { tagEvents } from '../src/agents/events.js'
import { createRootFrame, newAgentId } from '../src/agents/frames.js'
import type { AgentLoopEvents } from '../src/tools/types.js'

function parentEvents(messages: unknown[]): AgentLoopEvents {
  return {
    onToken: (content, agentId) => messages.push({ type: 'token', content, ...(agentId ? { agent_id: agentId } : {}) }),
    onToolStart: (id, name, input, agentId) => messages.push({ type: 'tool_start', id, name, input, ...(agentId ? { agent_id: agentId } : {}) }),
    onToolEnd: (id, name, result, ok, agentId) => messages.push({ type: 'tool_end', id, name, result, ok, ...(agentId ? { agent_id: agentId } : {}) }),
    onToolPrompt: async (id, name, input, _risk, _reason, agentId) => {
      messages.push({ type: 'tool_prompt', id, name, input, ...(agentId ? { agent_id: agentId } : {}) })
      return true
    },
    onSessionEnd: () => {},
    onStats: (tokensIn, tokensOut, cost, _contextTokens, agentId) => messages.push({ type: 'stats', tokensIn, tokensOut, cost, ...(agentId ? { agent_id: agentId } : {}) }),
    onAgentSpawn: (frame, input) => messages.push({ type: 'agent_spawn', frame, input }),
    onAgentEnd: (agentId, status, error, output, durationMs) => messages.push({ type: 'agent_end', agentId, status, error, output, durationMs }),
  }
}

describe('agent frames', () => {
  it('tags every delegated event while root events remain untagged', async () => {
    const messages: unknown[] = []
    const parent = parentEvents(messages)
    const frame = { ...createRootFrame('research', 'root-session'), agent_id: 'ag_child', agent_name: 'researcher', parent_agent_id: 'root', depth: 1, origin: 'model', profile: 'researcher', session_id: 'child-session' } as const
    const tagged = tagEvents(parent, frame)

    parent.onToken('root token')
    tagged.onToken('child token')
    tagged.onToolStart('tool-1', 'Read', { path: 'x' })
    tagged.onToolEnd('tool-1', 'Read', 'ok', true)
    await tagged.onToolPrompt('tool-2', 'Bash', { command: 'pwd' })
    tagged.onStats?.(1, 2, 0.03)

    expect(messages).toEqual([
      { type: 'token', content: 'root token' },
      { type: 'token', content: 'child token', agent_id: 'ag_child' },
      { type: 'tool_start', id: 'tool-1', name: 'Read', input: { path: 'x' }, agent_id: 'ag_child' },
      { type: 'tool_end', id: 'tool-1', name: 'Read', result: 'ok', ok: true, agent_id: 'ag_child' },
      { type: 'tool_prompt', id: 'tool-2', name: 'Bash', input: { command: 'pwd' }, agent_id: 'ag_child' },
      { type: 'stats', tokensIn: 1, tokensOut: 2, cost: 0.03, agent_id: 'ag_child' },
    ])
  })

  it('keeps protocol-2 output byte-identical and suppresses fleet messages', async () => {
    const messages: unknown[] = []
    const tagged = tagEvents(parentEvents(messages), {
      ...createRootFrame('research', 'root-session'),
      agent_id: 'ag_child',
      agent_name: 'researcher',
      parent_agent_id: 'root',
      depth: 1,
      origin: 'model',
      profile: 'researcher',
      session_id: 'child-session',
    }, 2)

    tagged.onToken('child token')
    tagged.onToolStart('tool-1', 'Read', {})
    await tagged.onToolPrompt('tool-2', 'Bash', {})
    tagged.onStats?.(1, 2, 0.03)
    tagged.onAgentSpawn?.(createRootFrame('researcher', 'child-session'), {})
    tagged.onAgentEnd?.('ag_child', 'completed', undefined, { ok: true }, 12)

    expect(messages.map(message => JSON.stringify(message))).toEqual([
      '{"type":"token","content":"child token"}',
      '{"type":"tool_start","id":"tool-1","name":"Read","input":{}}',
      '{"type":"tool_prompt","id":"tool-2","name":"Bash","input":{}}',
      '{"type":"stats","tokensIn":1,"tokensOut":2,"cost":0.03}',
    ])
  })

  it('generates short agent ids and a real root frame', () => {
    expect(newAgentId()).toMatch(/^ag_[a-f0-9]{4}$/)
    expect(createRootFrame('research', 'session-1')).toEqual({
      agent_id: 'root',
      agent_name: 'root',
      parent_agent_id: 'root',
      depth: 0,
      origin: 'model',
      profile: 'research',
      session_id: 'session-1',
    })
  })

  it('preserves the deepest child id through nested taggers', () => {
    const onToken = vi.fn()
    const parent: AgentLoopEvents = {
      onToken,
      onToolStart: vi.fn(),
      onToolEnd: vi.fn(),
      onToolPrompt: vi.fn().mockResolvedValue(true),
      onSessionEnd: vi.fn(),
    }
    const first = tagEvents(parent, { ...createRootFrame('one', 's1'), agent_id: 'ag_one', agent_name: 'one', parent_agent_id: 'root', depth: 1, origin: 'model', profile: 'one', session_id: 's1' })
    const second = tagEvents(first, { ...createRootFrame('two', 's2'), agent_id: 'ag_two', agent_name: 'two', parent_agent_id: 'ag_one', depth: 2, origin: 'model', profile: 'two', session_id: 's2' })

    second.onToken('deep')

    expect(onToken).toHaveBeenCalledWith('deep', 'ag_two')
  })
})
