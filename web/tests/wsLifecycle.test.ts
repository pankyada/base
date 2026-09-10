import { describe, expect, it } from 'vitest'
import { buildHelloFrame, buildResumeFrame, nextRecoveryState, type RecoveryState } from '../lib/wsLifecycle'

describe('nextRecoveryState', () => {
  it('captures session and profile from session_ready', () => {
    const state = nextRecoveryState({}, { type: 'session_ready', sessionId: 's1', profile: 'coding', yolo: false } as any)
    expect(state).toEqual({ sessionId: 's1', profile: 'coding' })
  })

  it('adopts the reported profile on session_resumed (PT-033: resume can switch profiles)', () => {
    const start: RecoveryState = { sessionId: 's1', profile: 'coding' }
    const state = nextRecoveryState(start, { type: 'session_resumed', sessionId: 's2', profile: 'coding' } as any)
    expect(state).toEqual({ sessionId: 's2', profile: 'coding' })
  })

  it('adopts a different profile on a cross-profile resume', () => {
    const start: RecoveryState = { sessionId: 's1', profile: 'coding' }
    const state = nextRecoveryState(start, { type: 'session_resumed', sessionId: 's2', profile: 'research' } as any)
    expect(state).toEqual({ sessionId: 's2', profile: 'research' })
  })

  it('leaves state untouched for unrelated frames', () => {
    const start: RecoveryState = { sessionId: 's1', profile: 'coding' }
    const state = nextRecoveryState(start, { type: 'notice', level: 'info', message: 'hi' } as any)
    expect(state).toBe(start)
  })
})

describe('buildHelloFrame', () => {
  it('first connect omits profile even when recovery state is (impossibly) already set', () => {
    const frame = buildHelloFrame('user-a', { sessionId: 's1', profile: 'coding' }, false) as any
    expect(frame.type).toBe('hello')
    expect(frame.user_id).toBe('user-a')
    expect(frame.profile).toBeUndefined()
  })

  it('reconnect carries the last confirmed profile', () => {
    const frame = buildHelloFrame('user-a', { sessionId: 's1', profile: 'coding' }, true) as any
    expect(frame.profile).toBe('coding')
  })

  it('reconnect with no known profile omits the field rather than sending an empty one', () => {
    const frame = buildHelloFrame('user-a', {}, true) as any
    expect(frame.profile).toBeUndefined()
  })
})

describe('buildResumeFrame', () => {
  it('is null on first connect', () => {
    expect(buildResumeFrame({ sessionId: 's1' }, false)).toBeNull()
  })

  it('is null on reconnect with no known session', () => {
    expect(buildResumeFrame({}, true)).toBeNull()
  })

  it('carries the last confirmed session id on reconnect', () => {
    expect(buildResumeFrame({ sessionId: 's1', profile: 'coding' }, true)).toEqual({ type: 'resume', sessionId: 's1' })
  })
})
