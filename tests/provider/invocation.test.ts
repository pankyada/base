import { expect, it } from 'vitest'
import { bindRunProvider } from '../../src/provider/invocation.js'
import { SharedAttemptBudget } from '../../src/provider/usage.js'
import { ProviderError } from '../../src/provider/errors.js'
import { RunBudget } from '../../src/runs/budget.js'
import type { ProviderClient, ProviderResult } from '../../src/provider/types.js'

const request = { model: 'gpt-5.4-mini', messages: [{ role: 'user' as const, content: 'hello' }] }
function context(overrides: Record<string, unknown> = {}): any {
  return { profile: { name: 'review', model: { auth: 'codex_oauth', id: request.model, codex: { max_model_calls_per_run: 64, request_timeout_ms: 1000 } } },
    session: { id: Math.random().toString(), usage: { input: 0, output: 0, cost_usd: 0 } }, ...overrides }
}
function fake(result?: ProviderResult, failure?: Error): ProviderClient {
  return { kind: 'codex_oauth', model: request.model,
    async *stream(_request, call) {
      call?.beforeAttempt?.()
      if (failure) throw failure
      yield { type: 'done', result: result ?? { text: 'ok', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, status: 'complete' } } }
    },
    async generate() { throw new Error('wrapper should fold its accounted stream') },
  }
}

it('accounts helpers and normal calls once with subscription cost metadata', async () => {
  const ctx = context()
  const provider = bindRunProvider(fake(), ctx)
  await provider.generate(request, { purpose: 'digest' })
  await provider.generate(request, { purpose: 'main' })
  expect(ctx.session.usage).toMatchObject({ input: 20, output: 10, billing_mode: 'subscription', cost_basis: 'api_equivalent', billed_cost_usd: null, model_attempts: 2 })
  expect(ctx.session.usage.cost_usd).toBeCloseTo(20 * 0.00000075 + 10 * 0.0000045)
})

it('retains conservative uncertainty after accepted output without usage', async () => {
  const ctx = context()
  await bindRunProvider(fake({ text: 'ok', toolCalls: [], finishReason: 'stop' }), ctx).generate(request)
  expect(ctx.session.usage.output).toBe(128000)
  expect(ctx.session.usage.usage_status).toBe('estimated')
})

it('records a quota rejection attempt without inventing generated tokens', async () => {
  const ctx = context()
  await expect(bindRunProvider(fake(undefined, new ProviderError('quota', { status: 429, code: 'quota_exceeded' })), ctx).generate(request)).rejects.toThrow('quota')
  expect(ctx.session.usage).toMatchObject({ input: 0, output: 0, cost_usd: 0, model_attempts: 1 })
})

it('shares the model cap with children rather than replenishing it', async () => {
  const attempts = new SharedAttemptBudget(2)
  const root = context({ attemptBudget: attempts })
  const child = context({ attemptBudget: attempts })
  await bindRunProvider(fake(), root).generate(request)
  await bindRunProvider(fake(), child).generate(request)
  await expect(bindRunProvider(fake(), child).generate(request)).rejects.toThrow(/attempt limit/i)
  expect(attempts.attempts).toBe(2)
  expect(child.session.usage.input).toBe(10)
})

it('keeps uncertainty when a post-request transport failure loses usage', async () => {
  const ctx = context()
  await expect(bindRunProvider(fake(undefined, new ProviderError('disconnect', { ambiguous: true })), ctx).generate(request)).rejects.toThrow('disconnect')
  expect(ctx.session.usage.output).toBe(128000)
  expect(ctx.session.usage.usage_status).toBe('estimated')
})

it('enforces estimated cost before tools or another model call', async () => {
  const ctx = context({ budget: new RunBudget({ max_cost_usd: 0.01, max_tools: 5, max_wall_s: 10 }) })
  await expect(bindRunProvider(fake({ text: 'ok', toolCalls: [], finishReason: 'stop' }), ctx).generate(request)).rejects.toThrow(/budget exceeded/i)
  expect(ctx.session.usage.cost_usd).toBeGreaterThan(0.01)
})

it('counts bounded throttle retries as separate inference attempts', async () => {
  const ctx = context()
  let calls = 0
  const raw: ProviderClient = { ...fake(), async *stream(_request, call) {
    call?.beforeAttempt?.()
    if (++calls < 3) throw new ProviderError('throttle', { status: 429, retryable: true, retryAfterMs: 1 })
    yield { type: 'done', result: { text: 'ok', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, status: 'complete' } } }
  } }
  await bindRunProvider(raw, ctx).generate(request)
  expect(calls).toBe(3)
  expect(ctx.session.usage).toMatchObject({ model_attempts: 3, input: 1, output: 1 })
})

it('cancels a queued third request without starting it', async () => {
  let entered = 0
  const releases: Array<() => void> = []
  const raw: ProviderClient = { ...fake(), async *stream(_request, call) {
    call?.beforeAttempt?.()
    entered++
    await new Promise<void>(resolve => releases.push(resolve))
    yield { type: 'done', result: { text: 'ok', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, status: 'complete' } } }
  } }
  const one = bindRunProvider(raw, context()).generate(request)
  const two = bindRunProvider(raw, context()).generate(request)
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(entered).toBe(2)
  const controller = new AbortController()
  const queued = context({ signal: controller.signal })
  const third = bindRunProvider(raw, queued).generate(request)
  controller.abort()
  await expect(third).rejects.toThrow(/abort/i)
  expect(entered).toBe(2)
  expect(queued.session.usage.model_attempts ?? 0).toBe(0)
  releases.forEach(release => release())
  await Promise.all([one, two])
})

it('honors a root deadline even when the adapter ignores cancellation', async () => {
  const ctx = context({ deadline: Date.now() + 25 })
  const raw: ProviderClient = { ...fake(), async *stream(_request, call) {
    call?.beforeAttempt?.()
    await new Promise<void>(() => undefined)
  } }
  await expect(bindRunProvider(raw, ctx).generate(request)).rejects.toThrow(/timed out/i)
  expect(ctx.session.usage.usage_status).toBe('estimated')
})

it('retains failed child estimates in parent budget without double charging merged usage', async () => {
  const { mergeUsageDelta } = await import('../../src/usage/ledger.js')
  const rootBudget = new RunBudget({ max_cost_usd: 1, max_tools: 5, max_wall_s: 10 })
  const root = context({ budget: rootBudget })
  const api = { ...fake(), kind: 'api_key' as const }
  await bindRunProvider(api, root).generate(request)
  const childBudget = rootBudget.allocate(rootBudget.remainingCost())
  const child = context({ budget: childBudget, attemptBudget: root.attemptBudget })
  await expect(bindRunProvider(fake(undefined, new ProviderError('lost', { ambiguous: true })), child).generate(request)).rejects.toThrow('lost')
  mergeUsageDelta(root.session.usage, child.session.usage)
  rootBudget.absorbChildUsage(childBudget, child.session.usage.cost_usd)
  childBudget.release()
  rootBudget.checkModel(root.session.usage.cost_usd)
  expect(root.session.usage).toMatchObject({ billing_mode: 'mixed', cost_basis: 'mixed', usage_status: 'estimated', model_attempts: 2 })
  expect(root.session.usage.api_equivalent_usd).toBeGreaterThan(0.57)
  expect(root.session.usage.api_estimate_usd).toBeGreaterThan(0)
  expect(rootBudget.remainingCost()).toBeCloseTo(1 - root.session.usage.cost_usd)
})

it('counts API child rejection retries against the same root attempt cap', async () => {
  const attempts = new SharedAttemptBudget(2)
  let sent = 0
  const raw = { ...fake(), kind: 'api_key' as const, async *stream(_request: any, call: any) {
    call.beforeAttempt()
    sent++
    throw new ProviderError('API throttle', { status: 429, retryable: true, retryAfterMs: 0 })
  } }
  const ctx = context({ attemptBudget: attempts })
  await expect(bindRunProvider(raw, ctx).generate(request)).rejects.toThrow(/attempt limit/)
  expect(sent).toBe(2)
  expect(ctx.session.usage).toMatchObject({ input: 0, output: 0, model_attempts: 2 })
})

it('does not relabel legacy costs as verified subscription estimates', async () => {
  const { mergeUsageDelta } = await import('../../src/usage/ledger.js')
  const total: any = { input: 10, output: 5, cost_usd: 1 }
  mergeUsageDelta(total, { input: 1, output: 1, cost_usd: 0.1, billing_mode: 'subscription', cost_basis: 'api_equivalent', api_equivalent_usd: 0.1, billed_cost_usd: null })
  expect(total).toMatchObject({ cost_usd: 1.1, cost_basis: 'mixed', api_equivalent_usd: 0.1, billed_cost_usd: null })
})
