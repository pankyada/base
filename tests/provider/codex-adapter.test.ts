import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeCodexCredential } from '../../src/provider/auth/store.js'
import { createCodexProvider } from '../../src/provider/codex/adapter.js'
import { ProviderError } from '../../src/provider/errors.js'
import type { EffortCapability } from '../../src/types.js'
import { codexCatalogScope } from '../../src/provider/codex/models.js'

function frame(value: unknown): Uint8Array { return new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`) }
async function* body(values: Uint8Array[]) { for (const value of values) yield value }
describe('Codex Responses adapter', () => {
  it('serializes a live-discovered effort for a future model to a mounted backend', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-adapter-live-effort-'))
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 600_000, account_id: 'acct' }, home)
    let bodyText = ''
    const backend = createServer((req, res) => {
      req.on('data', chunk => { bodyText += chunk.toString() })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(`data: ${JSON.stringify({ type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: {} } })}\n\n`)
      })
    })
    await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve))
    const port = (backend.address() as { port: number }).port
    const responseEndpoint = `http://127.0.0.1:${port}/responses`
    const catalogEndpoint = `http://127.0.0.1:${port}/models`
    const effort: EffortCapability = {
      status: 'supported', options: [{ value: 'low', label: 'low', selectable: true }],
      source: 'live', checked_at: new Date().toISOString(), stale: false,
      scope: { transport: 'codex_subscription', endpoint: catalogEndpoint, provider_scope: codexCatalogScope('codex_subscription', catalogEndpoint, 'acct') },
    }
    try {
      const result = await createCodexProvider('gpt-future', { home, endpoint: responseEndpoint, effortCapability: effort }).generate({
        model: 'gpt-future', reasoningEffort: 'low', messages: [{ role: 'user', content: 'hi' }],
      })
      expect(result.text).toBe('ok')
      expect(JSON.parse(bodyText)).toMatchObject({ model: 'gpt-future', reasoning: { effort: 'low' } })
    } finally {
      await new Promise<void>(resolve => backend.close(() => resolve()))
    }
  })

  it('rejects live effort metadata bound to another account before sending', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-adapter-stale-effort-'))
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 600_000, account_id: 'acct-current' }, home)
    let sent = false
    const fetcher = async () => { sent = true; return new Response('{}', { status: 500 }) }
    const endpoint = 'http://127.0.0.1:9/responses'
    const catalogEndpoint = 'http://127.0.0.1:9/models'
    const effort: EffortCapability = {
      status: 'supported', options: [{ value: 'low', label: 'low', selectable: true }], source: 'live',
      checked_at: new Date().toISOString(), stale: false,
      scope: { transport: 'codex_subscription', endpoint: catalogEndpoint, provider_scope: codexCatalogScope('codex_subscription', catalogEndpoint, 'acct-old') },
    }
    await expect(createCodexProvider('gpt-future', { home, fetch: fetcher, endpoint, effortCapability: effort }).generate({
      model: 'gpt-future', reasoningEffort: 'low', messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toMatchObject({ code: 'stale_capability' })
    expect(sent).toBe(false)
  })

  it('sends fixed destination with latest account headers and preserves requested model', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-adapter-')); await writeCodexCredential({ kind: 'codex_oauth', access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 600_000, account_id: 'acct' }, home); let url = ''; let init: RequestInit | undefined
    const fetcher = async (input: string | URL, request?: RequestInit) => { url = String(input); init = request; return new Response(body([frame({ type: 'response.output_text.delta', delta: 'hello' }), frame({ type: 'response.completed', response: { output: [], usage: { input_tokens: 1, output_tokens: 1 } } })]) as any, { status: 200, headers: { 'content-type': 'text/event-stream' } }) }
    const result = await createCodexProvider('gpt-5.4-mini', { home, fetch: fetcher }).generate({ model: 'gpt-5.4-mini', messages: [{ role: 'user', content: 'hi' }] }, { sessionId: 'session' })
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses'); expect((init?.headers as Record<string, string>)['chatgpt-account-id']).toBe('acct'); expect((init?.headers as Record<string, string>).authorization).toBe('Bearer access'); expect(JSON.parse(String(init?.body)).model).toBe('gpt-5.4-mini'); expect(result.text).toBe('hello')
  })

  it('uses injected fetch for refresh and replays one unauthorized response with the new bearer', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-adapter-refresh-'))
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'old-access', refresh_token: 'refresh', expires_at: Date.now() + 600_000, account_id: 'acct' }, home)
    const seen: string[] = []
    const fetcher = async (input: string | URL, init?: RequestInit) => {
      seen.push(`${String(input)} ${String((init?.headers as Record<string, string>)?.authorization ?? '')}`)
      if (String(input).includes('/oauth/token')) {
        return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'refresh-2', expires_in: 3600, account_id: 'acct' }), { status: 200 })
      }
      if (seen.length === 1) return new Response('expired', { status: 401 })
      return new Response(body([frame({ type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: {} } })]) as any, { status: 200 })
    }
    const result = await createCodexProvider('gpt-5.4-mini', { home, fetch: fetcher }).generate({ model: 'gpt-5.4-mini', messages: [{ role: 'user', content: 'hi' }] })
    expect(result.text).toBe('ok')
    expect(seen).toEqual([
      expect.stringContaining('https://chatgpt.com/backend-api/codex/responses Bearer old-access'),
      expect.stringContaining('https://auth.openai.com/oauth/token '),
      expect.stringContaining('https://chatgpt.com/backend-api/codex/responses Bearer new-access'),
    ])
  })

  it('rejects before auth when request is already aborted and bounds an ignored fetch', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-adapter-abort-'))
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 600_000, account_id: 'acct' }, home)
    const controller = new AbortController()
    controller.abort()
    const fetcher = async () => new Response(body([]) as any, { status: 200 })
    await expect(createCodexProvider('gpt-5.4-mini', { home, fetch: fetcher }).generate({ model: 'gpt-5.4-mini', messages: [], signal: controller.signal })).rejects.toThrow()
    const hanging = async () => new Promise<Response>(() => undefined)
    await expect(createCodexProvider('gpt-5.4-mini', { home, fetch: hanging, timeoutMs: 20 }).generate({ model: 'gpt-5.4-mini', messages: [] })).rejects.toMatchObject({ code: 'deadline_exceeded' })
  })

  it('marks post-response disconnects ambiguous and parses bounded provider errors', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-adapter-errors-'))
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 600_000, account_id: 'acct' }, home)
    async function* disconnected() {
      yield frame({ type: 'response.output_text.delta', delta: 'partial' })
      throw new Error('Bearer secret-token')
    }
    const disconnect = async () => new Response(disconnected() as any, { status: 200 })
    await expect(createCodexProvider('gpt-5.4-mini', { home, fetch: disconnect }).generate({ model: 'gpt-5.4-mini', messages: [] })).rejects.toMatchObject({ code: 'transport', retryable: false, options: { ambiguous: true } })
    const quota = async () => new Response(JSON.stringify({ error: { code: 'quota_exceeded', message: 'token=secret-token quota' } }), { status: 429, headers: { 'x-request-id': 'req-1' } })
    const error = await createCodexProvider('gpt-5.4-mini', { home, fetch: quota }).generate({ model: 'gpt-5.4-mini', messages: [] }).catch(value => value as ProviderError)
    expect(error).toMatchObject({ code: 'quota_exceeded', status: 429, retryable: false, options: { requestId: 'req-1' } })
    expect((error as ProviderError).message).not.toContain('secret-token')
  })

  it('retains bounded non-JSON diagnostics while redacting credential echoes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-adapter-plain-error-'))
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'sensitive-access-token', refresh_token: 'refresh', expires_at: Date.now() + 600_000, account_id: 'acct' }, home)
    const backendError = async () => new Response('Invalid tool schema; Bearer sensitive-access-token', { status: 400, headers: { 'content-type': 'text/plain' } })
    const error = await createCodexProvider('gpt-5.4-mini', { home, fetch: backendError }).generate({ model: 'gpt-5.4-mini', messages: [] }).catch(value => value as ProviderError)
    expect((error as ProviderError).message).toContain('Invalid tool schema')
    expect((error as ProviderError).message).toContain('Bearer [redacted]')
    expect((error as ProviderError).message).not.toContain('sensitive-access-token')
  })

  it('retains unfamiliar bounded JSON provider details with sensitive keys redacted', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-adapter-json-detail-'))
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'sensitive-access-token', refresh_token: 'refresh', expires_at: Date.now() + 600_000, account_id: 'acct' }, home)
    const backendError = async () => new Response(JSON.stringify({ detail: "The 'None' model is not supported", error: { access_token: 'sensitive-access-token' } }), { status: 400 })
    const error = await createCodexProvider('gpt-5.4-mini', { home, fetch: backendError }).generate({ model: 'gpt-5.4-mini', messages: [] }).catch(value => value as ProviderError)
    expect((error as ProviderError).message).toContain("The 'None' model is not supported")
    expect((error as ProviderError).message).not.toContain('sensitive-access-token')
  })

  it('captures opaque reasoning continuation and validates executable schemas', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-adapter-continuation-'))
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 600_000, account_id: 'acct' }, home)
    const fetcher = async () => new Response(body([frame({ type: 'response.completed', response: { output: [{ type: 'reasoning', id: 'reason-1', encrypted_content: 'opaque' }] } })]) as any, { status: 200 })
    const result = await createCodexProvider('gpt-5.4-mini', { home, fetch: fetcher }).generate({ model: 'gpt-5.4-mini', messages: [] })
    expect(result.continuation).toMatchObject({ model: 'gpt-5.4-mini', items: [{ type: 'reasoning', encrypted_content: 'opaque' }] })

    const invalidSchema = async () => new Response(body([frame({ type: 'response.completed', response: { output: [{ type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'Read', arguments: '{"path":1}' }] } })]) as any, { status: 200 })
    await expect(createCodexProvider('gpt-5.4-mini', { home, fetch: invalidSchema }).generate({ model: 'gpt-5.4-mini', messages: [], tools: [{ name: 'Read', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } }] })).rejects.toMatchObject({ code: 'invalid_arguments' })
  })
})
