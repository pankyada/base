import { describe, expect, it } from 'vitest'
import { initialOperatorState, operatorReducer } from '../lib/operatorState'
import type { ServerMessage } from '../lib/protocol'
const message = (state: ReturnType<typeof initialOperatorState>, payload: ServerMessage) => operatorReducer(state, { type: 'message', payload })
const prompt: ServerMessage = { type: 'tool_prompt', id: 'a', name: 'Bash', input: { command: 'true' } }
describe('retained operator state', () => {
  it('retains approval/budget/skills after 300 unrelated events', () => {
    let state = message(initialOperatorState(), { type: 'session_ready', sessionId: 's', profile: 'p', yolo: false, budget: { max_cost_usd: 4 } })
    state = message(state, prompt)
    state = message(state, { type: 'skills', proposed: [], installed: [] })
    for (let i=0;i<300;i++) state = message(state, { type: 'token', content: 'x' })
    expect(state.approvals.a.name).toBe('Bash')
    expect(state.budget?.limit).toBe(4)
    expect(state.skills).toBeDefined()
  })
  it('retains approval while sending, ignores foreign ACK, and restores on rejection', () => {
    let state = message(initialOperatorState(), prompt)
    state = operatorReducer(state, { type: 'decision', id: 'a', requestId: 'r' })
    state = message(state, { type: 'notice', level: 'info', message: 'decision accepted', request_id: 'other' })
    expect(state.approvals.a.requestId).toBe('r')
    state = message(state, { type: 'error', message: 'denied', request_id: 'r' })
    expect(state.approvals.a.requestId).toBeUndefined()
    expect(state.approvals.a.error).toBe('denied')
    state = operatorReducer(state, { type: 'decision', id: 'a', requestId: 'r2' })
    state = message(state, { type: 'notice', level: 'info', message: 'decision accepted', request_id: 'r2' })
    expect(state.approvals.a).toBeUndefined()
  })
  it('never invents approval details from snapshot IDs or accepts foreign snapshots', () => {
    let state = message(initialOperatorState(), { type: 'session_ready', sessionId: 's', profile: 'p', yolo: false })
    const snapshot = { session_id: 's', user: 'u', revision: 1, status: 'running' as const, last_seq: 400, events: [], gap: true, actionable_ids: ['lost'] }
    state = message(state, { type: 'runtime', snapshot })
    expect(state.approvals).toEqual({})
    expect(state.recoveryError).toContain('unavailable')
    expect(message(state, { type: 'runtime', snapshot: { ...snapshot, session_id: 'foreign', budget: { max_cost_usd: 99 } } })).toEqual(state)
  })
  it('restores only a server-retained approval payload from a reconnect snapshot', () => {
    let state = message(initialOperatorState(), { type: 'session_ready', sessionId: 's', profile: 'p', yolo: false })
    state = message(state, { type: 'runtime', snapshot: {
      session_id: 's', user: 'u', revision: 1, status: 'running', last_seq: 2, events: [], gap: true,
      actionable_ids: ['a'], actionable: [{ id: 'a', name: 'Bash', input: { command: 'true' }, risk: 'danger' }],
    } })
    expect(state.approvals.a).toMatchObject({ name: 'Bash', input: { command: 'true' }, risk: 'danger' })
    expect(state.recoveryError).toBeUndefined()
  })
  it('clears identity state and marks disconnect interruption instead of reviving callbacks', () => {
    let state = message(initialOperatorState(), prompt)
    state = operatorReducer(state, { type: 'disconnected' })
    expect(state.approvals).toEqual({})
    expect(state.recoveryError).toContain('interrupted')
    expect(operatorReducer(state, { type: 'reset' })).toEqual(initialOperatorState())
  })
})
