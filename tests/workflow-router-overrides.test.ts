import { describe, expect, it } from 'vitest'
import { parseRoutingPolicy } from '../src/workflow/adaptive.js'
import { decideRoute, type RouteSignals, type RouterConfig } from '../src/workflow/route.js'

const baseConfig: RouterConfig = { domain_threshold: 0.5, ask_threshold: 0.6, max_reroutes: 1, max_clarifications: 1 }

function signals(overrides: Partial<RouteSignals> = {}): RouteSignals {
  return { domain: {}, scale: { trivial: 0, small: 0, medium: 0, large: 0 }, has_existing_work: 0, ambiguous: 0, ...overrides }
}

describe('parseRoutingPolicy router overrides (roadmap #31 phase 6, PT-081)', () => {
  it('parses a valid router block alongside the existing per-stage tier doc', () => {
    const doc = parseRoutingPolicy('{"coding":{},"router":{"ask_threshold":0.7,"domain_thresholds":{"coding":0.6}}}')
    expect(doc?.router).toEqual({ ask_threshold: 0.7, domain_thresholds: { coding: 0.6 } })
    expect(doc?.coding).toEqual({})
  })

  it('accepts an absent router block (today\'s doc shape)', () => {
    const doc = parseRoutingPolicy('{"coding":{"bugfix":{}}}')
    expect(doc?.router).toBeUndefined()
  })

  it('drops an out-of-range router block but keeps the rest of the doc', () => {
    const doc = parseRoutingPolicy('{"coding":{},"router":{"ask_threshold":1.5}}')
    expect(doc?.router).toBeUndefined()
    expect(doc?.coding).toEqual({})
  })

  it('drops a router block with a non-numeric domain threshold', () => {
    const doc = parseRoutingPolicy('{"router":{"domain_thresholds":{"coding":"high"}}}')
    expect(doc?.router).toBeUndefined()
  })

  it('drops a router block that is not an object', () => {
    const doc = parseRoutingPolicy('{"router":"nope"}')
    expect(doc?.router).toBeUndefined()
  })
})

describe('decideRoute with per-playbook domainThresholds override', () => {
  it('uses the override threshold for a specific playbook, global threshold for others', () => {
    const config: RouterConfig = { ...baseConfig, domainThresholds: { coding: 0.8 } }
    // coding at 0.7 is below its 0.8 override -> excluded; data at 0.55 is above the global 0.5 -> included.
    const decision = decideRoute(signals({ domain: { coding: 0.7, data: 0.55 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), config, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.playbooks).toEqual(['data'])
  })

  it('falls back to the global domain_threshold when no override is set for that playbook', () => {
    const config: RouterConfig = { ...baseConfig, domainThresholds: { data: 0.9 } }
    const decision = decideRoute(signals({ domain: { coding: 0.6 }, scale: { trivial: 0, small: 1, medium: 0, large: 0 } }), config, 'generic', 1)
    expect(decision.kind).toBe('run')
    if (decision.kind === 'run') expect(decision.playbooks).toEqual(['coding'])
  })
})
