import { describe, expect, it } from 'vitest'
import { BudgetConfigError, BudgetExceeded, RunBudget } from '../src/runs/budget.js'

describe('RunBudget', () => {
  it('refuses the third tool with a two-tool ceiling', () => {
    const budget = new RunBudget({ max_cost_usd: 1, max_tools: 2, max_wall_s: 60 })
    budget.checkTool(); budget.checkTool()
    expect(() => budget.checkTool()).toThrow(BudgetExceeded)
  })

  it('fails closed at zero cost budget before a model call', () => {
    const budget = new RunBudget({ max_cost_usd: 0, max_tools: 1, max_wall_s: 60 })
    expect(() => budget.checkModel(0)).toThrow(BudgetExceeded)
  })

  it('refuses malformed budgets instead of treating them as unlimited', () => {
    expect(() => new RunBudget({ max_cost_usd: Number.NaN, max_tools: 1, max_wall_s: 60 })).toThrow(BudgetConfigError)
    expect(() => new RunBudget({ max_cost_usd: 1, max_tools: 1.5, max_wall_s: 60 })).toThrow(BudgetConfigError)
    expect(() => new RunBudget(undefined as any)).toThrow(BudgetConfigError)
  })

  it('shares one remaining ledger with delegated execution', () => {
    const parent = new RunBudget({ max_cost_usd: 1, max_tools: 2, max_wall_s: 60 })
    const child = parent.inherit()
    child.checkTool('child tool')
    parent.checkTool('parent tool')
    expect(() => child.checkTool('child tool 2')).toThrow(BudgetExceeded)
  })

  it('allocates child budget from parent remainder and returns unused share', () => {
    const parent = new RunBudget({ max_cost_usd: 1, max_tools: 4, max_wall_s: 60 })
    const child = parent.allocate(0.4)
    expect(parent.remainingCost()).toBeCloseTo(0.6)
    child.checkModel(0.2)
    child.release()
    expect(parent.remainingCost()).toBeCloseTo(0.8)
    expect(() => parent.allocate(0.9)).toThrow(/exceeds parent remainder/)
  })

  it('reports what was in flight when a checkpoint trips', () => {
    const budget = new RunBudget({ max_cost_usd: 1, max_tools: 1, max_wall_s: 60 })
    budget.checkTool('Write', 0.25)
    expect(() => budget.checkTool('Notify', 0.25)).toThrowError(/in flight Notify/)
  })
})
