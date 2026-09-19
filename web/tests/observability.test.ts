import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { stageFunnel, toolP95, budgetState, budgetLabel, observabilityLabel, Observability } from '../components/ops/Observability'

describe('observability', () => {
  it('computes stage funnel and p95 tool duration', () => {
    expect(stageFunnel([{ stage: 'build', state: 'done' }, { stage: 'build', state: 'escalated' }])[0].runs).toBe(2)
    expect(toolP95([1, 2, 3, 4, 100])).toBe(100)
    expect(budgetState({ cost: 1, limit: 1 })).toBe('budget-exceeded')
    expect(budgetLabel({ cost: 1, limit: 1 })).toBe('budget-exceeded · $1.00 / $1.00')
    expect(budgetLabel({ cost: 1 })).toBeUndefined()
    expect(observabilityLabel({})).toBe('No telemetry yet')
  })

  it('does not present unavailable telemetry as a genuine empty snapshot', () => {
    const unavailable = renderToStaticMarkup(React.createElement(Observability, { state: 'unavailable' }))
    const empty = renderToStaticMarkup(React.createElement(Observability, { state: 'empty' }))
    expect(unavailable).not.toContain('No telemetry yet')
    expect(empty).toContain('No telemetry yet')
  })
})
