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

  it('does not escalate on negated failure language', () => {
    const noErrors: any = { stage: 'verify', body: '## Verification\nNo errors found, all tests passed.', contract_ok: true, tier: 'cheap', intensity: 1, modelId: 'm', attempt: 1 }
    expect(shouldEscalate(noErrors).escalate).toBe(false)

    const resolved: any = { stage: 'verify', body: '## Verification\nPreviously broken, now fixed and verified.', contract_ok: true, tier: 'cheap', intensity: 1, modelId: 'm', attempt: 1 }
    expect(shouldEscalate(resolved).escalate).toBe(false)
  })

  it('still escalates on genuine unresolved failures', () => {
    const result: any = { stage: 'verify', body: '## Verification\nTests failed with 3 errors.', contract_ok: true, tier: 'cheap', intensity: 1, modelId: 'm', attempt: 1 }
    expect(shouldEscalate(result).escalate).toBe(true)
    expect(shouldEscalate(result).reason).toBe('verification failed')
  })

  it('recognizes broader fail-back phrasings for all four stages', () => {
    expect(failBackTarget({ stage: 'verify', body: 'we need to go back to recon, assumptions were stale' } as any)).toBe('recon')
    expect(failBackTarget({ stage: 'verify', body: 'this should revisit the plan stage' } as any)).toBe('plan')
    expect(failBackTarget({ stage: 'verify', body: 'the build is flawed here' } as any)).toBe('build')
  })

  it('targets the stage explicitly called wrong, not one merely mentioned nearby', () => {
    const result: any = { stage: 'verify', body: 'the plan missed this edge case so the build is wrong' }
    expect(failBackTarget(result)).toBe('build')
  })
})
