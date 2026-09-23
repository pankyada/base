import { describe, expect, it } from 'vitest'
import { checkClaims } from '../src/decisions/claims.js'
import { WorkflowDecisionControlError } from '../src/decisions/workflow.js'
import type { ClaimEvidence } from '../src/workflow/claims.js'

// Roadmap #31 phase 5 (PT-080), spec §5.7. The Jev call layer only: question
// building, defensive parsing, and control-outcome propagation. See
// tests/workflow-claim-extract.test.ts for extraction/evidence/gate policy
// and tests/workflow-claim-check-runtime.test.ts for the runWorkflow wiring.

function success(answers: Record<string, any>): any {
  return { kind: 'success', response: { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } }, cached: false, request_bytes: 1, response_bytes: 1, requestBytes: 1, responseBytes: 1, duration_ms: 1, durationMs: 1 }
}

const evidence: ClaimEvidence = { items: [{ tool: 'Read', ok: true, result: 'file contents' }], tainted: false }
const claims = ['The suite passes all 12 tests.', 'The file src/x.ts was updated.']

describe('checkClaims', () => {
  it('builds one Noul question per claim, in order, with the exact instruction text', async () => {
    let seen: any
    const provider = { evaluate: async (input: any) => { seen = input; return success({ claim_0: { type: 'noul', noul: 0.9 }, claim_1: { type: 'noul', noul: 0.8 } }) } }
    await checkClaims(provider, 'jev-test', claims, evidence, 'fix the bug')
    expect(seen.model).toBe('jev-test')
    expect(seen.questions.claim_0).toEqual({ type: 'noul', instructions: `The provided evidence supports this claim: ${claims[0]}` })
    expect(seen.questions.claim_1).toEqual({ type: 'noul', instructions: `The provided evidence supports this claim: ${claims[1]}` })
    expect(Object.keys(seen.questions)).toEqual(['claim_0', 'claim_1'])
  })

  it('passes bounded evidence and tainted flag in state, never the raw request beyond its bound', async () => {
    let seen: any
    const provider = { evaluate: async (input: any) => { seen = input; return success({ claim_0: { type: 'noul', noul: 0.9 }, claim_1: { type: 'noul', noul: 0.9 } }) } }
    const taintedEvidence: ClaimEvidence = { items: [{ tool: 'Fetch', ok: true, result: 'x'.repeat(2000) }], tainted: true }
    await checkClaims(provider, 'jev-test', claims, taintedEvidence, 'x'.repeat(5000))
    expect(seen.state.tainted).toBe(true)
    expect(seen.state.evidence[0].result.length).toBe(1500)
    expect(seen.state.request.length).toBe(4000)
  })

  it('returns the probabilities in claim order', async () => {
    const provider = { evaluate: async () => success({ claim_0: { type: 'noul', noul: 0.4 }, claim_1: { type: 'noul', noul: 0.95 } }) }
    const result = await checkClaims(provider, 'jev-test', claims, evidence, 'fix the bug')
    expect(result).toEqual([0.4, 0.95])
  })

  it('returns undefined for a missing answer', async () => {
    const provider = { evaluate: async () => success({ claim_0: { type: 'noul', noul: 0.4 } }) }
    const result = await checkClaims(provider, 'jev-test', claims, evidence, 'fix the bug')
    expect(result).toBeUndefined()
  })

  it('returns undefined for a malformed (non-noul) answer', async () => {
    const provider = { evaluate: async () => success({ claim_0: { type: 'choice', choice: 'yes', probabilities: {}, confidence: 0.9 }, claim_1: { type: 'noul', noul: 0.9 } }) }
    const result = await checkClaims(provider, 'jev-test', claims, evidence, 'fix the bug')
    expect(result).toBeUndefined()
  })

  it('returns undefined when the provider reports unavailable', async () => {
    const provider = { evaluate: async () => ({ kind: 'unavailable', reason: 'network_error', retryable: true }) }
    const result = await checkClaims(provider as any, 'jev-test', claims, evidence, 'fix the bug')
    expect(result).toBeUndefined()
  })

  it('throws WorkflowDecisionControlError on a control outcome', async () => {
    const provider = { evaluate: async () => ({ kind: 'control', reason: 'cancelled' }) }
    await expect(checkClaims(provider as any, 'jev-test', claims, evidence, 'fix the bug')).rejects.toBeInstanceOf(WorkflowDecisionControlError)
  })

  it('returns undefined immediately for an empty claim list, without calling the provider', async () => {
    let calls = 0
    const provider = { evaluate: async () => { calls++; return success({}) } }
    const result = await checkClaims(provider, 'jev-test', [], evidence, 'fix the bug')
    expect(result).toBeUndefined()
    expect(calls).toBe(0)
  })
})
