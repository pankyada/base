import { describe, expect, it } from 'vitest'
import type { WorkflowMapObservation, WorkflowMapScope, WorkflowMapSnapshot, ServerMessage } from '../lib/protocol'
import { applyWorkflowMapFrame, sameWorkflowMapScope, workflowMapSummary } from '../lib/workflowMap'

const scope: WorkflowMapScope = { run_id: 'run-a', session_id: 'session-a', profile: 'coding' }
const attempt = (id: string, stage: 'build' | 'verify' = 'build') => ({
  attempt_id: id, pass_id: 'pass-a', playbook: 'coding', stage, attempt: 1,
  intensity: 2 as const, tier: 'balanced' as const, model: 'fixture-model', state: 'done' as const,
})
const observation = (revision: number, event_id: string, kind: WorkflowMapObservation['kind'] = 'pass_started'): WorkflowMapObservation => ({
  event_id, revision, kind, scope,
})
const snapshot = (revision: number, overrides: Partial<WorkflowMapSnapshot> = {}): WorkflowMapSnapshot => ({
  version: 1, scope, revision, availability: { state: 'available' }, attempts: [], transitions: [], advice: [], ...overrides,
})

describe('workflow map client projection', () => {
  it('accepts only the exact run, session and profile scope', () => {
    expect(sameWorkflowMapScope(scope, { ...scope, session_id: 'other' })).toBe(false)
    expect(sameWorkflowMapScope(scope, { ...scope, profile: 'other' })).toBe(false)
    expect(sameWorkflowMapScope(scope, { ...scope, run_id: 'other' })).toBe(false)
  })

  it('applies each event once, in revision order, and ignores duplicates and old snapshots', () => {
    const first = applyWorkflowMapFrame(undefined, { type: 'workflow_map', observation: observation(1, 'event-1') }, scope)
    const duplicate = applyWorkflowMapFrame(first.state, { type: 'workflow_map', observation: observation(1, 'event-1') }, scope)
    const stale = applyWorkflowMapFrame(duplicate.state, { type: 'workflow_map', snapshot: snapshot(0) }, scope)
    expect(first.accepted).toBe(true)
    expect(first.state?.snapshot.availability).toEqual({ state: 'available' })
    expect(duplicate.accepted).toBe(false)
    expect(stale.accepted).toBe(false)
    expect(stale.state?.snapshot.revision).toBe(1)
  })

  it('lets an explicit server-restarted unavailable snapshot replace stale in-memory execution', () => {
    const current = applyWorkflowMapFrame(undefined, { type: 'workflow_map', snapshot: snapshot(8, { attempts: [attempt('build')] }) }, scope).state!
    const restarted = applyWorkflowMapFrame(current, { type: 'workflow_map', snapshot: snapshot(0, { availability: { state: 'unavailable', reason: 'server_restarted' } }) }, scope)
    expect(restarted.accepted).toBe(true)
    expect(restarted.state?.snapshot.availability).toEqual({ state: 'unavailable', reason: 'server_restarted' })
    expect(restarted.state?.snapshot.attempts).toEqual([])
  })

  it('marks an out-of-order revision partial and requests recovery without inventing an edge', () => {
    const gap = applyWorkflowMapFrame(undefined, { type: 'workflow_map', observation: observation(3, 'event-3') }, scope)
    expect(gap.needsRecovery).toBe(true)
    expect(gap.state?.snapshot.availability).toEqual({ state: 'partial', reason: 'event_gap' })
    expect(gap.state?.snapshot.revision).toBe(0)
    expect(gap.state?.snapshot.transitions).toEqual([])
  })

  it('keeps a revision gap partial until an authoritative snapshot arrives', () => {
    const gap = applyWorkflowMapFrame(undefined, { type: 'workflow_map', observation: observation(3, 'event-3') }, scope)
    const later = applyWorkflowMapFrame(gap.state, { type: 'workflow_map', observation: observation(1, 'event-1') }, scope)
    expect(later.accepted).toBe(false)
    expect(later.needsRecovery).toBe(true)
    expect(later.state?.snapshot.availability).toEqual({ state: 'partial', reason: 'event_gap' })
    const recovered = applyWorkflowMapFrame(later.state, { type: 'workflow_map', snapshot: snapshot(3) }, scope)
    expect(recovered.accepted).toBe(true)
    expect(recovered.needsRecovery).toBe(false)
    expect(recovered.state?.snapshot.availability).toEqual({ state: 'available' })
  })

  it('bounds client retention and labels truncated live history partial', () => {
    let state = applyWorkflowMapFrame(undefined, { type: 'workflow_map', observation: observation(1, 'bounded-1') }, scope).state
    for (let revision = 2; revision <= 310; revision++) {
      const kind = revision % 3 === 0 ? 'attempt_started' : revision % 3 === 1 ? 'transition' : 'advice'
      const frame: Extract<ServerMessage, { type: 'workflow_map' }> = { type: 'workflow_map', observation: {
        ...observation(revision, `bounded-${revision}`, kind),
        ...(kind === 'attempt_started' ? { attempt: attempt(`attempt-${revision}`) } : {}),
        ...(kind === 'transition' ? { transition: { transition_id: `transition-${revision}`, kind: 'continue' } } : {}),
        ...(kind === 'advice' ? { advice: { advice_id: `advice-${revision}`, kind: 'route', mode: 'shadow', applied: false } } : {}),
      } }
      state = applyWorkflowMapFrame(state, frame, scope).state
    }
    expect(state?.snapshot.attempts).toHaveLength(48)
    expect(state?.snapshot.transitions).toHaveLength(96)
    expect(state?.snapshot.advice).toHaveLength(48)
    expect(state?.seenEventIds.length).toBeLessThanOrEqual(128)
    expect(state?.snapshot.availability).toEqual({ state: 'partial', reason: 'retention_overflow' })
    expect(state?.snapshot.retained_from_revision).toBeDefined()
  })

  it('treats a snapshot as authoritative and counts exploratory-tier executions in the actual path', () => {
    const result = applyWorkflowMapFrame(undefined, { type: 'workflow_map', snapshot: snapshot(6, {
      attempts: [attempt('build'), { ...attempt('explore', 'verify'), explore: true }],
      advice: [{ advice_id: 'advice-1', kind: 'route', mode: 'shadow', applied: false, summary: 'generic suggested' }],
      transitions: [{ transition_id: 'edge-1', to_attempt_id: 'build', kind: 'start' }],
    }) }, scope)
    expect(result.state?.snapshot.revision).toBe(6)
    expect(workflowMapSummary(result.state!.snapshot)).toMatchObject({ actualAttempts: 2, explorationAttempts: 1 })
    expect(result.state?.snapshot.transitions).toHaveLength(1)
  })

  it('distinguishes known zero cost from unknown cost and does not collapse unavailable to empty', () => {
    const zero = { ...attempt('zero'), cost_usd: 0 }
    const unknown = attempt('unknown')
    const zeroSnapshot = snapshot(1, { attempts: [zero, unknown] })
    expect(zeroSnapshot.attempts[0].cost_usd).toBe(0)
    expect(zeroSnapshot.attempts[1].cost_usd).toBeUndefined()
    expect(snapshot(0, { availability: { state: 'unavailable', reason: 'not_retained' } }).availability).not.toEqual({ state: 'empty' })
  })
})
