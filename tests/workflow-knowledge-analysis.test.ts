import { describe, expect, it } from 'vitest'
import { generalizationFromReview, persistKnowledge, queryProjectGraph } from '../src/workflow/knowledge.js'
import { aggregateRouting } from '../src/analysis/routing.js'
import { updateRoutingPolicy } from '../src/workflow/adaptive.js'

describe('workflow knowledge and analysis', () => {
  it('requires explicit generalization yes before emitting followup', () => {
    expect(generalizationFromReview('## Generalization\nNo.').nodes).toHaveLength(0)
    expect(generalizationFromReview('## Generalization\nYes, apply to research.').nodes[0].type).toBe('Followup')
  })

  it('persists typed links and queries project graph', async () => {
    const entries = new Map<string, any>()
    const memory: any = {
      read: async (_scope: string, key: string) => entries.get(key) ?? null,
      write: async (_scope: string, key: string, content: string, links: any[]) => entries.set(key, { content, links }),
      list: async () => [...entries].map(([key, v]) => ({ key, preview: v.content.slice(0, 100), links: v.links })),
    }
    await persistKnowledge(memory, [{ key: 'decision-1', type: 'Decision', content: 'keep stages' }], [{ target: 'constraint-1', relation: 'depends_on' }])
    expect((await memory.read('project', 'decision-1')).links[0].relation).toBe('depends_on')
    expect(await queryProjectGraph(memory, 'decision')).toContain('decision-1')
  })

  it('stratifies routing and suppresses low sample rates', () => {
    const now = new Date().toISOString()
    const events: any[] = Array.from({ length: 8 }, (_, i) => ({ ts: now, session: 's', profile: 'p', kind: 'stage', task_id: `t${i}`, stage: 'build', tier: 'cheap', task_class: 'bugfix', blast_radius: 'module', state: 'done', cost_usd: 1 }))
    events.push(...Array.from({ length: 8 }, (_, i) => ({ ts: now, session: 's', profile: 'p', kind: 'outcome', task_id: `t${i}`, verdict: 'accepted', verify_first_try: true, total_cost_usd: 1 })))
    const report = aggregateRouting(events)
    expect(report.cells['bugfix|module|build|cheap'].n).toBe(8)
    expect(report.cells['bugfix|module|build|cheap'].first_try_rate).toBe(1)
    expect(updateRoutingPolicy({ cells: { 'bugfix|build': { tier: 'balanced', n: 8, first_try: 0.9, rework_rate: 0 } } }, {}, 'cheap').coding.bugfix.build?.tier).toBe('cheap')
  })
})
