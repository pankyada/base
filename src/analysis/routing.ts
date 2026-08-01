import type { TelemetryEvent } from '../types.js'

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
