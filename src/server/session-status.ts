import { BudgetExceeded } from '../runs/budget.js'

export type SessionEndStatus = 'completed' | 'budget_exceeded' | 'cancelled' | 'failed'

export function sessionEndFromError(error: unknown, aborted = false): { status: SessionEndStatus; reason?: string } {
  if (error instanceof BudgetExceeded) return { status: 'budget_exceeded', reason: error.reason }
  if (aborted) return { status: 'cancelled' }
  return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
}
