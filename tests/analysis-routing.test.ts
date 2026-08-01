import { describe, expect, it } from 'vitest'
import { aggregateRouting } from '../src/analysis/routing.js'

describe('routing analysis', () => {
  it('joins deferred labels, excludes shadow events, and suppresses low-n rates', () => {
    const ts = new Date().toISOString()
    const events: any[] = Array.from({ length: 8 }, (_, i) => [
      { ts, session: 's', profile: 'coding', kind: 'stage', task_id: `task-${i}`, stage: 'build', tier: 'cheap', task_class: 'bugfix', blast_radius: 'module', state: 'done', cost_usd: 0.1 },
      { ts, session: 's', profile: 'coding', kind: 'outcome', task_id: `task-${i}`, verdict: 'accepted', verify_first_try: true, total_cost_usd: 0.1 },
    ]).flat()
    events.push({ ts, session: 's', profile: 'coding', kind: 'stage', task_id: 'shadow-task', stage: 'build', tier: 'frontier', task_class: 'bugfix', blast_radius: 'module', state: 'done', explore: true, cost_usd: 9 })
    events.push({ ts, session: 's', profile: 'coding', kind: 'outcome', task_id: 'task-0', human_edit_churn: 2, verdict: 'reworked', total_cost_usd: 0.1 })
    const report = aggregateRouting(events)
    expect(report.cells['bugfix|module|build|cheap']).toMatchObject({ n: 8, mean_human_edit_churn: 2 })
    expect(report.cells['bugfix|module|build|cheap'].total_cost).toBeCloseTo(0.8)
    expect(report.cells['bugfix|module|build|cheap'].first_try_rate).toBe(1)
    expect(report.cells['bugfix|module|build|frontier']).toBeUndefined()
    expect(aggregateRouting(events.slice(0, 1)).cells['bugfix|module|build|cheap'].first_try_rate).toBeNull()
  })
})
