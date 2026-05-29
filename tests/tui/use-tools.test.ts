import { describe, it, expect } from 'vitest'
import { toolsReducer, ToolEntry } from '../../src/tui/hooks/use-tools.js'

describe('toolsReducer', () => {
  it('adds running entry on start', () => {
    const next = toolsReducer([], { event: 'start', name: 'Read' })
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ name: 'Read', status: 'running' })
  })

  it('updates entry to ok on end', () => {
    let state = toolsReducer([], { event: 'start', name: 'Read' })
    state = toolsReducer(state, { event: 'end', name: 'Read', ok: true })
    expect(state[0]).toMatchObject({ name: 'Read', status: 'ok' })
    expect(state[0].duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('updates entry to err on failed end', () => {
    let state = toolsReducer([], { event: 'start', name: 'Bash' })
    state = toolsReducer(state, { event: 'end', name: 'Bash', ok: false })
    expect(state[0]).toMatchObject({ name: 'Bash', status: 'err' })
  })

  it('caps at 20 entries', () => {
    let state: ToolEntry[] = []
    for (let i = 0; i < 25; i++) {
      state = toolsReducer(state, { event: 'start', name: `Tool${i}` })
      state = toolsReducer(state, { event: 'end', name: `Tool${i}`, ok: true })
    }
    expect(state.length).toBeLessThanOrEqual(20)
  })

  it('computes duration_ms from ts on end', () => {
    const state = toolsReducer([], { event: 'start', name: 'Edit' })
    const ended = toolsReducer(state, { event: 'end', name: 'Edit', ok: true })
    expect(typeof ended[0].duration_ms).toBe('number')
  })
})
