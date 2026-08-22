import { describe, expect, it } from 'vitest'
import { aggregateMetrics } from '../src/telemetry/aggregate.js'
import type { TelemetryEvent } from '../src/types.js'

const events: TelemetryEvent[] = [
  { ts: '2026-08-14T16:30:00Z', session: 's1', profile: 'coding', kind: 'tool', name: 'Read', ok: true, duration_ms: 10, cost_usd: 0.1 },
  { ts: '2026-08-14T17:30:00Z', session: 's2', profile: 'coding', kind: 'tool', name: 'Read', ok: false, duration_ms: 30, cost_usd: 0.2 },
  { ts: '2026-08-15T00:30:00+10:00', session: 's1', profile: 'coding', kind: 'llm', model: 'm1', tokens_in: 100, tokens_out: 20, cost_usd: 0.3 },
  { ts: '2026-08-15T00:45:00+10:00', session: 's1', profile: 'coding', kind: 'stage', stage: 'build', state: 'escalated', cost_usd: 0.4 },
  { ts: '2026-08-15T01:00:00+10:00', session: 's1', profile: 'coding', kind: 'stage', stage: 'build', state: 'done', verify_first_try: true, cost_usd: 0.1 },
  { ts: '2026-08-15T02:00:00Z', session: 's3', profile: 'coding', kind: 'tool' },
  { ts: '2026-08-15T02:00:00Z', session: 's3', profile: 'coding', kind: 'llm' },
  { ts: '2026-08-15T02:00:00Z', session: 's3', profile: 'coding', kind: 'stage' },
]

describe('aggregateMetrics', () => {
  it('aggregates tool rates, percentiles, model usage, and stage outcomes', () => {
    const report = aggregateMetrics(events)

    expect(report.window.events).toBe(8)
    expect(report.tools).toEqual([{ name: 'Read', calls: 2, ok_rate: 0.5, p50_ms: 20, p95_ms: 30, cost_usd: 0.3 }])
    expect(report.models).toEqual([{ id: 'm1', calls: 1, tokens_in: 100, tokens_out: 20, cost_usd: 0.3 }])
    expect(report.stages).toEqual([{ stage: 'build', runs: 2, escalations: 1, verify_first_try: 1, cost_usd: 0.5 }])
  })

  it('buckets days by the instant represented by offset timestamps', () => {
    const report = aggregateMetrics(events)

    expect(report.daily).toContainEqual({ day: '2026-08-14', cost_usd: 1.1, sessions: 2 })
  })

  it('returns empty sections and filters without optional fields', () => {
    expect(aggregateMetrics([])).toMatchObject({ window: { events: 0 }, tools: [], models: [], stages: [], daily: [] })
    expect(aggregateMetrics(events, { profile: 'missing' }).window.events).toBe(0)
  })
})
