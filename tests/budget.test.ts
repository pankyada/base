import { describe, expect, it } from 'vitest'
import { BudgetExceeded, RunBudget } from '../src/runs/budget.js'

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
})
