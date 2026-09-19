import { describe, expect, it, vi } from 'vitest'
import { applyDecisionTelemetry, DecisionRuntimeControlError, DecisionRuntimeService } from '../src/decisions/runtime.js'
import { createSession } from '../src/session/store.js'

const profile = { name: 'fixture' } as any

function input() {
  return {
    request: 'inspect the relevant thing',
    profile,
    skills: [{ name: 'relevant-skill', description: 'relevant', content: 'body', filePath: '/tmp/skill' }],
    tools: [{ name: 'Relevant', kind: 'tool' as const, description: 'relevant tool' }, { name: 'Other', kind: 'tool' as const, description: 'other tool' }],
    mcpEntries: [],
    taskKey: 'run:1',
  }
}

describe('DecisionRuntimeService', () => {
  it('selects applicable candidates and caches by bounded task state', async () => {
    const provider = { evaluate: vi.fn(async request => ({
      kind: 'success' as const,
      response: {
        model: request.model,
        answers: Object.fromEntries(Object.keys(request.questions).map(key => [key, { type: 'noul', noul: key.includes('Relevant') || key.includes('relevant-skill') ? 1 : 0 }])),
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      cached: false,
      request_bytes: 1,
      response_bytes: 1,
      duration_ms: 1,
      requestBytes: 1,
      responseBytes: 1,
      durationMs: 1,
    })) }
    const runtime = new DecisionRuntimeService({ mode: 'enforce', model: 'jev-test', provider: provider as any, cache: { enabled: true, ttl_ms: 60_000, max_entries: 4 } })
    const first = await runtime.selectCapabilities(input())
    const second = await runtime.selectCapabilities(input())
    expect(first.selectedToolNames).toEqual(['Relevant'])
    expect(first.selectedSkillNames).toEqual(['relevant-skill'])
    expect(second).toEqual(first)
    expect(provider.evaluate).toHaveBeenCalledOnce()
  })

  it('propagates provider control outcomes instead of widening them to semantic fallback', async () => {
    const runtime = new DecisionRuntimeService({
      mode: 'enforce', model: 'jev-test',
      provider: { evaluate: async () => ({ kind: 'control', reason: 'missing_credentials' }) },
    })
    await expect(runtime.selectCapabilities(input())).rejects.toEqual(new DecisionRuntimeControlError('missing_credentials'))
  })

  it('passes the shared reservation hook to the provider', async () => {
    let received: unknown
    const runtime = new DecisionRuntimeService({
      mode: 'shadow', model: 'jev-test',
      reservation: () => ({ ok: false as const, reason: 'budget_exhausted' as const }),
      provider: { evaluate: async (_request, options) => {
        received = options?.reservation
        return { kind: 'unavailable', reason: 'budget_exhausted', retryable: false }
      } },
    })
    const result = await runtime.selectCapabilities(input())
    expect(typeof received).toBe('function')
    expect(result.fallback).toBe('budget')
  })

  it('accounts decision telemetry in the same session usage totals', () => {
    const session = createSession('fixture', 'decision-user')
    applyDecisionTelemetry(session, {
      kind: 'decision', model: 'jev-test', outcome: 'success', request_bytes: 120,
      response_bytes: 80, input_tokens: 30, output_tokens: 4, cost_usd: 0.0002,
      duration_ms: 4, cached: false,
    })
    expect(session.usage.input).toBe(30)
    expect(session.usage.output).toBe(4)
    expect(session.usage.cost_usd).toBe(0.0002)
    expect(session.usage.api_estimate_usd).toBe(0.0002)
    expect(session.usage.model_attempts).toBe(1)
  })

  it('preserves estimated and mixed decision accounting after a successful call', () => {
    const session = createSession('fixture', 'decision-user')
    applyDecisionTelemetry(session, { kind: 'decision', model: 'jev-test', outcome: 'success', request_bytes: 1, response_bytes: 1, cost_usd: 0.0001, cost_basis: 'estimated', duration_ms: 1, cached: false })
    applyDecisionTelemetry(session, { kind: 'decision', model: 'jev-test', outcome: 'success', request_bytes: 1, response_bytes: 1, cost_usd: 0.0001, cost_basis: 'mixed', duration_ms: 1, cached: false })
    expect(session.usage.cost_basis).toBe('mixed')
    expect(session.usage.usage_status).toBe('estimated')
  })
})
