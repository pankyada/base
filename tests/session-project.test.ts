import { describe, it, expect } from 'vitest'
import { createSession, saveSession, loadSession } from '../src/session/store.js'

describe('session project + title', () => {
  it('new sessions default to the inbox project', () => {
    const s = createSession('coding', 'erin')
    expect(s.project).toBe('inbox')
  })

  it('a loaded legacy session without project is stamped inbox on save', () => {
    const s = createSession('coding', 'frank')
    delete (s as any).project           // simulate a pre-projects session
    saveSession(s)                       // saveSession backfills inbox
    expect(loadSession('frank', s.id)!.project).toBe('inbox')
  })

  it('title is derived from the first user message when absent', () => {
    const s = createSession('coding', 'gwen')
    s.messages.push({ role: 'user', content: 'Refactor the auth flow please and thanks' })
    saveSession(s)
    expect(loadSession('gwen', s.id)!.title).toBe('Refactor the auth flow please and thanks')
  })

  it('does not set a title for a whitespace-only first message', () => {
    const s = createSession('coding', 'hugo')
    s.messages.push({ role: 'user', content: '   \n\t  ' })
    saveSession(s)
    expect(loadSession('hugo', s.id)!.title).toBeUndefined()
  })
})
