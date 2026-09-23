import { describe, expect, it } from 'vitest'
import { jevEdgeLabel, maxDrift, promoteFloor, regexEdgeLabel, rerouteAllowed, resolveEdgeAction } from '../src/workflow/edge.js'
import type { EdgeJudgment } from '../src/decisions/workflow.js'
import type { IntensityMap } from '../src/workflow/types.js'

// Roadmap #31 phase 4 (PT-079), spec §5.4/§6 "Phase 4". Pure unit tests for
// the edge-mapping table — no I/O, no mock providers needed here (those live
// in tests/workflow-router-edge.test.ts, the runtime-integration suite).

describe('regexEdgeLabel', () => {
  it('labels a fail-back over an escalation', () => {
    expect(regexEdgeLabel(true, 'plan')).toBe('failback:plan')
  })
  it('labels escalation when no fail-back target', () => {
    expect(regexEdgeLabel(true, null)).toBe('escalate')
  })
  it('labels continue when nothing escalated', () => {
    expect(regexEdgeLabel(false, null)).toBe('continue')
  })
})

describe('jevEdgeLabel', () => {
  it('labels a fail-back regardless of next', () => {
    expect(jevEdgeLabel('continue', 'design')).toBe('failback:design')
  })
  it('labels the next value when no fail-back', () => {
    expect(jevEdgeLabel('promote', undefined)).toBe('promote')
  })
})

describe('maxDrift', () => {
  it('returns the highest-probability candidate', () => {
    expect(maxDrift({ coding: 0.2, data: 0.8, writing: 0.5 })).toEqual({ name: 'data', p: 0.8 })
  })
  it('returns p:0 for an empty drift map', () => {
    expect(maxDrift({})).toEqual({ p: 0 })
  })
})

describe('rerouteAllowed', () => {
  const base = { routerConfigured: true, requestRoutingMode: 'enforce' as const, maxDriftP: 0.9, domainThreshold: 0.5, reroutesUsed: 0, maxReroutes: 1 }
  it('allows when every condition holds', () => {
    expect(rerouteAllowed(base)).toBe(true)
  })
  it('denies when router is not configured', () => {
    expect(rerouteAllowed({ ...base, routerConfigured: false })).toBe(false)
  })
  it('denies when request_routing is not enforce', () => {
    expect(rerouteAllowed({ ...base, requestRoutingMode: 'shadow' })).toBe(false)
    expect(rerouteAllowed({ ...base, requestRoutingMode: undefined })).toBe(false)
  })
  it('denies when drift is at or below the domain threshold', () => {
    expect(rerouteAllowed({ ...base, maxDriftP: 0.5 })).toBe(false)
    expect(rerouteAllowed({ ...base, maxDriftP: 0.3 })).toBe(false)
  })
  it('denies when the reroute cap is reached', () => {
    expect(rerouteAllowed({ ...base, reroutesUsed: 1 })).toBe(false)
  })
})

describe('resolveEdgeAction', () => {
  it('failed_back takes precedence over next, regardless of its value', () => {
    const judgment: EdgeJudgment = { next: 'continue', failed_back: 'design', drift: {} }
    expect(resolveEdgeAction(judgment, { rerouteAllowed: false })).toEqual({ kind: 'failback', stage: 'design' })
  })
  it('continue maps to continue', () => {
    const judgment: EdgeJudgment = { next: 'continue', drift: {} }
    expect(resolveEdgeAction(judgment, { rerouteAllowed: false })).toEqual({ kind: 'continue' })
  })
  it('promote maps to promote', () => {
    const judgment: EdgeJudgment = { next: 'promote', drift: {} }
    expect(resolveEdgeAction(judgment, { rerouteAllowed: false })).toEqual({ kind: 'promote' })
  })
  it('stuck maps to stuck', () => {
    const judgment: EdgeJudgment = { next: 'stuck', drift: {} }
    expect(resolveEdgeAction(judgment, { rerouteAllowed: false })).toEqual({ kind: 'stuck' })
  })
  it('done maps to done', () => {
    const judgment: EdgeJudgment = { next: 'done', drift: {} }
    expect(resolveEdgeAction(judgment, { rerouteAllowed: false })).toEqual({ kind: 'done' })
  })
  it('reroute maps to reroute with the drift target when allowed', () => {
    const judgment: EdgeJudgment = { next: 'reroute', drift: { data: 0.9 } }
    expect(resolveEdgeAction(judgment, { rerouteAllowed: true, rerouteTarget: 'data' })).toEqual({ kind: 'reroute', target: 'data' })
  })
  it('reroute degrades to continue when not allowed', () => {
    const judgment: EdgeJudgment = { next: 'reroute', drift: { data: 0.9 } }
    expect(resolveEdgeAction(judgment, { rerouteAllowed: false, rerouteTarget: 'data' })).toEqual({ kind: 'continue' })
  })
  it('reroute degrades to continue when no target', () => {
    const judgment: EdgeJudgment = { next: 'reroute', drift: {} }
    expect(resolveEdgeAction(judgment, { rerouteAllowed: true })).toEqual({ kind: 'continue' })
  })
})

describe('promoteFloor', () => {
  const current: IntensityMap = { recon: 1, plan: 1, design: 0, build: 1, verify: 1, review: 0 }
  it('falls back to +1-capped-at-3 when no scale or no scale_presets', () => {
    expect(promoteFloor(current, undefined, undefined)).toEqual({ plan: 2, design: 1, verify: 2, review: 1 })
    expect(promoteFloor(current, 'medium', undefined)).toEqual({ plan: 2, design: 1, verify: 2, review: 1 })
  })
  it('caps the fallback at 3', () => {
    const high: IntensityMap = { recon: 1, plan: 3, design: 3, build: 3, verify: 3, review: 3 }
    expect(promoteFloor(high, undefined, undefined)).toEqual({ plan: 3, design: 3, verify: 3, review: 3 })
  })
  it('uses the next scale preset when a routed scale and scale_presets are both present', () => {
    const router: any = { domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1, scale_presets: { medium: { plan: 1 }, large: { plan: 3, design: 2, verify: 2, review: 2 } } }
    expect(promoteFloor(current, 'medium', router)).toEqual({ plan: 3, design: 2, verify: 2, review: 2, recon: 1 })
  })
  it('large has no larger scale to promote to: still uses its own preset (nextScale caps at large)', () => {
    const router: any = { domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1, scale_presets: { large: { plan: 3, design: 2, verify: 2, review: 2 } } }
    expect(promoteFloor(current, 'large', router)).toEqual({ plan: 3, design: 2, verify: 2, review: 2, recon: 1 })
  })
})
