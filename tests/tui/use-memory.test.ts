import { describe, it, expect } from 'vitest'
import { memoryReducer, MemoryKey } from '../../src/tui/hooks/use-memory.js'

describe('memoryReducer', () => {
  it('adds new key marked isNew', () => {
    const next = memoryReducer([], { event: 'write', key: 'project-context' })
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ key: 'project-context', isNew: true })
  })

  it('marks existing key as new again on re-write', () => {
    let state = memoryReducer([], { event: 'write', key: 'project-context' })
    state = memoryReducer(state, { event: 'age', key: 'project-context' })
    expect(state[0].isNew).toBe(false)
    state = memoryReducer(state, { event: 'write', key: 'project-context' })
    expect(state[0].isNew).toBe(true)
  })

  it('does not duplicate keys', () => {
    let state = memoryReducer([], { event: 'write', key: 'foo' })
    state = memoryReducer(state, { event: 'write', key: 'foo' })
    expect(state).toHaveLength(1)
  })

  it('ages key to not-new', () => {
    let state = memoryReducer([], { event: 'write', key: 'bar' })
    state = memoryReducer(state, { event: 'age', key: 'bar' })
    expect(state[0].isNew).toBe(false)
  })
})
