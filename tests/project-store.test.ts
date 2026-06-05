import { describe, it, expect } from 'vitest'
import { createProject, listProjects, getProject, ensureInbox } from '../src/projects/store.js'

describe('project store', () => {
  it('creates a project with an 8-char id and sanitized user', () => {
    const p = createProject('alice', 'Q3 Launch', 'the big one')
    expect(p.id).toHaveLength(8)
    expect(p.user).toBe('alice')
    expect(p.name).toBe('Q3 Launch')
    expect(p.description).toBe('the big one')
    expect(getProject('alice', p.id)!.name).toBe('Q3 Launch')
  })

  it('ensureInbox creates a stable "inbox" project once', () => {
    const a = ensureInbox('bob')
    const b = ensureInbox('bob')
    expect(a.id).toBe('inbox')
    expect(a.name).toBe('Inbox')
    expect(b.id).toBe('inbox')
    expect(listProjects('bob').filter(p => p.id === 'inbox')).toHaveLength(1)
  })

  it('listProjects returns only that users projects', () => {
    const p = createProject('carol', 'Solo')
    expect(listProjects('carol').map(x => x.id)).toContain(p.id)
    expect(listProjects('dave').map(x => x.id)).not.toContain(p.id)
  })
})
