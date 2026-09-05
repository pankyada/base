import { describe, expect, it } from 'vitest'
import { initialScene, reduce } from '../src/scene/reducer.js'
import type { ServerMessage } from '../src/protocol.js'

const frame = { agent_id: 'ag_research', agent_name: 'researcher', parent_agent_id: 'root', depth: 1, origin: 'model' as const, profile: 'research', session_id: 's1' }

describe('scene reducer', () => {
  it('keeps a seat stable, routes activity, queues prompts, and frees seat on end', () => {
    const messages: ServerMessage[] = [
      { type: 'agent_spawn', frame, input: {} },
      { type: 'tool_start', id: 't1', name: 'Grep', input: {}, agent_id: 'ag_research' },
      { type: 'tool_prompt', id: 't2', name: 'Bash', input: { command: 'rm -rf /tmp/x' }, risk: 'danger', agent_id: 'ag_research' },
      { type: 'agent_end', agent_id: 'ag_research', status: 'completed', duration_ms: 20 },
    ]
    const state = messages.reduce(reduce, initialScene())
    expect(state.seats.ag_research).toBe(0)
    expect(state.workers.ag_research.room).toBe('gate')
    expect(state.workers.ag_research.activity).toBe('done')
    expect(state.queue).toEqual([{ id: 't2', kind: 'tool_prompt', agent_id: 'ag_research', name: 'Bash', input: { command: 'rm -rf /tmp/x' }, risk: 'danger' }])
    expect(state.freeSeats).toEqual([0])
  })

  it('snapshot followed by tail equals full history', () => {
    const spawn: ServerMessage = { type: 'agent_spawn', frame, input: {} }
    const activity: ServerMessage = { type: 'tool_start', id: 't1', name: 'WebFetch', input: {}, agent_id: 'ag_research' }
    const beforeTail = reduce(reduce(initialScene(), spawn), activity)
    const snapshot: ServerMessage = { type: 'fleet_snapshot', frames: [frame], states: [{ agent_id: 'ag_research', state: 'running', tool: 'WebFetch', since: 0, spend_usd: 0, tools: 1 }], board: [], queue: [], feed: beforeTail.feed }
    const tail: ServerMessage = { type: 'agent_end', agent_id: 'ag_research', status: 'completed', duration_ms: 1 }
    expect(reduce(reduce(reduce(initialScene(), spawn), activity), tail)).toEqual(reduce(reduce(initialScene(), snapshot), tail))
  })

  it('retains challenge records for Board verification controls', () => {
    const challenge: ServerMessage = { type: 'challenge', challenge: { id: 'c1', mission_id: 'm1', challenger: 'reviewer', question: 'Show receipt evidence', state: 'open', round: 1, cost_usd: 0, evidence_count: 0, resolution_evidence_count: 0 } }
    const state = reduce(initialScene(), challenge)
    expect(state.challenges[0]).toMatchObject({ id: 'c1', state: 'open', question: 'Show receipt evidence' })
  })
})
