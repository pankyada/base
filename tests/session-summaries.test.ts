import { describe, it, expect } from 'vitest'
import { createSession, saveSession, listSessionSummaries, assignSession } from '../src/session/store.js'

describe('session summaries + assignment', () => {
  it('listSessionSummaries returns lightweight rows without message arrays', () => {
    const s = createSession('coding', 'hank')
    s.messages.push({ role: 'user', content: 'Hello world task' })
    saveSession(s)
    const rows = listSessionSummaries('hank')
    const row = rows.find(r => r.id === s.id)!
    expect(row.title).toBe('Hello world task')
    expect(row.project).toBe('inbox')
    expect((row as any).messages).toBeUndefined()
  })

  it('filters by project when projectId is provided', () => {
    const a = createSession('iris', 'iris'); saveSession(a)
    const b = createSession('iris', 'iris'); saveSession(b)
    assignSession('iris', b.id, 'proj1234')
    const inInbox = listSessionSummaries('iris', 'inbox').map(r => r.id)
    const inProj = listSessionSummaries('iris', 'proj1234').map(r => r.id)
    expect(inInbox).toContain(a.id)
    expect(inInbox).not.toContain(b.id)
    expect(inProj).toContain(b.id)
  })

  it('assignSession reassigns and persists', () => {
    const s = createSession('jade', 'jade'); saveSession(s)
    assignSession('jade', s.id, 'proj9999')
    expect(listSessionSummaries('jade', 'proj9999').map(r => r.id)).toContain(s.id)
  })
})
