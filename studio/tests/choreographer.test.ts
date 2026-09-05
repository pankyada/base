import { describe, expect, it } from 'vitest'
import { choreograph } from '../src/scene/choreographer.js'
import { initialScene } from '../src/scene/reducer.js'

describe('choreographer', () => {
  it('caps a burst and fast-forwards instead of queueing stale motion', () => {
    const before = initialScene()
    const workers = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`a${index}`, { frame: { agent_id: `a${index}`, agent_name: 'agent', parent_agent_id: 'root', depth: 1, origin: 'model' as const, profile: 'x', session_id: 's' }, activity: 'calling' as const, label: 'thinking' as const, room: 'mailroom' as const, since: 0, spend_usd: 0, tools: 0, tainted: false }]))
    expect(choreograph(before, { ...before, workers }, 10)).toHaveLength(6)
    expect(choreograph(before, { ...before, workers }, 10)[0].kind).toBe('snap')
  })
})
