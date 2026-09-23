import React from 'react'

export function toolP95(values: number[]): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] }
export function stageFunnel(events: { stage: string; state: string }[]): { stage: string; runs: number; escalations: number }[] { return [...new Set(events.map(event => event.stage))].map(stage => ({ stage, runs: events.filter(event => event.stage === stage).length, escalations: events.filter(event => event.stage === stage && event.state === 'escalated').length })) }
export function budgetState(budget: { cost: number; limit?: number }): 'running' | 'budget-exceeded' { return budget.limit != null && budget.cost >= budget.limit ? 'budget-exceeded' : 'running' }
export function budgetLabel(budget?: { cost: number; limit?: number }): string | undefined { return budget?.limit == null ? undefined : budgetState(budget) + ' · $' + budget.cost.toFixed(2) + ' / $' + budget.limit.toFixed(2) }
export function observabilityLabel(report: Record<string, unknown>): string { return Object.keys(report).length ? JSON.stringify(report, null, 2) : 'No telemetry yet' }
type MetricReport = { metrics?: { window?: { events?: number }; tools?: Array<{ name: string; calls: number; ok_rate: number | null; p95_ms: number | null; cost_usd: number }>; models?: Array<{ id: string; calls: number; cost_usd: number }>; stages?: Array<{ stage: string; runs: number; escalations: number; verify_first_try: number | null; cost_usd: number }> }; usage?: { cost_usd?: number }; routing?: unknown }
type ThresholdSuggestionView = { kind: 'raise' | 'lower' | 'none' | 'insufficient'; value?: number; reason?: string; sample_size?: number }
type RoutingRead = {
  scope?: { server_wide?: boolean; profile?: string; since?: string; until?: string; sample_count?: number }
  routeGraph?: { hasData?: boolean; playbooks?: Record<string, { routed?: number; applied?: number; fallback?: number }>; rerouteRate?: number | null; providerFallbacks?: number; clarify?: { askCount?: number; routedCount?: number }; edge?: { overall?: { agree?: number; total?: number; agreement_rate?: number | null } }; claims?: { checked?: number; fail?: number; fallback?: number } }
  suggestions?: { domain_threshold?: Record<string, ThresholdSuggestionView>; global_domain_threshold?: ThresholdSuggestionView; ask_threshold?: ThresholdSuggestionView }
}
// /metrics and /stats/routing are intentionally aggregate reads (see src/server/read-api.ts — no `user` scoping, /metrics filters by profile only, /stats/routing filters by nothing). Label them so an operator does not mistake server-wide numbers for their own.
export type TelemetryReadState = 'loading' | 'ready' | 'empty' | 'stale' | 'unavailable'
function suggestionText(item: ThresholdSuggestionView): string {
  const decision = item.kind === 'insufficient' ? 'Insufficient sample' : item.kind === 'none' ? 'No change suggested' : `${item.kind} to ${item.value?.toFixed(2) ?? 'unknown'}`
  return `${decision} · ${item.reason ?? 'No reason supplied'} · n=${item.sample_size ?? 'unknown'}`
}

export function RoutingEvidence({ value }: { value?: unknown }) {
  const read = (value && typeof value === 'object' ? value : {}) as RoutingRead
  const scope = read.scope
  const graph = read.routeGraph
  const suggestions = read.suggestions
  const scopeText = scope?.server_wide
    ? `Server-wide · profile ${scope.profile ?? 'all'} · ${scope.since ?? 'all retained'} to ${scope.until ?? 'now'} · ${scope.sample_count ?? 0} source events`
    : 'Server-wide aggregate scope unavailable'
  return <section className="routing-evidence" data-testid="routing-evidence" aria-label="Routing statistics and suggestions">
    <header><div><h3>Routing statistics &amp; suggestions</h3><p>{scopeText}</p></div><span>Read only</span></header>
    <p className="routing-evidence__scope">This is a server-wide profile/time aggregate. The selected run does not change its scope.</p>
    {!graph ? <p role="status">Routing graph statistics are unavailable from this server response.</p> : graph.hasData === false ? <p role="status">No routing graph data in this scope.</p> : <div className="routing-evidence__stats">
      <span>{Object.keys(graph.playbooks ?? {}).length} routed playbooks</span>
      <span>{graph.edge?.overall?.total ?? 0} edge comparisons</span>
      <span>{graph.claims?.checked ?? 0} claim checks</span>
      <span>{graph.providerFallbacks ?? 0} provider fallbacks</span>
    </div>}
    {suggestions ? <div className="routing-evidence__suggestions"><h4>Threshold suggestions</h4>
      {suggestions.global_domain_threshold ? <p><strong>Global domain threshold</strong><span>{suggestionText(suggestions.global_domain_threshold)}</span></p> : null}
      {suggestions.ask_threshold ? <p><strong>Ask threshold</strong><span>{suggestionText(suggestions.ask_threshold)}</span></p> : null}
      {Object.entries(suggestions.domain_threshold ?? {}).map(([name, suggestion]) => <p key={name}><strong>{name} threshold</strong><span>{suggestionText(suggestion)}</span></p>)}
      {!suggestions.global_domain_threshold && !suggestions.ask_threshold && !Object.keys(suggestions.domain_threshold ?? {}).length ? <p role="status">No threshold suggestions returned.</p> : null}
    </div> : <p role="status">Threshold suggestions unavailable.</p>}
  </section>
}

export function Observability({ report = {}, budget, state = 'empty' }: { report?: Record<string, unknown>; budget?: { cost: number; limit?: number }; state?: TelemetryReadState }) {
  const metric = report as MetricReport
  const metrics = metric.metrics
  const hasMetrics = Boolean(metrics && (metrics.tools?.length || metrics.models?.length || metrics.stages?.length || metrics.window?.events != null))
  const toolCalls = metrics?.tools ? metrics.tools.reduce((sum, item) => sum + item.calls, 0) : undefined
  const cost = metric.usage?.cost_usd ?? (metrics?.tools ? metrics.tools.reduce((sum, item) => sum + item.cost_usd, 0) : undefined)
  const rawLabel = state === 'unavailable' ? 'Telemetry unavailable'
    : state === 'loading' ? 'Telemetry loading'
      : state === 'stale' && !Object.keys(report).length ? 'No prior telemetry snapshot is available'
        : observabilityLabel(report)
  return <section className="observability">
    <h2>Observability</h2>
    <p className="muted" data-testid="observability-scope-note">Metrics and routing stats are aggregate across all users (server-wide, not scoped to your identity).</p>
    {budgetLabel(budget) ? <strong data-testid="budget-state">{budgetLabel(budget)}</strong> : null}
    {hasMetrics ? <>
      <div className="metric-tiles" aria-label="Telemetry summary">
        <div><small>Events</small><strong>{metrics?.window?.events ?? '—'}</strong></div>
        <div><small>Cost</small><strong>{cost == null ? '—' : `$${cost.toFixed(4)}`}</strong></div>
        <div><small>Tools</small><strong>{toolCalls ?? '—'}</strong></div>
        <div><small>Models</small><strong>{metrics?.models ? metrics.models.length : '—'}</strong></div>
      </div>
      <h3>Tool outcomes</h3>
      <table><thead><tr><th>Tool</th><th>Calls</th><th>Success</th><th>P95</th></tr></thead><tbody>{metrics?.tools?.map(item => <tr key={item.name}><td>{item.name}</td><td>{item.calls}</td><td>{item.ok_rate == null ? '—' : `${Math.round(item.ok_rate * 100)}%`}</td><td>{item.p95_ms == null ? '—' : `${item.p95_ms} ms`}</td></tr>)}</tbody></table>
      <h3>Stages</h3>
      <table><thead><tr><th>Stage</th><th>Runs</th><th>Escalations</th><th>First try</th></tr></thead><tbody>{metrics?.stages?.map(item => <tr key={item.stage}><td>{item.stage}</td><td>{item.runs}</td><td>{item.escalations}</td><td>{item.verify_first_try == null ? '—' : `${Math.round(item.verify_first_try * 100)}%`}</td></tr>)}</tbody></table>
    </> : state === 'empty' ? <p role="status">No telemetry yet</p> : null}
    <RoutingEvidence value={metric.routing} />
    <details><summary>Raw telemetry</summary><pre>{rawLabel}</pre></details>
  </section>
}
