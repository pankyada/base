import { queryEvents } from '../telemetry/query.js'
import { aggregateRouting } from './routing.js'

export function routingStats(args: { since?: Date; stage?: string; taskClass?: string; shadow?: boolean } = {}): string {
  const report = aggregateRouting(queryEvents({}), args)
  const rows = Object.values(report.cells)
  if (!rows.length) return 'No routing data.'
  return rows.map(c => {
    const enough = c.n >= 8 && c.first_try_rate !== null
    const metrics = enough
      ? `first_try=${(c.first_try_rate! * 100).toFixed(1)}% cost/accepted=$${(c.cost_per_accepted_task ?? 0).toFixed(4)}`
      : 'insufficient data'
    return `${c.task_class}\t${c.blast_radius}\t${c.stage}\t${c.tier}\tn=${c.n}\t${metrics}`
  }).join('\n')
}
