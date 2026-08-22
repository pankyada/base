import { describe, expect, it } from 'vitest'
import { BudgetExceeded } from '../src/runs/budget.js'
import { sessionEndFromError } from '../src/server/session-status.js'

describe('session end status', () => {
  it('maps budget errors to a live budget_exceeded status and reason', () => {
    const error = new BudgetExceeded('cost', { cost_usd: 1, tools: 0, wall_s: 1 }, 1, 'model')
    expect(sessionEndFromError(error)).toEqual({ status: 'budget_exceeded', reason: 'cost' })
  })

  it('maps cancellation separately from failed sessions', () => {
    expect(sessionEndFromError(new Error('aborted'), true)).toEqual({ status: 'cancelled' })
    expect(sessionEndFromError(new Error('broken'))).toEqual({ status: 'failed', reason: 'broken' })
  })
})
