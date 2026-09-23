import { describe, expect, it } from 'vitest'
import { decideRoute, type RouteSignals, type RouterConfig, type SessionRoute } from '../src/workflow/route.js'

const config: RouterConfig = { domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1 }

function signals(overrides: Partial<RouteSignals> = {}): RouteSignals {
  return {
    domain: {},
    scale: { trivial: 0, small: 0, medium: 0, large: 0 },
    has_existing_work: 0,
    ambiguous: 0,
    ...overrides,
  }
}

describe('decideRoute (roadmap #31 phase 2, spec §5.2)', () => {
  it('rule 1: ambiguous above threshold with clarifications remaining => ask', () => {
    const decision = decideRoute(signals({ ambiguous: 0.9 }), config, 'generic', 1)
    expect(decision).toEqual({ kind: 'ask', reason: 'ambiguous' })
  })

  it('rule 1 edge: exactly at ask_threshold is NOT ambiguous (strictly greater required)', () => {
    const decision = decideRoute(signals({ ambiguous: 0.6, scale: { trivial: 1, small: 0, medium: 0, large: 0 } }), config, 'generic', 1)
    expect(decision.kind).toBe('run')
  })

  it('ask disabled when clarificationsRemaining is 0, even if ambiguous', () => {
    const decision = decideRoute(signals({ ambiguous: 0.95, scale: { trivial: 1, small: 0, medium: 0, large: 0 } }), config, 'generic', 0)
    expect(decision.kind).toBe('run')
  })

  it('rule ordering: ask beats domain match and continues_previous', () => {
    const session: SessionRoute = { playbook: 'coding', scale: 'small', task_id: 't1', at: new Date().toISOString() }
    const decision = decideRoute(signals({ ambiguous: 0.9, continues_previous: 0.9, domain: { coding: 0.9 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), config, 'generic', 1, session)
    expect(decision).toEqual({ kind: 'ask', reason: 'ambiguous' })
  })

  it('rule 2: continues_previous above 0.5 with a session route reuses its playbook', () => {
    const session: SessionRoute = { playbook: 'writing', scale: 'small', task_id: 't1', at: new Date().toISOString() }
    const decision = decideRoute(signals({ continues_previous: 0.7, domain: { coding: 0.9 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), config, 'generic', 1, session)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') {
      expect(decision.playbooks).toEqual(['writing'])
      expect(decision.primary).toBe('writing')
    }
  })

  it('rule 2 edge: exactly at 0.5 continues_previous does NOT reuse (strictly greater required)', () => {
    const session: SessionRoute = { playbook: 'writing', scale: 'small', task_id: 't1', at: new Date().toISOString() }
    const decision = decideRoute(signals({ continues_previous: 0.5, domain: { coding: 0.9 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), config, 'generic', 1, session)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.playbooks).toEqual(['coding'])
  })

  it('rule 2 requires a session route to exist even if continues_previous is high', () => {
    const decision = decideRoute(signals({ continues_previous: 0.9, domain: { coding: 0.9 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), config, 'generic', 1, undefined)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.playbooks).toEqual(['coding'])
  })

  it('rule 3: domain filter sorts by probability descending and caps at 2', () => {
    const decision = decideRoute(signals({ domain: { coding: 0.9, data: 0.8, writing: 0.7 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), config, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') {
      expect(decision.playbooks).toEqual(['coding', 'data'])
      expect(decision.primary).toBe('coding')
    }
  })

  it('rule 3 edge: exactly at domain_threshold is NOT in (strictly greater required)', () => {
    const decision = decideRoute(signals({ domain: { coding: 0.5 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), config, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.playbooks).toEqual(['generic'])
  })

  it('rule 3: none above threshold => fallback playbook', () => {
    const decision = decideRoute(signals({ domain: { coding: 0.1, data: 0.2 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), config, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') {
      expect(decision.playbooks).toEqual(['generic'])
      expect(decision.primary).toBe('generic')
    }
  })

  it('rule 4: scale is the argmax level', () => {
    const decision = decideRoute(signals({ domain: { coding: 0.9 }, scale: { trivial: 0.1, small: 0.1, medium: 0.7, large: 0.1 } }), config, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.scale).toBe('medium')
  })

  it('rule 5: a near-tie (within 0.15) picks the larger scale level', () => {
    const decision = decideRoute(signals({ domain: { coding: 0.9 }, scale: { trivial: 0, small: 0.1, medium: 0.45, large: 0.45 } }), config, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.scale).toBe('large')
  })

  it('a clear (non-tied) margin picks the actual top scale, not always the larger one', () => {
    const decision = decideRoute(signals({ domain: { coding: 0.9 }, scale: { trivial: 0, small: 0.8, medium: 0.1, large: 0.1 } }), config, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.scale).toBe('small')
  })

  it('recon floor is always >= 1 even with no scale_presets configured', () => {
    const decision = decideRoute(signals({ domain: { coding: 0.9 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), config, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.intensityFloor.recon).toBe(1)
  })

  it('recon floor is forced to >= 1 even when a preset explicitly sets recon to 0', () => {
    const withPreset: RouterConfig = { ...config, scale_presets: { small: { recon: 0, plan: 1, design: 0, verify: 1, review: 0 } } }
    const decision = decideRoute(signals({ domain: { coding: 0.9 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), withPreset, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.intensityFloor).toEqual({ recon: 1, plan: 1, design: 0, verify: 1, review: 0 })
  })

  it('merges the configured preset for the chosen scale', () => {
    const withPreset: RouterConfig = { ...config, scale_presets: { large: { plan: 3, design: 2, verify: 2, review: 2 } } }
    const decision = decideRoute(signals({ domain: { coding: 0.9 }, scale: { trivial: 0, small: 0, medium: 0, large: 1 } }), withPreset, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.intensityFloor).toEqual({ recon: 1, plan: 3, design: 2, verify: 2, review: 2 })
  })

  it('why is a short non-empty string explaining the decision', () => {
    const decision = decideRoute(signals({ domain: { coding: 0.9 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), config, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.why.length).toBeGreaterThan(0)
  })
})
