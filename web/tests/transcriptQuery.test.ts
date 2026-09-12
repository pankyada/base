import { describe, expect, it } from 'vitest'
import { normalizeTranscript, transcriptRequestIsCurrent, transcriptUrl } from '../hooks/useHarnessQuery'

describe('transcript query', () => {
  it('normalizes stored transcript rows for the reducer', () => {
    expect(normalizeTranscript([{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'world' }])).toEqual([
      { id: 'history-0', role: 'user', content: 'hello' },
      { id: 'history-1', role: 'agent', content: 'world' },
    ])
  })

  it('builds bounded paging URLs', () => {
    expect(transcriptUrl('http://localhost:7337', 's 1', {}, 'abc')).toBe('http://localhost:7337/sessions/s%201/messages?before=abc')
  })

  it('includes user and profile scope when provided', () => {
    expect(transcriptUrl('http://localhost:7337', 's1', { userId: 'user-a', profile: 'coding' }, 'abc'))
      .toBe('http://localhost:7337/sessions/s1/messages?user=user-a&profile=coding&before=abc')
  })

  it('rejects delayed transcript response when session changes inside same user/profile scope', () => {
    expect(transcriptRequestIsCurrent('session-a', 'session-b', { userId: 'user-a', profile: 'coding' }, { userId: 'user-a', profile: 'coding' })).toBe(false)
    expect(transcriptRequestIsCurrent('session-a', 'session-a', { userId: 'user-a', profile: 'coding' }, { userId: 'user-b', profile: 'coding' })).toBe(false)
    expect(transcriptRequestIsCurrent('session-a', 'session-a', { userId: 'user-a', profile: 'coding' }, { userId: 'user-a', profile: 'coding' })).toBe(true)
  })
})
