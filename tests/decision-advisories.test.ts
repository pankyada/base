import { describe, expect, it, vi } from 'vitest'
import { DecisionAdvisoryService } from '../src/decisions/advisories.js'
import type { DecisionProvider } from '../src/decisions/types.js'

function provider(label: string, confidence = 0.9) {
  const evaluate = vi.fn(async (request: any) => ({
    kind: 'success' as const,
    response: {
      model: request.model,
      answers: { [Object.keys(request.questions)[0]]: { type: 'choice' as const, choice: label, probabilities: { [label]: 1 }, confidence } },
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    cached: false,
    request_bytes: 1,
    response_bytes: 1,
    requestBytes: 1,
    responseBytes: 1,
    duration_ms: 1,
    durationMs: 1,
  }))
  return { evaluate } as unknown as DecisionProvider & { evaluate: typeof evaluate }
}

const result = { tool_call_id: 'call-1', tool_name: 'Read', subgoal: 'Find the release status', executor_result: 'release is ready', ok: true, effect: 'read' as const }

describe('decision advisories', () => {
  it('keeps disabled result assessment baseline and does not call Jev', async () => {
    const fake = provider('sufficient')
    const outcome = await new DecisionAdvisoryService({ provider: fake, model: 'jev-test', result_mode: 'disabled' }).assessResult(result)
    expect(outcome).toEqual({ kind: 'ignored', reason: 'disabled', feature: 'result_verification', tool_call_id: 'call-1' })
    expect(fake.evaluate).not.toHaveBeenCalled()
  })

  it('returns a shadow result advisory tied to the observed tool call without applying it', async () => {
    const fake = provider('sufficient')
    const outcome = await new DecisionAdvisoryService({ provider: fake, model: 'jev-test', result_mode: 'shadow' }).assessResult(result)
    expect(outcome).toMatchObject({ kind: 'advisory', feature: 'result_verification', label: 'sufficient', applied: false, source: 'jev', tool_call_id: 'call-1' })
    expect(fake.evaluate).toHaveBeenCalledOnce()
    expect(fake.evaluate.mock.calls[0][0].state).toMatchObject({ tool_call_id: 'call-1', executor_result: 'release is ready' })
  })

  it('maps enforced low-confidence result advice to verification', async () => {
    const fake = provider('insufficient', 0.2)
    const outcome = await new DecisionAdvisoryService({ provider: fake, model: 'jev-test', result_mode: 'enforce' }).assessResult(result)
    expect(outcome).toMatchObject({ kind: 'advisory', label: 'needs-verification', source: 'uncertain', applied: true, confidence: 0.2 })
  })

  it('classifies an observed retryable failure as advice only', async () => {
    const fake = provider('retry')
    const failure = await new DecisionAdvisoryService({ provider: fake, model: 'jev-test', failure_mode: 'enforce' }).classifyFailure({ tool_call_id: 'call-2', tool_name: 'Read', error: 'temporary read failure', failure_kind: 'network', effect: 'read' })
    expect(failure).toMatchObject({ kind: 'advisory', feature: 'failure_guidance', label: 'retry', applied: true, tool_call_id: 'call-2' })
    expect(fake.evaluate).toHaveBeenCalledOnce()
  })

  it('stops for denied, parked, cancelled, stale and provider-control failures without calling Jev', async () => {
    const fake = provider('retry')
    const service = new DecisionAdvisoryService({ provider: fake, model: 'jev-test', failure_mode: 'enforce' })
    for (const failure_kind of ['denied', 'parked', 'cancelled', 'stale', 'provider_control'] as const) {
      await expect(service.classifyFailure({ tool_call_id: `call-${failure_kind}`, tool_name: 'Write', error: failure_kind, failure_kind, effect: 'write' })).resolves.toMatchObject({ kind: 'advisory', label: 'stop', source: 'deterministic', applied: true })
    }
    expect(fake.evaluate).not.toHaveBeenCalled()
  })

  it('preserves provider control outcomes and cancellation', async () => {
    const controlled = { evaluate: vi.fn(async () => ({ kind: 'control' as const, reason: 'missing_credentials' as const })) } as unknown as DecisionProvider
    const control = await new DecisionAdvisoryService({ provider: controlled, model: 'jev-test', result_mode: 'enforce' }).assessResult(result)
    expect(control).toEqual({ kind: 'control', feature: 'result_verification', tool_call_id: 'call-1', reason: 'missing_credentials' })
    const controller = new AbortController(); controller.abort()
    const cancelled = await new DecisionAdvisoryService({ provider: provider('sufficient'), model: 'jev-test', result_mode: 'enforce' }).assessResult({ ...result, signal: controller.signal })
    expect(cancelled).toEqual({ kind: 'control', feature: 'result_verification', tool_call_id: 'call-1', reason: 'cancelled' })
  })
})
