import { describe, it, expect } from 'vitest'
import { handleProjectMessage } from '../src/server/project-handlers.js'

describe('project message handlers', () => {
  it('project_create returns a project_created message', () => {
    const out = handleProjectMessage({ type: 'project_create', name: 'Plan X' }, 'leo')
    expect(out!.type).toBe('project_created')
    expect(out!.type === 'project_created' && out.project.name).toBe('Plan X')
  })

  it('project_list returns the users projects', () => {
    handleProjectMessage({ type: 'project_create', name: 'Only' }, 'mae')
    const out = handleProjectMessage({ type: 'project_list' }, 'mae')
    expect(out!.type).toBe('projects')
    expect(out!.type === 'projects' && out.projects.some(p => p.name === 'Only')).toBe(true)
  })

  it('session_list returns summaries (optionally filtered)', () => {
    const out = handleProjectMessage({ type: 'session_list' }, 'nina')
    expect(out!.type).toBe('sessions')
  })

  it('returns null for non-project messages', () => {
    const out = handleProjectMessage({ type: 'cancel' } as any, 'leo')
    expect(out).toBeNull()
  })
})
