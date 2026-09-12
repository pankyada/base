import { describe, it, expect } from 'vitest'
import { createSession, saveSession, loadSession, listSessions } from '../src/session/store.js'

describe('session store', () => {
  it('creates session with id, profile, and user', () => {
    const s = createSession('coding', 'pankaj')
    expect(s.id).toHaveLength(8)
    expect(s.profile).toBe('coding')
    expect(s.user).toBe('pankaj')
    expect(s.messages).toEqual([])
    expect(s.usage.cost_usd).toBe(0)
  })

  it('saves and loads session by user + id', () => {
    const s = createSession('coding', 'pankaj')
    s.session_memory['foo'] = 'bar'
    s.working_dir = '/tmp/session-project'
    saveSession(s)
    const loaded = loadSession('pankaj', s.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.session_memory['foo']).toBe('bar')
    expect(loaded!.working_dir).toBe('/tmp/session-project')
  })

  it('returns null for unknown id', () => {
    expect(loadSession('pankaj', 'unknown0')).toBeNull()
  })

  it('returns null when loading another users session', () => {
    const s = createSession('coding', 'alice')
    saveSession(s)
    expect(loadSession('bob', s.id)).toBeNull()
  })

  it('listSessions returns only that users sessions', () => {
    const s1 = createSession('coding', 'alice')
    const s2 = createSession('coding', 'bob')
    saveSession(s1)
    saveSession(s2)
    const aliceSessions = listSessions('alice')
    const ids = aliceSessions.map(s => s.id)
    expect(ids).toContain(s1.id)
    expect(ids).not.toContain(s2.id)
  })
})
