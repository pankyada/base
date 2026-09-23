import { describe, expect, it } from 'vitest'
import { WorkflowMapProjection } from '../src/workflow/map.js'
import type { WorkflowMapObservationInput, WorkflowMapScope } from '../src/types.js'

const scope: WorkflowMapScope = { run_id: 'run-1', session_id: 'session-1', profile: 'coding' }
const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const idFor = (value: string) => uid([...value].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7) >>> 0)
const attempt = {
  attempt_id: uid(100), pass_id: 'pass-1', playbook: 'generic', stage: 'recon' as const,
  attempt: 1, intensity: 1 as const, tier: 'cheap' as const, model: 'fixture-model', state: 'running' as const,
}
const observation = (event_id: string, kind: WorkflowMapObservationInput['kind'], payload: Partial<WorkflowMapObservationInput> = {}): WorkflowMapObservationInput => ({ event_id: idFor(event_id), kind, scope, ...payload })

describe('WorkflowMapProjection', () => {
  it('assigns monotonic revisions, deduplicates event ids, rejects bad scope and late events', () => {
    const maps = new WorkflowMapProjection()
    maps.begin(scope)
    expect(maps.accept(observation('e1', 'pass_started', { pass_id: 'pass-1' }))?.revision).toBe(1)
    expect(maps.accept(observation('e1', 'pass_started', { pass_id: 'pass-1' }))).toBeUndefined()
    expect(maps.accept({ ...observation('bad-scope', 'pass_started', { pass_id: 'pass-1' }), scope: { ...scope, profile: 'other' } })).toBeUndefined()
    expect(maps.accept(observation('terminal', 'terminal', { terminal: 'completed' }))?.revision).toBe(2)
    expect(maps.accept(observation('late', 'pass_started', { pass_id: 'pass-2' }))).toBeUndefined()
    expect(maps.snapshot(scope)?.revision).toBe(2)
  })

  it('notifies completion subscribers for empty and observed terminal runs without fabricating observations', () => {
    const maps = new WorkflowMapProjection()
    const completed: WorkflowMapScope[] = []
    const unsubscribe = maps.subscribeCompletion(value => completed.push(value))
    maps.begin(scope)
    expect(maps.completeEmpty(scope)?.availability).toEqual({ state: 'empty' })
    expect(completed).toEqual([scope])
    unsubscribe()

    const nextScope = { ...scope, run_id: 'run-2' }
    maps.begin(nextScope)
    expect(maps.accept({ ...observation('terminal-completion', 'terminal', { terminal: 'completed' }), scope: nextScope })?.revision).toBe(1)
    expect(completed).toEqual([scope])
    expect(maps.recover(nextScope, 0)).toMatchObject({ mode: 'events', events: [{ kind: 'terminal', revision: 1 }] })
  })

  it('returns retained observations or an authoritative snapshot after a gap', () => {
    const maps = new WorkflowMapProjection({ observations: 3 })
    maps.begin(scope)
    for (let i = 1; i <= 5; i++) maps.accept(observation(`e${i}`, 'pass_started', { pass_id: `p${i}` }))
    const recovered = maps.recover(scope, 4)
    expect(recovered.mode).toBe('events')
    if (recovered.mode === 'events') expect(recovered.events.map(event => event.revision)).toEqual([5])
    const gap = maps.recover(scope, 1)
    expect(gap.mode).toBe('snapshot')
    if (gap.mode === 'snapshot') {
      expect(gap.snapshot.availability).toEqual({ state: 'partial', reason: 'retention_overflow' })
      expect(gap.snapshot.retained_from_revision).toBeGreaterThan(1)
    }
  })

  it('enforces independent per-run collection bounds and 32 completed-run retention', () => {
    const maps = new WorkflowMapProjection({ observations: 200, attempts: 48, transitions: 96, advice: 48, completedRuns: 32 })
    maps.begin(scope)
    for (let i = 0; i < 50; i++) maps.accept(observation(`a${i}`, 'attempt_started', { pass_id: 'pass-1', attempt: { ...attempt, attempt_id: uid(100 + i), pass_id: 'pass-1' } }))
    for (let i = 0; i < 100; i++) maps.accept(observation(`t${i}`, 'transition', { transition: { transition_id: uid(1000 + i), kind: 'continue' } }))
    for (let i = 0; i < 50; i++) maps.accept(observation(`d${i}`, 'advice', { advice: { advice_id: uid(2000 + i), kind: 'route', mode: 'shadow', applied: false, action: 'run' } }))
    const snapshot = maps.snapshot(scope)!
    expect(snapshot.attempts).toHaveLength(48)
    expect(snapshot.transitions).toHaveLength(96)
    expect(snapshot.advice).toHaveLength(48)
    expect(snapshot.availability).toEqual({ state: 'partial', reason: 'retention_overflow' })

    for (let i = 0; i < 33; i++) {
      const run = { ...scope, run_id: `completed-${i}` }
      maps.begin(run)
      maps.accept({ ...observation(`terminal-${i}`, 'terminal', { terminal: 'completed' }), scope: run })
    }
    expect(maps.snapshot({ ...scope, run_id: 'completed-0' })?.availability).toEqual({ state: 'unavailable', reason: 'not_retained' })
    expect(maps.snapshot({ ...scope, run_id: 'completed-32' })?.terminal).toBe('completed')
  })

  it('bounds and validates runner values instead of forwarding arbitrary payloads', () => {
    const maps = new WorkflowMapProjection()
    maps.begin(scope)
    expect(maps.accept(observation('unsafe', 'advice', { advice: { advice_id: uid(5000), kind: 'edge', mode: 'enforce', applied: false, summary: 'private_prompt' } as any }))).toBeUndefined()
    expect(maps.accept(observation('nan', 'attempt_started', { attempt: { ...attempt, attempt: Number.NaN } as any }))).toBeUndefined()
    expect(maps.snapshot(scope)?.revision).toBe(0)
  })
})
