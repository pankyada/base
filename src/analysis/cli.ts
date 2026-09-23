import { queryEvents } from '../telemetry/query.js'
import { aggregateRouting, aggregateRouteGraph, suggestRouterThresholds } from './routing.js'

export interface RoutingStatsArgs {
  since?: Date
  stage?: string
  taskClass?: string
  shadow?: boolean
  suggest?: boolean
  json?: boolean
  /** Current thresholds to base `--suggest` output on. Defaults match the schema defaults. */
  domainThreshold?: number
  askThreshold?: number
}

function formatCellRows(report: ReturnType<typeof aggregateRouting>): string {
  const rows = Object.values(report.cells)
  if (!rows.length) return ''
  return rows.map(c => {
    const enough = c.n >= 8 && c.first_try_rate !== null
    const metrics = enough
      ? `first_try=${(c.first_try_rate! * 100).toFixed(1)}% cost/accepted=$${(c.cost_per_accepted_task ?? 0).toFixed(4)}`
      : 'insufficient data'
    return `${c.task_class}\t${c.blast_radius}\t${c.stage}\t${c.tier}\tn=${c.n}\t${metrics}`
  }).join('\n')
}

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`
}

function formatRouteGraph(events: ReturnType<typeof queryEvents>, args: RoutingStatsArgs): string {
  const graph = aggregateRouteGraph(events, { since: args.since })
  if (!graph.hasData) return 'Routing graph: no routing data.'

  const lines: string[] = ['Routing graph:']
  const playbookRows = Object.values(graph.playbooks)
  if (playbookRows.length) {
    lines.push('  playbook\trouted\tapplied\tfallback')
    for (const p of playbookRows) lines.push(`  ${p.playbook}\t${p.routed}\t${p.applied}\t${p.fallback}`)
  } else {
    lines.push('  playbooks: no routed tasks')
  }

  const confusionEntries = Object.entries(graph.confusion)
  if (confusionEntries.length) {
    lines.push('  confusion (chosen -> rerouted_to):')
    for (const [chosen, targets] of confusionEntries) {
      for (const [target, count] of Object.entries(targets)) lines.push(`    ${chosen} -> ${target}: ${count}`)
    }
  }
  lines.push(`  reroute_rate: ${pct(graph.rerouteRate)}`)
  lines.push(`  provider_fallbacks: ${graph.providerFallbacks}`)
  lines.push(`  clarify_rate: ${pct(graph.clarify.rate)} (ask_decisions=${graph.clarify.askCount}, routed=${graph.clarify.routedCount})`)
  lines.push(`  edge_agreement: ${pct(graph.edge.overall.agreement_rate)} (n=${graph.edge.overall.total})`)
  for (const [stage, agreement] of Object.entries(graph.edge.byStage)) {
    lines.push(`    ${stage}: ${pct(agreement.agreement_rate)} (n=${agreement.total})`)
  }
  const appliedActions = Object.entries(graph.edge.appliedActions)
  if (appliedActions.length) {
    lines.push('  edge_applied_actions:')
    for (const [action, count] of appliedActions) lines.push(`    ${action}: ${count}`)
  }
  lines.push(`  claim_check: checked=${graph.claims.checked} fail=${graph.claims.fail} fail_rate=${pct(graph.claims.fail_rate)} fallback=${graph.claims.fallback}`)
  const skippedEntries = Object.entries(graph.claims.skipped)
  if (skippedEntries.length) {
    lines.push('  claim_check_skipped:')
    for (const [reason, count] of skippedEntries) lines.push(`    ${reason}: ${count}`)
  }
  return lines.join('\n')
}

function formatSuggestions(events: ReturnType<typeof queryEvents>, args: RoutingStatsArgs): string {
  const current = { domain_threshold: args.domainThreshold ?? 0.5, ask_threshold: args.askThreshold ?? 0.7 }
  const suggestions = suggestRouterThresholds(events, current)
  const lines: string[] = ['Threshold suggestions (human-in-the-loop, nothing auto-applied):']
  for (const [name, suggestion] of Object.entries(suggestions.domain_threshold)) {
    if (suggestion.kind === 'insufficient') { lines.push(`  domain_threshold[${name}]: insufficient data (n=${suggestion.sample_size})`); continue }
    if (suggestion.kind === 'none') { lines.push(`  domain_threshold[${name}]: no change (n=${suggestion.sample_size})`); continue }
    lines.push(`  domain_threshold[${name}]: ${suggestion.kind} to ${suggestion.value} — ${suggestion.reason} (n=${suggestion.sample_size})`)
  }
  for (const [label, suggestion] of [['domain_threshold (global)', suggestions.global_domain_threshold], ['ask_threshold', suggestions.ask_threshold]] as const) {
    if (suggestion.kind === 'insufficient') lines.push(`  ${label}: insufficient data (n=${suggestion.sample_size})`)
    else if (suggestion.kind === 'none') lines.push(`  ${label}: no change (n=${suggestion.sample_size})`)
    else lines.push(`  ${label}: ${suggestion.kind} to ${suggestion.value} — ${suggestion.reason} (n=${suggestion.sample_size})`)
  }
  return lines.join('\n')
}

export function routingStats(args: RoutingStatsArgs = {}): string {
  const events = queryEvents({})
  const report = aggregateRouting(events, args)

  if (args.json) {
    const graph = aggregateRouteGraph(events, { since: args.since })
    const payload: Record<string, unknown> = { cells: report.cells, routeGraph: graph }
    if (args.suggest) payload.suggestions = suggestRouterThresholds(events, { domain_threshold: args.domainThreshold ?? 0.5, ask_threshold: args.askThreshold ?? 0.7 })
    return JSON.stringify(payload, null, 2)
  }

  const cellRows = formatCellRows(report)
  const sections = [cellRows || 'No routing data.', formatRouteGraph(events, args)]
  if (args.suggest) sections.push(formatSuggestions(events, args))
  return sections.join('\n\n')
}
