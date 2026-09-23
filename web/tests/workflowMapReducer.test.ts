import { describe, expect, it } from 'vitest'
import { initialState, reducer, type State } from '../lib/reducer'

const base: State = { ...initialState, sessionId: 'session-a', profile: 'coding' }
const scope = { run_id: 'run-a', session_id: 'session-a', profile: 'coding' }

describe('workflow map reducer integration', () => {
  it('attaches one map to the exact turn run and rejects another session or profile', () => {
    let state = reducer(base, { type: 'USER_MSG', payload: 'first turn' })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'turn_start', run_id: 'run-a' } })
    expect(state.messages[0].runId).toBe('run-a')
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'workflow_map', observation: {
      event_id: 'event-1', revision: 1, kind: 'pass_started', scope,
    } } })
    expect(state.runs?.['run-a'].workflowMap?.snapshot.revision).toBe(1)
    const beforeForeign = state
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'workflow_map', observation: {
      event_id: 'event-2', revision: 2, kind: 'pass_started', scope: { ...scope, profile: 'other' },
    } } })
    expect(state).toBe(beforeForeign)
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'workflow_map', observation: {
      event_id: 'event-3', revision: 2, kind: 'pass_started', scope: { ...scope, session_id: 'other' },
    } } })
    expect(state).toBe(beforeForeign)
  })

  it('deduplicates reconnect replays and holds gapped observations until the recovery snapshot', () => {
    let state = reducer(base, { type: 'SERVER_MSG', payload: { type: 'turn_start', run_id: 'run-a' } })
    const first = { event_id: 'event-1', revision: 1, kind: 'attempt_started' as const, scope, attempt: {
      attempt_id: 'build-1', pass_id: 'pass', playbook: 'coding', stage: 'build' as const, attempt: 1, intensity: 2 as const, tier: 'balanced' as const,
      model: 'fixture-model', state: 'running' as const,
    } }
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'workflow_map', observation: first } })
    const replay = reducer(state, { type: 'SERVER_MSG', payload: { type: 'workflow_map', observation: first } })
    expect(replay.runs?.['run-a'].workflowMap?.snapshot.attempts).toHaveLength(1)
    const gap = reducer(replay, { type: 'SERVER_MSG', payload: { type: 'workflow_map', observation: { ...first, event_id: 'event-3', revision: 3 } } })
    expect(gap.runs?.['run-a'].workflowMap?.needsRecovery).toBe(true)
    expect(gap.runs?.['run-a'].workflowMap?.snapshot.availability).toEqual({ state: 'partial', reason: 'event_gap' })
    const recovered = reducer(gap, { type: 'SERVER_MSG', payload: { type: 'workflow_map', snapshot: {
      version: 1, scope, revision: 3, availability: { state: 'available' }, attempts: [{ ...first.attempt, state: 'done' }], transitions: [], advice: [],
    } } })
    expect(recovered.runs?.['run-a'].workflowMap?.needsRecovery).toBe(false)
    expect(recovered.runs?.['run-a'].workflowMap?.snapshot.attempts[0].state).toBe('done')
  })

  it('preserves distinct per-run maps and ignores stale snapshot revisions', () => {
    let state = reducer(base, { type: 'SERVER_MSG', payload: { type: 'turn_start', run_id: 'run-a' } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'workflow_map', snapshot: {
      version: 1, scope, revision: 8, availability: { state: 'available' }, attempts: [], transitions: [], advice: [],
    } } })
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'turn_start', run_id: 'run-b' } })
    const beforeOld = state
    state = reducer(state, { type: 'SERVER_MSG', payload: { type: 'workflow_map', snapshot: {
      version: 1, scope, revision: 7, availability: { state: 'empty' }, attempts: [], transitions: [], advice: [],
    } } })
    expect(state).toBe(beforeOld)
    expect(state.runs?.['run-a'].workflowMap?.snapshot.revision).toBe(8)
    expect(state.runs?.['run-b'].workflowMap).toBeUndefined()
  })
})
