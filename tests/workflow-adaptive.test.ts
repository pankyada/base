import { describe, expect, it } from 'vitest'
import { parseRoutingPolicy, updateRoutingPolicy } from '../src/workflow/adaptive.js'

describe('adaptive routing policy', () => {
  it('requires eight samples, respects floor, and promotes after escalation evidence', () => {
    const report: any = { cells: { 'bugfix|build': { tier: 'frontier', n: 8, first_try: 0.95, rework_rate: 0, consecutive_escalations: 0 } } }
    expect(updateRoutingPolicy(report, {}, 'cheap').coding?.bugfix?.build?.tier).toBe('balanced')
    expect(updateRoutingPolicy({ cells: { 'bugfix|build': { tier: 'frontier', n: 7, first_try: 1, rework_rate: 0 } } }, {}, 'cheap')).toEqual({ coding: {} })
    const promoted = updateRoutingPolicy({ cells: { 'bugfix|build': { tier: 'balanced', n: 8, first_try: 0.5, rework_rate: 0.3, consecutive_escalations: 2 } } }, { coding: { bugfix: { build: { tier: 'balanced', n: 8, first_try: 0.5, rework_rate: 0.3 } } } }, 'cheap')
    expect(promoted.coding?.bugfix?.build?.tier).toBe('frontier')
    expect(parseRoutingPolicy('{bad')).toBeUndefined()
    expect(parseRoutingPolicy('{"coding":{"bugfix":{"build":{"tier":"bogus"}}}}')).toBeUndefined()
  })
})
