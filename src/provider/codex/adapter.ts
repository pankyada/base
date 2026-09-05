import { readCodexAuth } from '../auth/store.js'
import { getValidCodexCredential } from '../auth/manager.js'
import { extractResidency, type OAuthFetch } from '../auth/oauth.js'
import { sanitizeError } from '../auth/redact.js'
import { abortable, boundedJson, lifetime } from '../auth/async.js'
import { ProviderError } from '../errors.js'
import type { ModelCallContext, ProviderClient, ProviderEvent, ProviderRequest, ProviderResult } from '../types.js'
import { prepareCodexHistory, serializeCodexRequest } from './request.js'
import { parseCodexSse } from './stream.js'

export const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'

export interface CodexAdapterOptions {
  home?: string
  endpoint?: string
  fetch?: OAuthFetch
  userAgent?: string
  timeoutMs?: number
  reasoningEffort?: string
}

export function createCodexProvider(model: string, options: CodexAdapterOptions = {}): ProviderClient {
  return {
    kind: 'codex_oauth',
    model,
    assertCredentialGeneration: async expectedGeneration => {
      const current = readCodexAuth(options.home)
      if (process.env.HARNESS_DISABLE_CODEX_OAUTH === '1' || !expectedGeneration || !current?.credential || current.generation !== expectedGeneration) {
        throw new ProviderError('Codex credential generation changed; start a new turn before executing tools', { code: 'credential_changed' })
      }
    },
    stream: (request, context) => streamCodex(request, context, options),
    generate: async (request, context) => {
      let result: ProviderResult | undefined
      for await (const event of streamCodex(request, context, options)) {
        if (event.type === 'done') result = event.result
      }
      if (!result) throw new ProviderError('Codex stream ended without a result', { code: 'unexpected_eof' })
      return result
    },
  }
}

async function* streamCodex(
  request: ProviderRequest,
  context: ModelCallContext | undefined,
  options: CodexAdapterOptions,
): AsyncIterable<ProviderEvent> {
  if (process.env.HARNESS_DISABLE_CODEX_OAUTH === '1') {
    throw new ProviderError('Codex OAuth is disabled; configure an API profile', { code: 'disabled' })
  }

  const upstreamSignal = context?.signal ?? request.signal
  upstreamSignal?.throwIfAborted()
  if (context?.deadline !== undefined && context.deadline <= Date.now()) throw new ProviderError('Codex deadline exceeded', { code: 'deadline_exceeded' })
  const timeoutMs = Math.min(options.timeoutMs ?? 120_000, context?.deadline === undefined ? Infinity : context.deadline - Date.now())
  const operation = new AbortController()
  const abortOperation = () => operation.abort(upstreamSignal?.reason)
  upstreamSignal?.addEventListener('abort', abortOperation, { once: true })
  const timeout = setTimeout(() => operation.abort(new Error('Codex generation timed out')), timeoutMs)
  const fetcher = options.fetch ?? fetch
  let timedOut = false
  const timeoutWatcher = () => { timedOut = true }
  operation.signal.addEventListener('abort', timeoutWatcher, { once: true })

  try {
    const initial = await getValidCodexCredential({ home: options.home, fetch: fetcher, signal: operation.signal })
    if (context?.credentialGeneration && context.credentialGeneration !== initial.generation) {
      throw new ProviderError('Codex credential changed before inference', { code: 'credential_changed' })
    }
    const body = serializeCodexRequest(prepareCodexHistory({ ...request, reasoningEffort: request.reasoningEffort ?? options.reasoningEffort }, initial.generation))
    let credential = initial
    let replayed = false

    while (true) {
      operation.signal.throwIfAborted()
      context?.beforeAttempt?.()
      let response: Response
      try {
        response = await withAbort(fetcher(options.endpoint ?? CODEX_API_ENDPOINT, {
          method: 'POST',
          redirect: 'error',
          headers: requestHeaders(credential, context),
          body: JSON.stringify(body),
          signal: operation.signal,
        }), operation.signal, timeoutMs)
      } catch (error) {
        if (operation.signal.aborted) throw cancellationError(timedOut, upstreamSignal)
        throw transportError(error, true)
      }

      if (response.status === 401 && !replayed) {
        replayed = true
        void response.body?.cancel().catch(() => undefined)
        const refreshed = await getValidCodexCredential({
          home: options.home,
          fetch: fetcher,
          signal: operation.signal,
          forceRefresh: true,
          rejectedAccessToken: credential.access_token,
        })
        if (refreshed.generation !== initial.generation) {
          throw new ProviderError('Codex credential generation changed during retry', { code: 'credential_changed', status: 401 })
        }
        credential = refreshed
        continue
      }
      if (response.status === 401) {
        void response.body?.cancel().catch(() => undefined)
        throw new ProviderError('Codex authentication expired', { code: 'unauthorized', status: 401, retryable: false })
      }
      if (!response.ok) throw await providerResponseError(response, operation.signal, [credential.access_token, credential.refresh_token])
      if (!response.body) throw new ProviderError('Codex response body missing', { code: 'unexpected_eof', ambiguous: true })

      try {
        yield* parseCodexSse(withBoundedBody(response.body, operation.signal), {
          signal: operation.signal,
          knownTools: request.tools?.map(tool => tool.name) ?? [],
          toolSchemas: Object.fromEntries((request.tools ?? []).map(tool => [tool.name, tool.parameters])),
          accountGeneration: credential.generation,
          model: request.model,
        })
        return
      } catch (error) {
        if (operation.signal.aborted) throw cancellationError(timedOut, upstreamSignal)
        if (error instanceof ProviderError) throw error
        throw transportError(error, true)
      }
    }
  } finally {
    clearTimeout(timeout)
    operation.signal.removeEventListener('abort', timeoutWatcher)
    upstreamSignal?.removeEventListener('abort', abortOperation)
  }
}

function requestHeaders(credential: { access_token: string; account_id: string }, context?: ModelCallContext): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${credential.access_token}`,
    'chatgpt-account-id': credential.account_id,
    'content-type': 'application/json',
    accept: 'text/event-stream',
    'user-agent': 'harness-codex/0.8',
    originator: 'base',
    'session-id': context?.sessionId ?? 'harness',
  }
  const residency = extractResidency(credential.access_token)
  if (residency) headers['x-openai-internal-codex-residency'] = residency
  return headers
}

async function providerResponseError(response: Response, signal: AbortSignal, secrets: string[]): Promise<ProviderError> {
  const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined
  const retryAfterHeader = response.headers.get('retry-after')
  const retryAfterMs = retryAfterHeader && Number.isFinite(Number(retryAfterHeader)) ? Number(retryAfterHeader) * 1000 : undefined
  let payload: unknown
  const reading = lifetime(8000, signal, 'Codex error response')
  try { payload = await boundedJson(response, reading.signal) }
  catch { signal.throwIfAborted() }
  finally { reading.close() }
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : undefined
  const nested = record?.error && typeof record.error === 'object' && !Array.isArray(record.error) ? record.error as Record<string, unknown> : undefined
  const code = typeof nested?.code === 'string' ? nested.code : typeof record?.code === 'string' ? record.code : undefined
  const message = typeof nested?.message === 'string' ? nested.message : typeof record?.message === 'string' ? record.message : `Codex inference failed (${response.status})`
  const quota = code?.toLowerCase().includes('quota') || code === 'usage_limit_reached' || response.status === 402
  const throttle = response.status === 429 || response.status >= 500
  return new ProviderError(sanitizeError(sanitizeProviderMessage(message), secrets), {
    code: code ? sanitizeError(code, secrets).slice(0, 128) : (quota ? 'quota_exhausted' : throttle ? 'throttled' : 'provider_error'),
    status: response.status,
    requestId: requestId ? sanitizeError(requestId, secrets).slice(0, 256) : undefined,
    retryAfterMs,
    retryable: throttle && !quota,
  })
}

function sanitizeProviderMessage(message: string): string {
  return sanitizeError(message).replace(/\b(token|secret|code|key|password)=([^\s,;}]+)/gi, '$1=[redacted]')
}

async function* withBoundedBody(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<Uint8Array> {
  const reader = body.getReader()
  try {
    while (true) {
      const next = await abortable(reader.read(), signal)
      if (next.done) return
      yield next.value
    }
  } finally {
    // Do not await an uncooperative remote cancel callback after local abort.
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      if (timer) clearTimeout(timer)
    }
    const onAbort = () => { cleanup(); reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError')) }
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => { cleanup(); reject(new Error('Codex operation timed out')) }, timeoutMs)
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}

function cancellationError(timedOut: boolean, upstreamSignal?: AbortSignal): ProviderError {
  if (upstreamSignal?.aborted) return new ProviderError('Codex generation cancelled', { code: 'aborted', ambiguous: true })
  return new ProviderError(timedOut ? 'Codex generation timed out' : 'Codex generation cancelled', { code: timedOut ? 'deadline_exceeded' : 'aborted', ambiguous: true })
}

function transportError(error: unknown, afterResponse: boolean): ProviderError {
  return new ProviderError(sanitizeError(error), { code: 'transport', retryable: false, ambiguous: afterResponse })
}
