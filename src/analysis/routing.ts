import type { TelemetryEvent } from '../types.js'

// Roadmap #31 phase 6 (PT-081, spec §6): routing graph telemetry aggregation
// and threshold-suggestion heuristics, computed purely from telemetry (no
// raw request/artifact text ever appears in these events — see §5.8).

export interface RoutingCell {
  task_class: string
  blast_radius: string
  stage: string
  tier: string
  n: number
  total_cost: number
  cost_per_accepted_task: number | null
  first_try_rate: number | null
  rework_rate: number | null
  escalation_rate: number | null
  mean_human_edit_churn: number | null
  consecutive_escalations?: number
  reversibility?: string
}

export interface RoutingReport { cells: Record<string, RoutingCell> }

interface Accumulator {
  taskIds: Set<string>
  cost: number
  escalatedTaskIds: Set<string>
  churnByTask: Map<string, number>
  // Trailing streak of escalated closes ending at the most recent event seen
  // so far, in timestamp order — resets to 0 on any non-escalated close.
  // This is "consecutive" in the literal sense: two escalations separated by
  // successful closes must NOT count, otherwise the adaptive policy ratchets
  // tiers up permanently instead of only on a sustained failure pattern.
  currentStreak: number
  reversibility?: string
}

function mergedOutcomes(events: TelemetryEvent[], includeShadow: boolean): Map<string, TelemetryEvent> {
  const outcomes = new Map<string, TelemetryEvent>()
  for (const event of events) {
    if (event.kind !== 'outcome' || !event.task_id || (!includeShadow && event.explore)) continue
    outcomes.set(event.task_id, { ...(outcomes.get(event.task_id) ?? {}), ...event })
  }
  return outcomes
}

export function aggregateRouting(events: TelemetryEvent[], opts: { since?: Date; stage?: string; taskClass?: string; shadow?: boolean } = {}): RoutingReport {
  const relevant = events.filter(event =>
    (!opts.since || new Date(event.ts) >= opts.since) &&
    (!opts.stage || event.stage === opts.stage) &&
    (!opts.taskClass || event.task_class === opts.taskClass) &&
    (opts.shadow || !event.explore)
  )
  const outcomes = mergedOutcomes(events, opts.shadow === true)
  const cells = new Map<string, Accumulator>()
  // Stage closes must be processed oldest-first per cell so the trailing
  // escalation streak reflects real recency, not telemetry read order.
  const closes = relevant
    .filter(event => event.kind === 'stage' && event.stage && event.tier && event.task_class && event.blast_radius && event.state !== 'start')
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  for (const event of closes) {
    const key = `${event.task_class}|${event.blast_radius}|${event.stage}|${event.tier}`
    const cell: Accumulator = cells.get(key) ?? { taskIds: new Set(), cost: 0, escalatedTaskIds: new Set(), churnByTask: new Map(), currentStreak: 0 }
    const taskId = event.task_id ?? `${event.session}:${event.stage_id ?? key}`
    cell.taskIds.add(taskId)
    cell.cost += event.cost_usd ?? 0
    if (event.state === 'escalated' || event.escalated_from) {
      cell.escalatedTaskIds.add(taskId)
      cell.currentStreak++
    } else {
      cell.currentStreak = 0
    }
    cell.reversibility ??= event.reversibility
    const outcome = outcomes.get(taskId)
    if (outcome?.human_edit_churn !== undefined) cell.churnByTask.set(taskId, outcome.human_edit_churn)
    cells.set(key, cell)
  }

  const output: Record<string, RoutingCell> = {}
  for (const [key, accumulator] of cells) {
    const [task_class, blast_radius, stage, tier] = key.split('|')
    const taskIds = [...accumulator.taskIds]
    const labels = taskIds.map(taskId => outcomes.get(taskId)).filter(Boolean) as TelemetryEvent[]
    const accepted = labels.filter(label => label.verdict === 'accepted').length
    const firstTry = labels.filter(label => label.verify_first_try !== undefined)
    const reworked = labels.filter(label => label.verdict === 'reworked' || (label.rework_count ?? 0) > 0).length
    const enough = accumulator.taskIds.size >= 8
    const churn = [...accumulator.churnByTask.values()]
    output[key] = {
      task_class, blast_radius, stage, tier,
      n: accumulator.taskIds.size,
      total_cost: accumulator.cost,
      cost_per_accepted_task: accepted > 0 ? accumulator.cost / accepted : null,
      first_try_rate: enough && firstTry.length > 0 ? firstTry.filter(label => label.verify_first_try === true).length / firstTry.length : null,
      rework_rate: enough && labels.length > 0 ? reworked / labels.length : null,
      escalation_rate: enough ? accumulator.escalatedTaskIds.size / accumulator.taskIds.size : null,
      mean_human_edit_churn: churn.length > 0 ? churn.reduce((sum, value) => sum + value, 0) / churn.length : null,
      consecutive_escalations: accumulator.currentStreak,
      reversibility: accumulator.reversibility,
    }
  }
  return { cells: output }
}

// --- Routing graph (route/edge/reroute/clarify/claim_check telemetry) ---

export interface RoutePlaybookStat {
  playbook: string
  routed: number
  applied: number
  fallback: number
}

export interface EdgeAgreement {
  agree: number
  total: number
  agreement_rate: number | null
}

export interface ClaimCheckStats {
  checked: number
  fail: number
  skipped: Record<string, number>
  fallback: number
  fail_rate: number | null
}

export interface RouteGraphReport {
  /** false when there is no route/edge/reroute/clarify/claim_check telemetry at all. */
  hasData: boolean
  playbooks: Record<string, RoutePlaybookStat>
  /** chosen playbook -> rerouted-to playbook -> count. */
  confusion: Record<string, Record<string, number>>
  rerouteRate: number | null
  /**
   * `route` events carrying `route_fallback` (a Jev/provider failure that
   * degraded to today's non-routed path — incomplete signals or a thrown
   * error in `resolveRoute`) never carry a chosen playbook, since no
   * decision was computed. Counted here rather than under `playbooks[name]`
   * per §5.8's actual telemetry shape.
   */
  providerFallbacks: number
  clarify: { rate: number | null; askCount: number; routedCount: number }
  edge: { overall: EdgeAgreement; byStage: Record<string, EdgeAgreement>; appliedActions: Record<string, number> }
  claims: ClaimCheckStats
}

export function aggregateRouteGraph(events: TelemetryEvent[], opts: { since?: Date } = {}): RouteGraphReport {
  const relevant = events.filter(event => !opts.since || new Date(event.ts) >= opts.since)
  const routeEvents = relevant.filter(event => event.kind === 'route')
  const clarifyEvents = relevant.filter(event => event.kind === 'clarify')
  const edgeEvents = relevant.filter(event => event.kind === 'edge')
  const rerouteEvents = relevant.filter(event => event.kind === 'reroute')
  const claimEvents = relevant.filter(event => event.kind === 'claim_check')

  const runEvents = routeEvents.filter(event => event.route_decision_kind === 'run')
  const askEvents = routeEvents.filter(event => event.route_decision_kind === 'ask')

  const playbooks: Record<string, RoutePlaybookStat> = {}
  const ensure = (name: string): RoutePlaybookStat => playbooks[name] ?? (playbooks[name] = { playbook: name, routed: 0, applied: 0, fallback: 0 })
  for (const event of runEvents) {
    const primary = event.route_playbooks?.[0]
    if (!primary) continue
    const cell = ensure(primary)
    cell.routed++
    if (event.route_applied) cell.applied++
    if (event.route_fallback) cell.fallback++
  }

  // A rerouted task's `reroute` event carries `parent_task_id` = the routed
  // task it left, and `route_playbooks[0]` = the target it moved to.
  const rerouteTargetsByParent = new Map<string, string[]>()
  for (const event of rerouteEvents) {
    if (!event.parent_task_id) continue
    const target = event.route_playbooks?.[0]
    if (!target) continue
    const list = rerouteTargetsByParent.get(event.parent_task_id) ?? []
    list.push(target)
    rerouteTargetsByParent.set(event.parent_task_id, list)
  }

  const confusion: Record<string, Record<string, number>> = {}
  let reroutedCount = 0
  for (const event of runEvents) {
    if (!event.task_id) continue
    const chosen = event.route_playbooks?.[0]
    if (!chosen) continue
    const targets = rerouteTargetsByParent.get(event.task_id)
    if (targets && targets.length > 0) {
      reroutedCount++
      const row = confusion[chosen] ?? (confusion[chosen] = {})
      for (const target of targets) row[target] = (row[target] ?? 0) + 1
    }
  }
  const rerouteRate = runEvents.length > 0 ? reroutedCount / runEvents.length : null
  const providerFallbacks = routeEvents.filter(event => event.route_fallback !== undefined).length
  const clarifyRate = runEvents.length > 0 ? clarifyEvents.length / runEvents.length : null

  const edgeWithBoth = edgeEvents.filter(event => event.edge_regex !== undefined && event.edge_jev !== undefined)
  const overallAgree = edgeWithBoth.filter(event => event.edge_agree === true).length
  const overall: EdgeAgreement = { agree: overallAgree, total: edgeWithBoth.length, agreement_rate: edgeWithBoth.length > 0 ? overallAgree / edgeWithBoth.length : null }
  const byStage: Record<string, EdgeAgreement> = {}
  for (const event of edgeWithBoth) {
    const stage = String(event.stage ?? 'unknown')
    const cell = byStage[stage] ?? (byStage[stage] = { agree: 0, total: 0, agreement_rate: null })
    cell.total++
    if (event.edge_agree === true) cell.agree++
  }
  for (const cell of Object.values(byStage)) cell.agreement_rate = cell.total > 0 ? cell.agree / cell.total : null

  const appliedActions: Record<string, number> = {}
  for (const event of edgeEvents) {
    if (!event.edge_applied || !event.edge_jev) continue
    appliedActions[event.edge_jev] = (appliedActions[event.edge_jev] ?? 0) + 1
  }

  const checked = claimEvents.filter(event => event.claim_verdict !== undefined).length
  const fail = claimEvents.filter(event => event.claim_verdict === 'fail').length
  const skipped: Record<string, number> = {}
  for (const event of claimEvents) {
    if (event.claim_skipped) skipped[event.claim_skipped] = (skipped[event.claim_skipped] ?? 0) + 1
  }
  const fallback = claimEvents.filter(event => event.claim_fallback !== undefined).length
  const failRate = checked > 0 ? fail / checked : null

  const hasData = routeEvents.length + edgeEvents.length + rerouteEvents.length + claimEvents.length + clarifyEvents.length > 0

  return {
    hasData,
    playbooks,
    confusion,
    rerouteRate,
    providerFallbacks,
    clarify: { rate: clarifyRate, askCount: askEvents.length, routedCount: runEvents.length },
    edge: { overall, byStage, appliedActions },
    claims: { checked, fail, skipped, fallback, fail_rate: failRate },
  }
}

const MIN_THRESHOLD_SAMPLE = 20
const RAISE_STEP = 0.05
const DOMAIN_THRESHOLD_CAP = 0.8
const DOMAIN_THRESHOLD_FLOOR = 0.3

export type ThresholdSuggestion =
  | { kind: 'raise' | 'lower'; value: number; reason: string; sample_size: number }
  | { kind: 'none'; reason: string; sample_size: number }
  | { kind: 'insufficient'; reason: 'insufficient data'; sample_size: number }

export interface ThresholdSuggestions {
  domain_threshold: Record<string, ThresholdSuggestion>
  /** Global threshold: lowered when no candidate often qualifies (computed from `route_domain`). */
  global_domain_threshold: ThresholdSuggestion
  ask_threshold: ThresholdSuggestion
}

/**
 * Pure, explainable heuristics over telemetry-only routing-graph stats (no
 * request/artifact text ever seen). Never writes anything — callers decide
 * whether to act on a suggestion (spec §6: human-in-the-loop, no auto-write).
 *
 * Heuristics (sample size >= MIN_THRESHOLD_SAMPLE required per playbook /
 * overall, else 'insufficient data'):
 *  - domain_threshold: a playbook whose routed tasks are frequently
 *    rerouted away from it (>30%) is being chosen too eagerly -> raise its
 *    threshold by 0.05 (capped at 0.8).
 *  - domain_threshold: a playbook that is never rerouted away from but has a
 *    high fallback rate (>30%) is being missed too often -> lower its
 *    threshold by 0.05 (floored at 0.3).
 *  - ask_threshold: a clarify rate above 30% with a low subsequent reroute
 *    rate (<15%) suggests asking too often for marginal benefit -> raise the
 *    global ask_threshold by 0.05.
 */
export function suggestRouterThresholds(events: TelemetryEvent[], current: { domain_threshold: number; ask_threshold: number }): ThresholdSuggestions {
  const graph = aggregateRouteGraph(events)
  const domain_threshold: Record<string, ThresholdSuggestion> = {}
  for (const [name, stat] of Object.entries(graph.playbooks)) {
    if (stat.routed < MIN_THRESHOLD_SAMPLE) {
      domain_threshold[name] = { kind: 'insufficient', reason: 'insufficient data', sample_size: stat.routed }
      continue
    }
    const rerouted = Object.values(graph.confusion[name] ?? {}).reduce((sum, count) => sum + count, 0)
    const rerouteAwayRate = rerouted / stat.routed
    if (rerouteAwayRate > 0.3) {
      domain_threshold[name] = {
        kind: 'raise',
        value: Math.min(DOMAIN_THRESHOLD_CAP, current.domain_threshold + RAISE_STEP),
        reason: `reroute-away rate ${(rerouteAwayRate * 100).toFixed(0)}% exceeds 30%`,
        sample_size: stat.routed,
      }
    } else {
      domain_threshold[name] = { kind: 'none', reason: 'no threshold change indicated', sample_size: stat.routed }
    }
  }

  // A "no-candidate" route: every domain probability at or below the current
  // threshold, so the router fell back to the profile playbook. Lowering one
  // playbook's threshold cannot fix that, so this suggestion is global.
  const runRoutes = events.filter(event => event.kind === 'route' && event.route_decision_kind === 'run' && event.route_domain && Object.keys(event.route_domain).length > 0)
  const noCandidate = runRoutes.filter(event => Object.values(event.route_domain!).every(p => p <= current.domain_threshold)).length
  const noCandidateRate = runRoutes.length ? noCandidate / runRoutes.length : 0
  let global_domain_threshold: ThresholdSuggestion
  if (runRoutes.length < MIN_THRESHOLD_SAMPLE) {
    global_domain_threshold = { kind: 'insufficient', reason: 'insufficient data', sample_size: runRoutes.length }
  } else if (noCandidateRate > 0.3 && (graph.rerouteRate ?? 0) === 0) {
    global_domain_threshold = {
      kind: 'lower',
      value: Math.max(DOMAIN_THRESHOLD_FLOOR, current.domain_threshold - RAISE_STEP),
      reason: `no candidate qualified on ${(noCandidateRate * 100).toFixed(0)}% of routes with no reroutes`,
      sample_size: runRoutes.length,
    }
  } else {
    global_domain_threshold = { kind: 'none', reason: 'no threshold change indicated', sample_size: runRoutes.length }
  }

  const routedCount = graph.clarify.routedCount
  let ask_threshold: ThresholdSuggestion
  if (routedCount < MIN_THRESHOLD_SAMPLE) {
    ask_threshold = { kind: 'insufficient', reason: 'insufficient data', sample_size: routedCount }
  } else if ((graph.clarify.rate ?? 0) > 0.3 && (graph.rerouteRate ?? 0) < 0.15) {
    ask_threshold = {
      kind: 'raise',
      value: Math.min(1, current.ask_threshold + RAISE_STEP),
      reason: `clarify rate ${((graph.clarify.rate ?? 0) * 100).toFixed(0)}% exceeds 30% with low subsequent reroute rate`,
      sample_size: routedCount,
    }
  } else {
    ask_threshold = { kind: 'none', reason: 'no threshold change indicated', sample_size: routedCount }
  }

  return { domain_threshold, global_domain_threshold, ask_threshold }
}
