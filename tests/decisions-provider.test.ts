import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJevProvider, sanitizeDecisionState } from '../src/decisions/jev.js'
import { DecisionLayerSchema, type DecisionRequest, type JsonValue } from '../src/decisions/types.js'
import { ProfileSchema } from '../src/profiles/schema.js'

const key = 'configured-secret-value'

function config(overrides: Record<string, unknown> = {}) {
  return DecisionLayerSchema.parse({
    enabled: true,
    allow_remote_state: true,
    model: 'jev-1.13.0',
    api_key_env: 'TYPESAFE_TEST_KEY',
    endpoint: 'http://127.0.0.1:9/v1/systemone',
    retry: { max_attempts: 1, base_delay_ms: 0, max_delay_ms: 0 },
    ...overrides,
  })
}

function request(state: Record<string, JsonValue> = {}): DecisionRequest {
  return {
    model: 'jev-1.13.0',
    state: state as any,
    questions: {
      urgent: { type: 'noul', instructions: 'Is this urgent?', criteria: { true: 'Urgent', false: 'Not urgent' } },
      route: { type: 'choice', instructions: 'Which route?', criteria: { support: 'Support', engineering: 'Engineering' } },
      salience: { type: 'score', instructions: 'How useful?', criteria: ['Low', 'High'] },
    },
  }
}

function validResponse() {
  return {
    model: 'jev-1.13.0',
    answers: {
      urgent: { type: 'noul', noul: 0.9 },
      route: { type: 'choice', choice: 'support', probabilities: { support: 0.8, engineering: 0.2 }, confidence: 0.7 },
      salience: { type: 'score', score: 0.8, legend: { '0': 'Low', '1': 'High' }, probabilities: { '0': 0.2, '1': 0.8 }, confidence: 0.6 },
    },
    usage: { input_tokens: 12, output_tokens: 8 },
  }
}

afterEach(() => vi.unstubAllEnvs())

describe('decision-layer profile contract', () => {
  it('keeps omitted config absent and applies safe defaults when configured off', () => {
    const base = ProfileSchema.parse({ name: 'fixture', model: { base_url: 'https://example.test', api_key_env: 'MODEL_KEY', id: 'model' }, system_prompt: '/tmp/prompt.md', artifact_dir: '/tmp/artifacts' })
    expect(base.decision_layer).toBeUndefined()
    const layer = DecisionLayerSchema.parse({})
    expect(layer.enabled).toBe(false)
    expect(layer.allow_remote_state).toBe(false)
    expect(layer.features).toEqual({})
  })

  it('requires remote consent and an environment variable name without echoing secret literals', () => {
    const denied = DecisionLayerSchema.safeParse({ enabled: true, model: 'jev-1.13.0', api_key_env: 'TYPESAFE_TEST_KEY' })
    expect(denied.success).toBe(false)
    const secret = DecisionLayerSchema.safeParse({ enabled: true, allow_remote_state: true, model: 'jev-1.13.0', api_key_env: 'sk-this-is-a-secret' })
    expect(secret.success).toBe(false)
    if (!secret.success) expect(JSON.stringify(secret.error.issues)).not.toContain('sk-this-is-a-secret')
  })
})

describe('Jev native HTTP adapter', () => {
  it('sends only the documented request shape, redacts before truncation, and validates all answer types', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    let sent: { url: string; init?: RequestInit } | undefined
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      sent = { url: String(url), init }
      return new Response(JSON.stringify(validResponse()), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const telemetry: unknown[] = []
    const provider = createJevProvider(config(), { fetch: fetcher, onTelemetry: record => telemetry.push(record) })
    const result = await provider.evaluate(request({
      request: `keep this request and ${key}`,
      providerState: { access_token: key },
      credentials: { password: 'dont-send' },
      tool: { id: 'tool-1', description: 'safe', input: 'remove me' },
      tail: 'this field is removed by the caller whitelist',
    }), { allowed_state_keys: ['request', 'providerState', 'credentials', 'tool'], cache_scope: { user: 'u', profile: 'p', session: 's', run: 'r' } })
    expect(result.kind).toBe('success')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(sent?.url).toContain('/v1/systemone')
    expect(sent?.init?.method).toBe('POST')
    expect((sent?.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${key}`)
    const body = JSON.parse(String(sent?.init?.body))
    expect(body).toEqual(expect.objectContaining({ model: 'jev-1.13.0', questions: expect.any(Object) }))
    expect(body.state).toEqual({ request: 'keep this request and [REDACTED]', tool: { id: 'tool-1', description: 'safe' } })
    expect(JSON.stringify(telemetry)).not.toContain(key)
  })

  it('rejects partial and distribution-mismatched answers without coercion', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...validResponse(), answers: { urgent: { type: 'noul', noul: 2 } } }), { status: 200 }))
    const result = await createJevProvider(config(), { fetch: fetcher }).evaluate(request())
    expect(result).toEqual(expect.objectContaining({ kind: 'unavailable', reason: 'malformed_response' }))
  })

  it('retries bounded availability responses and never retries authentication failures', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    let attempts = 0
    const fetcher = vi.fn(async () => {
      attempts++
      return attempts === 1 ? new Response('{}', { status: 429 }) : new Response(JSON.stringify(validResponse()), { status: 200 })
    })
    const retried = await createJevProvider(config({ retry: { max_attempts: 2, base_delay_ms: 0, max_delay_ms: 0 } }), { fetch: fetcher }).evaluate(request())
    expect(retried.kind).toBe('success')
    expect(fetcher).toHaveBeenCalledTimes(2)
    const auth = await createJevProvider(config(), { fetch: vi.fn(async () => new Response('{}', { status: 401 })) }).evaluate(request())
    expect(auth).toEqual({ kind: 'control', reason: 'invalid_configuration' })
  })

  it('propagates cancellation and deadline as control outcomes', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    const cancelled = new AbortController()
    cancelled.abort()
    const provider = createJevProvider(config(), { fetch: vi.fn() })
    await expect(provider.evaluate(request(), { signal: cancelled.signal })).resolves.toEqual({ kind: 'control', reason: 'cancelled' })
    await expect(provider.evaluate(request(), { deadline_at: Date.now() - 1 })).resolves.toEqual(expect.objectContaining({ kind: 'control', reason: 'deadline_exceeded' }))
    const timeoutProvider = createJevProvider(config({ limits: { max_wall_ms: 5 } }), {
      fetch: vi.fn(async (_url, init) => await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))),
    })
    await expect(timeoutProvider.evaluate(request())).resolves.toEqual(expect.objectContaining({ kind: 'control', reason: 'deadline_exceeded' }))
  })

  it('does not treat missing pricing as free and supports reservation denial', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    const telemetry: any[] = []
    const provider = createJevProvider(config({ limits: { max_cost_usd: 0.01 } }), { fetch: vi.fn(), onTelemetry: record => telemetry.push(record) })
    await expect(provider.evaluate(request())).resolves.toEqual(expect.objectContaining({ kind: 'unavailable', reason: 'unknown_cost' }))
    expect(telemetry[0]).toMatchObject({ outcome: 'unavailable' })
    expect(telemetry[0].cost_usd).toBeUndefined()
    const reserved = createJevProvider(config(), { fetch: vi.fn() })
    const result = await reserved.evaluate(request(), { reservation: () => ({ ok: false, reason: 'budget_exhausted' }) })
    expect(result).toEqual(expect.objectContaining({ kind: 'unavailable', reason: 'budget_exhausted' }))
  })

  it('stops reading an oversized response at the configured byte bound', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    const body = JSON.stringify(validResponse()) + 'x'.repeat(10_000)
    const fetcher = vi.fn(async () => new Response(body, { status: 200 }))
    const result = await createJevProvider(config({ limits: { max_response_bytes: 128 } }), { fetch: fetcher }).evaluate(request())
    expect(result).toEqual(expect.objectContaining({ kind: 'unavailable', reason: 'byte_limit' }))
  })

  it('keeps concurrent calls within the configured request reservation', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    const fetcher = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return new Response(JSON.stringify(validResponse()), { status: 200 })
    })
    const provider = createJevProvider(config({ limits: { max_calls: 1 } }), { fetch: fetcher })
    const outcomes = await Promise.all([provider.evaluate(request({ id: 'a' })), provider.evaluate(request({ id: 'b' }))])
    expect(outcomes.filter(outcome => outcome.kind === 'success')).toHaveLength(1)
    expect(outcomes.filter(outcome => outcome.kind === 'unavailable' && outcome.reason === 'request_limit')).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('enforces the configured cost cap cumulatively across sequential calls', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...validResponse(), usage: { input_tokens: 369, output_tokens: 1 } }), { status: 200 }))
    const provider = createJevProvider(config({
      limits: { max_cost_usd: 0.000006, max_output_tokens: 1 },
      price: { input_usd_per_million_tokens: 0.01, output_usd_per_million_tokens: 0 },
    }), { fetch: fetcher })
    const first = await provider.evaluate(request({ call: 'one' }))
    const second = await provider.evaluate(request({ call: 'two' }))
    expect(first.kind).toBe('success')
    expect(second).toEqual(expect.objectContaining({ kind: 'unavailable', reason: 'budget_exhausted' }))
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('reserves cumulative cost atomically for concurrent calls', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const fetcher = vi.fn(async () => {
      await gate
      return new Response(JSON.stringify({ ...validResponse(), usage: { input_tokens: 369, output_tokens: 1 } }), { status: 200 })
    })
    const provider = createJevProvider(config({
      limits: { max_cost_usd: 0.000006, max_output_tokens: 1 },
      price: { input_usd_per_million_tokens: 0.01, output_usd_per_million_tokens: 0 },
    }), { fetch: fetcher })
    const firstPromise = provider.evaluate(request({ call: 'one' }))
    await Promise.resolve()
    const second = await provider.evaluate(request({ call: 'two' }))
    release()
    const first = await firstPromise
    expect(first.kind).toBe('success')
    expect(second).toEqual(expect.objectContaining({ kind: 'unavailable', reason: 'budget_exhausted' }))
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('charges an unknown billed retry attempt before admitting the retry', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    let attempts = 0
    const telemetry: any[] = []
    const fetcher = vi.fn(async () => {
      attempts++
      return attempts === 1
        ? new Response('temporary', { status: 503 })
        : new Response(JSON.stringify({ ...validResponse(), usage: { input_tokens: 369, output_tokens: 1 } }), { status: 200 })
    })
    const provider = createJevProvider(config({
      retry: { max_attempts: 2, base_delay_ms: 0, max_delay_ms: 0 },
      limits: { max_cost_usd: 0.000008, max_output_tokens: 1 },
      price: { input_usd_per_million_tokens: 0.01, output_usd_per_million_tokens: 0 },
    }), { fetch: fetcher, onTelemetry: record => telemetry.push(record) })
    const retried = await provider.evaluate(request({ call: 'retry' }))
    const after = await provider.evaluate(request({ call: 'after' }))
    expect(retried.kind).toBe('success')
    expect(after).toEqual(expect.objectContaining({ kind: 'unavailable', reason: 'budget_exhausted' }))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(telemetry).toHaveLength(2)
    expect(telemetry[0]).toMatchObject({ outcome: 'success', input_tokens: 369, cost_basis: 'mixed' })
  })

  it('uses a conservative byte bound for non-ASCII and symbol-heavy state', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    const fetcher = vi.fn(async () => new Response(JSON.stringify(validResponse()), { status: 200 }))
    const provider = createJevProvider(config({ limits: { max_input_tokens: 400 } }), { fetch: fetcher })
    const result = await provider.evaluate(request({ symbols: '😀'.repeat(100) }))
    expect(result).toEqual(expect.objectContaining({ kind: 'unavailable', reason: 'token_limit' }))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('caches only within the supplied scope and invalidates on state changes', async () => {
    vi.stubEnv('TYPESAFE_TEST_KEY', key)
    const fetcher = vi.fn(async () => new Response(JSON.stringify(validResponse()), { status: 200 }))
    const telemetry: any[] = []
    const provider = createJevProvider(config(), { fetch: fetcher, onTelemetry: record => telemetry.push(record) })
    const scope = { user: 'u', profile: 'p', project: 'project-1', run: 'run-1' }
    const first = await provider.evaluate(request({ value: 'a' }), { cache_scope: scope })
    const cached = await provider.evaluate(request({ value: 'a' }), { cache_scope: scope })
    const changed = await provider.evaluate(request({ value: 'b' }), { cache_scope: scope })
    await provider.evaluate(request({ value: 'a' }), { cache_scope: { ...scope, user: 'other-user' } })
    expect(first.kind).toBe('success')
    expect(cached).toEqual(expect.objectContaining({ kind: 'success', cached: true }))
    expect(changed).toEqual(expect.objectContaining({ kind: 'success', cached: false }))
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(telemetry[1]).toMatchObject({ outcome: 'success', cached: true, cost_usd: 0 })
    expect(telemetry[1].input_tokens).toBeUndefined()
    expect(telemetry[1].output_tokens).toBeUndefined()
  })
})

describe('decision state sanitization', () => {
  it('preserves booleans, strips protected fields, and filters tool payload fields', () => {
    expect(sanitizeDecisionState({ ok: true, providerState: { x: 1 }, tool: { id: 'x', input: { secret: 'x' } } })).toEqual({ ok: true, tool: { id: 'x' } })
  })
})
