import { describe, expect, it } from 'vitest'
import { stageFunnel, toolP95, budgetState, budgetLabel, observabilityLabel } from '../components/ops/Observability'

describe('observability', () => {
  it('computes stage funnel and p95 tool duration', () => {
    expect(stageFunnel([{ stage: 'build', state: 'done' }, { stage: 'build', state: 'escalated' }])[0].runs).toBe(2)
    expect(toolP95([1, 2, 3, 4, 100])).toBe(100)
    expect(budgetState({ cost: 1, limit: 1 })).toBe('budget-exceeded')
    expect(budgetLabel({ cost: 1, limit: 1 })).toBe('budget-exceeded · $1.00 / $1.00')
    expect(budgetLabel({ cost: 1 })).toBeUndefined()
    expect(observabilityLabel({})).toBe('No telemetry yet')
  })
})
