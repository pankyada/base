import { describe, expect, it } from 'vitest'
import { failBackTarget, shouldEscalate } from '../src/workflow/runner.js'

describe('workflow escalation', () => {
  it('promotes on contract failures and recognizes fail-back targets', () => {
    const result: any = { stage: 'verify', body: 'precondition violation: design is wrong', contract_ok: false, missing: ['Verification'], tier: 'cheap', intensity: 1, modelId: 'm', attempt: 1 }
    expect(shouldEscalate(result).escalate).toBe(true)
    expect(failBackTarget(result)).toBe('design')
  })

  it('promotes on high review findings', () => {
    const result: any = { stage: 'review', body: 'High severity finding', contract_ok: true, tier: 'balanced', intensity: 2, modelId: 'm', attempt: 1, high_findings: 1 }
    expect(shouldEscalate(result).reason).toContain('high severity')
  })
})
