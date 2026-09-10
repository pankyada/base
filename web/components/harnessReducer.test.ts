import { describe, it, expect } from 'vitest'
import { reducer, type State } from './HarnessApp'

const base: State = {
  messages: [], tabs: [], activeTab: 0, input: '', busy: false,
  focusPane: 'conv', paletteOpen: false, tokens: { in: 0, out: 0 },
  pendingApproval: null, tweaksOpen: false, theme: 'dark', palette: 'amber', density: 'regular',
  todos: [], pendingInputRequest: null, pendingCodeExecution: null,
  profile: '…', sessionId: '…',
  activeProject: 'inbox', activeProjectName: 'Inbox', projects: [], history: [],
}

describe('reducer project/history handling', () => {
  it('stores projects from a projects message', () => {
    const next = reducer(base, { type: 'SERVER_MSG', payload: { type: 'projects', projects: [{ id: 'p1', user: 'u', name: 'Alpha', created_at: 'x' }] } })
    expect(next.projects.map(p => p.name)).toContain('Alpha')
  })
  it('switches active project on project_created', () => {
    const next = reducer(base, { type: 'SERVER_MSG', payload: { type: 'project_created', project: { id: 'p9', user: 'u', name: 'Fresh', created_at: 'x' } } })
    expect(next.activeProject).toBe('p9')
    expect(next.activeProjectName).toBe('Fresh')
    expect(next.projects.some(p => p.id === 'p9')).toBe(true)
  })
  it('stores history from a sessions message', () => {
    const next = reducer(base, { type: 'SERVER_MSG', payload: { type: 'sessions', sessions: [{ id: 's1', project: 'inbox', created_at: 'x', usage: { input: 0, output: 0, cost_usd: 0 } }] } })
    expect(next.history.map(h => h.id)).toContain('s1')
  })
  it('SET_ACTIVE_PROJECT updates pointer + name', () => {
    const next = reducer(base, { type: 'SET_ACTIVE_PROJECT', id: 'p2', name: 'Beta' })
    expect(next.activeProject).toBe('p2')
    expect(next.activeProjectName).toBe('Beta')
  })
  it('session_resumed keeps busy false', () => {
    const next = reducer({ ...base, busy: true }, { type: 'SERVER_MSG', payload: { type: 'session_resumed', sessionId: 's1', profile: 'coding' } })
    expect(next.busy).toBe(false)
  })
})
