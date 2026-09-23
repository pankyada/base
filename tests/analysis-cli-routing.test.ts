import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../src/telemetry/query.js', () => ({ queryEvents: vi.fn() }))

import { queryEvents } from '../src/telemetry/query.js'
import { routingStats } from '../src/analysis/cli.js'
import type { TelemetryEvent } from '../src/types.js'

const ts = new Date().toISOString()

describe('routingStats CLI output (roadmap #31 phase 6, PT-081)', () => {
  beforeEach(() => { vi.mocked(queryEvents).mockReset() })

  it('reports no data for both sections when telemetry is empty', () => {
    vi.mocked(queryEvents).mockReturnValue([])
    const output = routingStats()
    expect(output).toContain('No routing data.')
    expect(output).toContain('Routing graph: no routing data.')
  })

  it('includes a routing graph section with playbook and edge/claim stats', () => {
    const events: TelemetryEvent[] = [
      { ts, session: 's', profile: 'p', kind: 'route', task_id: 't1', route_decision_kind: 'run', route_playbooks: ['coding'], route_applied: true } as TelemetryEvent,
      { ts, session: 's', profile: 'p', kind: 'edge', task_id: 't1', stage: 'build', edge_regex: 'continue', edge_jev: 'continue', edge_agree: true, edge_applied: true } as TelemetryEvent,
      { ts, session: 's', profile: 'p', kind: 'claim_check', task_id: 't1', claim_count: 2, claim_verdict: 'pass' } as TelemetryEvent,
    ]
    vi.mocked(queryEvents).mockReturnValue(events)
    const output = routingStats()
    expect(output).toContain('Routing graph:')
    expect(output).toContain('coding')
    expect(output).toContain('claim_check: checked=1 fail=0')
  })

  it('--json mode returns parseable JSON with cells and routeGraph', () => {
    const events: TelemetryEvent[] = [
      { ts, session: 's', profile: 'p', kind: 'route', task_id: 't1', route_decision_kind: 'run', route_playbooks: ['coding'], route_applied: true } as TelemetryEvent,
    ]
    vi.mocked(queryEvents).mockReturnValue(events)
    const output = routingStats({ json: true })
    const parsed = JSON.parse(output)
    expect(parsed).toHaveProperty('cells')
    expect(parsed).toHaveProperty('routeGraph')
    expect(parsed.routeGraph.playbooks.coding.routed).toBe(1)
  })

  it('--suggest appends a threshold-suggestions section', () => {
    const events: TelemetryEvent[] = Array.from({ length: 25 }, (_, i) => ({ ts, session: 's', profile: 'p', kind: 'route', task_id: `t${i}`, route_decision_kind: 'run', route_playbooks: ['coding'], route_applied: true } as TelemetryEvent))
    vi.mocked(queryEvents).mockReturnValue(events)
    const output = routingStats({ suggest: true })
    expect(output).toContain('Threshold suggestions')
    expect(output).toContain('domain_threshold[coding]')
  })

  it('--suggest --json includes suggestions in the JSON payload', () => {
    const events: TelemetryEvent[] = Array.from({ length: 25 }, (_, i) => ({ ts, session: 's', profile: 'p', kind: 'route', task_id: `t${i}`, route_decision_kind: 'run', route_playbooks: ['coding'], route_applied: true } as TelemetryEvent))
    vi.mocked(queryEvents).mockReturnValue(events)
    const output = routingStats({ suggest: true, json: true })
    const parsed = JSON.parse(output)
    expect(parsed).toHaveProperty('suggestions')
    expect(parsed.suggestions.domain_threshold.coding).toBeDefined()
  })
})
