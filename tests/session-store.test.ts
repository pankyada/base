import { describe, it, expect } from 'vitest'
import { createSession, saveSession, loadSession } from '../src/session/store.js'

describe('session store', () => {
  it('creates session with id and profile', () => {
    const s = createSession('coding')
    expect(s.id).toHaveLength(8)
    expect(s.profile).toBe('coding')
    expect(s.messages).toEqual([])
    expect(s.usage.cost_usd).toBe(0)
  })

  it('saves and loads session by id', () => {
    const s = createSession('coding')
    s.session_memory['foo'] = 'bar'
    saveSession(s)
    const loaded = loadSession(s.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.session_memory['foo']).toBe('bar')
  })

  it('returns null for unknown id', () => {
    expect(loadSession('unknown0')).toBeNull()
  })
})
