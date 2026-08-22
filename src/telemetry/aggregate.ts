import type { TelemetryEvent } from '../types.js'

export interface MetricsReport {
  window: { since?: string; until?: string; events: number }
  tools: Array<{ name: string; calls: number; ok_rate: number | null; p50_ms: number | null; p95_ms: number | null; cost_usd: number }>
  models: Array<{ id: string; calls: number; tokens_in: number; tokens_out: number; cost_usd: number }>
  stages: Array<{ stage: string; runs: number; escalations: number; verify_first_try: number | null; cost_usd: number }>
  daily: Array<{ day: string; cost_usd: number; sessions: number }>
}

export interface MetricsOptions {
  since?: Date
  until?: Date
  profile?: string
  kind?: TelemetryEvent['kind']
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function rounded(value: number): number {
  return Math.round(value * 1e12) / 1e12
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  if (p === 0.5 && sorted.length % 2 === 0) {
    const right = sorted.length / 2
    return (sorted[right - 1] + sorted[right]) / 2
  }
  return sorted[Math.ceil(sorted.length * p) - 1]
}

export function aggregateMetrics(events: TelemetryEvent[], opts: MetricsOptions = {}): MetricsReport {
  const filtered = events.filter(event => {
    const timestamp = new Date(event.ts)
    if (Number.isNaN(timestamp.getTime())) return false
    if (opts.since && timestamp < opts.since) return false
    if (opts.until && timestamp > opts.until) return false
    if (opts.profile && event.profile !== opts.profile) return false
    if (opts.kind && event.kind !== opts.kind) return false
    return true
  })
  const toolRows = new Map<string, { calls: number; ok: number; settled: number; durations: number[]; cost: number }>()
  const modelRows = new Map<string, { calls: number; tokensIn: number; tokensOut: number; cost: number }>()
  const stageRows = new Map<string, { runs: number; escalations: number; verified: number; firstTry: number; cost: number }>()
  const dailyRows = new Map<string, { cost: number; sessions: Set<string> }>()

  for (const event of filtered) {
    const day = new Date(event.ts).toISOString().slice(0, 10)
    const daily = dailyRows.get(day) ?? { cost: 0, sessions: new Set<string>() }
    daily.cost += number(event.cost_usd)
    daily.sessions.add(event.session)
    dailyRows.set(day, daily)

    if (event.kind === 'tool' && event.name) {
      const row = toolRows.get(event.name) ?? { calls: 0, ok: 0, settled: 0, durations: [], cost: 0 }
      row.calls += 1
      if (typeof event.ok === 'boolean') {
        row.settled += 1
        if (event.ok) row.ok += 1
      }
      if (typeof event.duration_ms === 'number' && Number.isFinite(event.duration_ms)) row.durations.push(event.duration_ms)
      row.cost += number(event.cost_usd)
      toolRows.set(event.name, row)
    }

    if (event.kind === 'llm' && event.model) {
      const row = modelRows.get(event.model) ?? { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0 }
      row.calls += 1
      row.tokensIn += number(event.tokens_in)
      row.tokensOut += number(event.tokens_out)
      row.cost += number(event.cost_usd)
      modelRows.set(event.model, row)
    }

    if (event.kind === 'stage' && event.stage) {
      const row = stageRows.get(event.stage) ?? { runs: 0, escalations: 0, verified: 0, firstTry: 0, cost: 0 }
      row.runs += 1
      if (event.state === 'escalated' || event.escalated_from) row.escalations += 1
      if (typeof event.verify_first_try === 'boolean') {
        row.verified += 1
        if (event.verify_first_try) row.firstTry += 1
      }
      row.cost += number(event.cost_usd)
      stageRows.set(event.stage, row)
    }
  }

  return {
    window: { ...(opts.since ? { since: opts.since.toISOString() } : {}), ...(opts.until ? { until: opts.until.toISOString() } : {}), events: filtered.length },
    tools: [...toolRows.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, row]) => ({ name, calls: row.calls, ok_rate: row.settled ? rounded(row.ok / row.settled) : null, p50_ms: percentile(row.durations, 0.5), p95_ms: percentile(row.durations, 0.95), cost_usd: rounded(row.cost) })),
    models: [...modelRows.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, row]) => ({ id, calls: row.calls, tokens_in: row.tokensIn, tokens_out: row.tokensOut, cost_usd: rounded(row.cost) })),
    stages: [...stageRows.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([stage, row]) => ({ stage, runs: row.runs, escalations: row.escalations, verify_first_try: row.verified ? rounded(row.firstTry / row.verified) : null, cost_usd: rounded(row.cost) })),
    daily: [...dailyRows.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, row]) => ({ day, cost_usd: rounded(row.cost), sessions: row.sessions.size })),
  }
}
