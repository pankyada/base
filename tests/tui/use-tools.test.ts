import { describe, it, expect } from 'vitest'
import { toolsReducer, ToolEntry } from '../../src/tui/hooks/use-tools.js'

describe('toolsReducer', () => {
  it('adds running entry on tool_start', () => {
    const next = toolsReducer([], { event: 'start', name: 'Read', input: {} })
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ name: 'Read', status: 'running' })
  })

  it('updates entry to ok on tool_end', () => {
    let state = toolsReducer([], { event: 'start', name: 'Read', input: {} })
    state = toolsReducer(state, { event: 'end', name: 'Read', ok: true, duration_ms: 34 })
    expect(state[0]).toMatchObject({ name: 'Read', status: 'ok', duration_ms: 34 })
  })

  it('updates entry to err on failed tool_end', () => {
    let state = toolsReducer([], { event: 'start', name: 'Bash', input: {} })
    state = toolsReducer(state, { event: 'end', name: 'Bash', ok: false, duration_ms: 10 })
    expect(state[0]).toMatchObject({ name: 'Bash', status: 'err' })
  })

  it('caps at 20 entries', () => {
    let state: ToolEntry[] = []
    for (let i = 0; i < 25; i++) {
      state = toolsReducer(state, { event: 'start', name: `Tool${i}`, input: {} })
      state = toolsReducer(state, { event: 'end', name: `Tool${i}`, ok: true, duration_ms: 1 })
    }
    expect(state.length).toBeLessThanOrEqual(20)
  })
})
