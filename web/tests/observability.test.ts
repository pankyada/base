import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { stageFunnel, toolP95, budgetState, budgetLabel, observabilityLabel, Observability, RoutingEvidence } from '../components/ops/Observability'

describe('observability', () => {
  it('computes stage funnel and p95 tool duration', () => {
    expect(stageFunnel([{ stage: 'build', state: 'done' }, { stage: 'build', state: 'escalated' }])[0].runs).toBe(2)
    expect(toolP95([1, 2, 3, 4, 100])).toBe(100)
    expect(budgetState({ cost: 1, limit: 1 })).toBe('budget-exceeded')
    expect(budgetLabel({ cost: 1, limit: 1 })).toBe('budget-exceeded · $1.00 / $1.00')
    expect(budgetLabel({ cost: 1 })).toBeUndefined()
    expect(observabilityLabel({})).toBe('No telemetry yet')
  })

  it('does not present unavailable telemetry as a genuine empty snapshot', () => {
    const unavailable = renderToStaticMarkup(React.createElement(Observability, { state: 'unavailable' }))
    const empty = renderToStaticMarkup(React.createElement(Observability, { state: 'empty' }))
    expect(unavailable).not.toContain('No telemetry yet')
    expect(empty).toContain('No telemetry yet')
  })

  it('shows routing aggregates with their server-wide profile/time scope and read-only suggestions', () => {
    const html = renderToStaticMarkup(React.createElement(RoutingEvidence, { value: {
      scope: { server_wide: true, profile: 'coding', since: '2026-09-01', until: '2026-09-23', sample_count: 24 },
      routeGraph: { hasData: true, playbooks: { coding: { routed: 20 } }, edge: { overall: { total: 18 } }, claims: { checked: 4 }, providerFallbacks: 1 },
      suggestions: { domain_threshold: {}, global_domain_threshold: { kind: 'insufficient', reason: 'insufficient data', sample_size: 20 }, ask_threshold: { kind: 'none', reason: 'no change indicated', sample_size: 20 } },
    } }))
    expect(html).toContain('Server-wide · profile coding · 2026-09-01 to 2026-09-23 · 24 source events')
    expect(html).toContain('selected run does not change its scope')
    expect(html).toContain('Insufficient sample')
    expect(html).toContain('Read only')
    expect(html).not.toContain('Apply')
  })

  it('distinguishes empty routing evidence from an unsupported response', () => {
    const empty = renderToStaticMarkup(React.createElement(RoutingEvidence, { value: { scope: { server_wide: true, sample_count: 0 }, routeGraph: { hasData: false }, suggestions: { domain_threshold: {}, global_domain_threshold: { kind: 'insufficient', reason: 'insufficient data', sample_size: 0 }, ask_threshold: { kind: 'insufficient', reason: 'insufficient data', sample_size: 0 } } } }))
    const unsupported = renderToStaticMarkup(React.createElement(RoutingEvidence, { value: {} }))
    expect(empty).toContain('No routing graph data in this scope')
    expect(unsupported).toContain('unavailable from this server response')
  })
})
