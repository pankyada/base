import { describe, it, expect } from 'vitest'
import type { Project, SessionSummary, ClientMessage, ServerMessage } from './types'

describe('project/history web types', () => {
  it('constructs values matching the new types', () => {
    const p: Project = { id: 'inbox', user: 'u', name: 'Inbox', created_at: '2026-06-05T00:00:00Z' }
    const s: SessionSummary = { id: 'abc12345', project: 'inbox', created_at: '2026-06-05T00:00:00Z', usage: { input: 0, output: 0, cost_usd: 0 } }
    const c: ClientMessage = { type: 'project_create', name: 'X' }
    const m: ServerMessage = { type: 'projects', projects: [p] }
    expect(p.id).toBe('inbox')
    expect(s.project).toBe('inbox')
    expect(c.type).toBe('project_create')
    expect(m.type).toBe('projects')
  })
})
