import { describe, expect, it } from 'vitest'
import { aggregateRouteGraph, suggestRouterThresholds } from '../src/analysis/routing.js'
import type { TelemetryEvent } from '../src/types.js'

const ts = new Date().toISOString()

function routeEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return { ts, session: 's', profile: 'p', kind: 'route', task_id: 't1', route_mode: 'enforce', route_decision_kind: 'run', route_playbooks: ['coding'], route_applied: true, ...overrides } as TelemetryEvent
}

describe('aggregateRouteGraph (roadmap #31 phase 6, PT-081)', () => {
  it('reports no data when there is no routing telemetry at all', () => {
    const report = aggregateRouteGraph([{ ts, session: 's', profile: 'p', kind: 'tool', name: 'Read' } as TelemetryEvent])
    expect(report.hasData).toBe(false)
    expect(report.playbooks).toEqual({})
  })

  it('counts routed/applied per chosen playbook and tolerates missing fields', () => {
    const events: TelemetryEvent[] = [
      routeEvent({ task_id: 't1', route_playbooks: ['coding'], route_applied: true }),
      routeEvent({ task_id: 't2', route_playbooks: ['coding'], route_applied: false }),
      routeEvent({ task_id: 't3', route_playbooks: ['data'], route_applied: true }),
      // Malformed/older event missing route_playbooks: tolerated, ignored for playbook stats.
      { ts, session: 's', profile: 'p', kind: 'route', route_decision_kind: 'run' } as TelemetryEvent,
    ]
    const report = aggregateRouteGraph(events)
    expect(report.hasData).toBe(true)
    expect(report.playbooks.coding).toMatchObject({ routed: 2, applied: 1 })
    expect(report.playbooks.data).toMatchObject({ routed: 1, applied: 1 })
  })

  it('builds a chosen -> rerouted_to confusion matrix and reroute rate', () => {
    const events: TelemetryEvent[] = [
      routeEvent({ task_id: 't1', route_playbooks: ['coding'] }),
      routeEvent({ task_id: 't2', route_playbooks: ['coding'] }),
      { ts, session: 's', profile: 'p', kind: 'reroute', task_id: 'r1', parent_task_id: 't1', route_playbooks: ['data'] } as TelemetryEvent,
    ]
    const report = aggregateRouteGraph(events)
    expect(report.confusion.coding).toEqual({ data: 1 })
    expect(report.rerouteRate).toBeCloseTo(0.5)
  })

  it('counts provider fallbacks separately from playbook stats', () => {
    const events: TelemetryEvent[] = [
      { ts, session: 's', profile: 'p', kind: 'route', task_id: 't1', route_fallback: 'incomplete or malformed route signals', route_applied: false } as TelemetryEvent,
    ]
    const report = aggregateRouteGraph(events)
    expect(report.providerFallbacks).toBe(1)
    expect(report.playbooks).toEqual({})
  })

  it('computes clarify rate from clarify events over routed tasks', () => {
    const events: TelemetryEvent[] = [
      routeEvent({ task_id: 't1' }),
      routeEvent({ task_id: 't2' }),
      { ts, session: 's', profile: 'p', kind: 'clarify', task_id: 't1', attempt: 1 } as TelemetryEvent,
    ]
    const report = aggregateRouteGraph(events)
    expect(report.clarify.rate).toBeCloseTo(0.5)
    expect(report.clarify.routedCount).toBe(2)
  })

  it('computes edge agreement overall and per stage, plus applied action counts', () => {
    const events: TelemetryEvent[] = [
      { ts, session: 's', profile: 'p', kind: 'edge', task_id: 't1', stage: 'build', edge_regex: 'continue', edge_jev: 'continue', edge_agree: true, edge_applied: true } as TelemetryEvent,
      { ts, session: 's', profile: 'p', kind: 'edge', task_id: 't2', stage: 'build', edge_regex: 'continue', edge_jev: 'escalate', edge_agree: false, edge_applied: true } as TelemetryEvent,
      { ts, session: 's', profile: 'p', kind: 'edge', task_id: 't3', stage: 'verify', edge_regex: 'continue', edge_jev: 'continue', edge_agree: true, edge_applied: false } as TelemetryEvent,
      // Missing edge_jev: excluded from agreement, but should not throw.
      { ts, session: 's', profile: 'p', kind: 'edge', task_id: 't4', stage: 'build', edge_regex: 'continue' } as TelemetryEvent,
    ]
    const report = aggregateRouteGraph(events)
    expect(report.edge.overall.total).toBe(3)
    expect(report.edge.overall.agreement_rate).toBeCloseTo(2 / 3)
    expect(report.edge.byStage.build.total).toBe(2)
    expect(report.edge.byStage.verify.agreement_rate).toBe(1)
    expect(report.edge.appliedActions).toEqual({ continue: 1, escalate: 1 })
  })

  it('computes claim-check checked/fail/skipped/fallback counts and fail rate', () => {
    const events: TelemetryEvent[] = [
      { ts, session: 's', profile: 'p', kind: 'claim_check', task_id: 't1', claim_count: 3, claim_verdict: 'pass' } as TelemetryEvent,
      { ts, session: 's', profile: 'p', kind: 'claim_check', task_id: 't2', claim_count: 2, claim_verdict: 'fail' } as TelemetryEvent,
      { ts, session: 's', profile: 'p', kind: 'claim_check', task_id: 't3', claim_skipped: 'no_claims' } as TelemetryEvent,
      { ts, session: 's', profile: 'p', kind: 'claim_check', task_id: 't4', claim_fallback: 'provider error' } as TelemetryEvent,
    ]
    const report = aggregateRouteGraph(events)
    expect(report.claims.checked).toBe(2)
    expect(report.claims.fail).toBe(1)
    expect(report.claims.fail_rate).toBeCloseTo(0.5)
    expect(report.claims.skipped).toEqual({ no_claims: 1 })
    expect(report.claims.fallback).toBe(1)
  })

  it('respects the since filter', () => {
    const old = new Date(Date.now() - 100_000).toISOString()
    const events: TelemetryEvent[] = [routeEvent({ ts: old, task_id: 'old' })]
    const report = aggregateRouteGraph(events, { since: new Date() })
    expect(report.hasData).toBe(false)
  })
})

describe('suggestRouterThresholds (roadmap #31 phase 6, PT-081)', () => {
  const current = { domain_threshold: 0.5, ask_threshold: 0.6 }

  it('reports insufficient data below the sample-size floor', () => {
    const events: TelemetryEvent[] = Array.from({ length: 5 }, (_, i) => routeEvent({ task_id: `t${i}`, route_playbooks: ['coding'] }))
    const suggestions = suggestRouterThresholds(events, current)
    expect(suggestions.domain_threshold.coding).toMatchObject({ kind: 'insufficient', sample_size: 5 })
    expect(suggestions.ask_threshold).toMatchObject({ kind: 'insufficient' })
  })

  it('suggests raising domain_threshold for a playbook frequently rerouted away from', () => {
    const events: TelemetryEvent[] = []
    for (let i = 0; i < 20; i++) events.push(routeEvent({ task_id: `t${i}`, route_playbooks: ['coding'] }))
    for (let i = 0; i < 8; i++) events.push({ ts, session: 's', profile: 'p', kind: 'reroute', task_id: `r${i}`, parent_task_id: `t${i}`, route_playbooks: ['data'] } as TelemetryEvent)
    const suggestions = suggestRouterThresholds(events, current)
    expect(suggestions.domain_threshold.coding.kind).toBe('raise')
    if (suggestions.domain_threshold.coding.kind === 'raise') expect(suggestions.domain_threshold.coding.value).toBeCloseTo(0.55)
  })

  it('caps the raised domain_threshold at 0.8', () => {
    const events: TelemetryEvent[] = []
    for (let i = 0; i < 20; i++) events.push(routeEvent({ task_id: `t${i}`, route_playbooks: ['coding'] }))
    for (let i = 0; i < 20; i++) events.push({ ts, session: 's', profile: 'p', kind: 'reroute', task_id: `r${i}`, parent_task_id: `t${i}`, route_playbooks: ['data'] } as TelemetryEvent)
    const suggestions = suggestRouterThresholds(events, { domain_threshold: 0.78, ask_threshold: 0.6 })
    if (suggestions.domain_threshold.coding.kind === 'raise') expect(suggestions.domain_threshold.coding.value).toBe(0.8)
  })

  it('suggests lowering the global domain_threshold when no candidate often qualifies and nothing is rerouted', () => {
    const events2: TelemetryEvent[] = []
    for (let i = 0; i < 15; i++) events2.push(routeEvent({ task_id: `t${i}`, route_playbooks: ['coding'], route_domain: { coding: 0.9, data: 0.1 } }))
    for (let i = 0; i < 10; i++) events2.push(routeEvent({ task_id: `f${i}`, route_playbooks: ['generic'], route_domain: { coding: 0.3, data: 0.2 } }))
    const suggestions = suggestRouterThresholds(events2, current)
    expect(suggestions.global_domain_threshold.kind).toBe('lower')
    if (suggestions.global_domain_threshold.kind === 'lower') expect(suggestions.global_domain_threshold.value).toBeCloseTo(0.45)
    expect(Object.values(suggestions.domain_threshold).every(s => s.kind !== 'lower')).toBe(true)
  })

  it('global domain_threshold: insufficient data under 20 routed tasks, floor 0.3', () => {
    expect(suggestRouterThresholds([routeEvent({ route_domain: { coding: 0.1 } })], current).global_domain_threshold.kind).toBe('insufficient')
    const events3: TelemetryEvent[] = []
    for (let i = 0; i < 20; i++) events3.push(routeEvent({ task_id: `f${i}`, route_playbooks: ['generic'], route_domain: { coding: 0.1 } }))
    const low = suggestRouterThresholds(events3, { domain_threshold: 0.32, ask_threshold: 0.6 }).global_domain_threshold
    if (low.kind === 'lower') expect(low.value).toBe(0.3)
  })

  it('suggests no change when sample size is sufficient but no heuristic fires', () => {
    const events: TelemetryEvent[] = Array.from({ length: 25 }, (_, i) => routeEvent({ task_id: `t${i}`, route_playbooks: ['coding'], route_applied: true }))
    const suggestions = suggestRouterThresholds(events, current)
    expect(suggestions.domain_threshold.coding.kind).toBe('none')
  })

  it('suggests raising ask_threshold when clarify rate is high and reroute rate is low', () => {
    const events: TelemetryEvent[] = []
    for (let i = 0; i < 30; i++) events.push(routeEvent({ task_id: `t${i}`, route_playbooks: ['coding'] }))
    for (let i = 0; i < 12; i++) events.push({ ts, session: 's', profile: 'p', kind: 'clarify', task_id: `t${i}`, attempt: 1 } as TelemetryEvent)
    const suggestions = suggestRouterThresholds(events, current)
    expect(suggestions.ask_threshold.kind).toBe('raise')
    if (suggestions.ask_threshold.kind === 'raise') expect(suggestions.ask_threshold.value).toBeCloseTo(0.65)
  })
})
