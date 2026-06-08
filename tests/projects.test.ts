import { describe, it, expect } from 'vitest'
import { ensureInbox, listProjects, createProject } from '../src/projects/store.js'
import { createSession, saveSession, assignSession, listSessionSummaries } from '../src/session/store.js'

const user = 'projects-test-user'

describe('project management', () => {
  it('ensureInbox creates an inbox project on first call', () => {
    ensureInbox(user)
    const projects = listProjects(user)
    expect(projects.find(p => p.id === 'inbox')).toBeDefined()
  })

  it('ensureInbox is idempotent', () => {
    ensureInbox(user)
    ensureInbox(user)
    const inboxes = listProjects(user).filter(p => p.id === 'inbox')
    expect(inboxes).toHaveLength(1)
  })

  it('createProject adds a project with a unique id', () => {
    const p = createProject(user, 'Alpha', 'first project')
    const all = listProjects(user)
    const found = all.find(x => x.id === p.id)
    expect(found?.name).toBe('Alpha')
    expect(found?.description).toBe('first project')
  })

  it('assignSession moves a session to a new project', () => {
    const s = createSession('coding', user)
    saveSession(s)
    assignSession(user, s.id, 'inbox')
    const summaries = listSessionSummaries(user, 'inbox')
    expect(summaries.find(x => x.id === s.id)).toBeDefined()
  })

  it('listSessionSummaries without projectId returns all sessions', () => {
    const all = listSessionSummaries(user)
    expect(Array.isArray(all)).toBe(true)
  })
})
