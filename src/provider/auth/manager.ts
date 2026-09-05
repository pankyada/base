import { CODEX_OAUTH_ENDPOINTS, extractAccountId, type OAuthFetch } from './oauth.js'
import { markCodexReauthRequiredLocked, readCodexAuth, writeCodexCredentialLocked, type CodexCredential } from './store.js'
import { withCodexAuthLock } from './lock.js'
import { abortable, boundedJson, lifetime } from './async.js'

export interface RefreshOptions {
  home?: string
  fetch?: OAuthFetch
  endpoints?: { token?: string; clientId?: string }
  signal?: AbortSignal
  skewMs?: number
  timeoutMs?: number
  /** The rejected bearer avoids duplicate forced refresh after another process rotates it. */
  rejectedAccessToken?: string
  forceRefresh?: boolean
}
const flights = new Map<string, Promise<CodexCredential>>()

export async function getValidCodexCredential(options: RefreshOptions = {}): Promise<CodexCredential> {
  if (process.env.HARNESS_DISABLE_CODEX_OAUTH === '1') throw new Error('Codex OAuth is disabled; configure an API profile')
  options.signal?.throwIfAborted()
  const record = readCodexAuth(options.home)
  if (!record?.credential) throw new Error('Codex login required')
  if (!needsRefresh(record.credential, options)) return record.credential
  const key = `${options.home ?? ''}:${record.generation}`
  let flight = flights.get(key)
  if (!flight) {
    flight = refresh(options, record.generation)
    flights.set(key, flight)
    const cleanup = () => { if (flights.get(key) === flight) flights.delete(key) }
    void flight.then(cleanup, cleanup)
  }
  return abortable(flight, options.signal)
}

function needsRefresh(credential: CodexCredential, options: RefreshOptions): boolean {
  if (options.rejectedAccessToken && credential.access_token !== options.rejectedAccessToken) {
    return credential.expires_at <= Date.now() + (options.skewMs ?? 60_000)
  }
  return options.forceRefresh === true || credential.expires_at <= Date.now() + (options.skewMs ?? 60_000)
}

async function refresh(options: RefreshOptions, generation: string): Promise<CodexCredential> {
  // A caller canceling its wait must not cancel the shared token rotation.
  const operation = lifetime(options.timeoutMs ?? 30_000, undefined, 'Codex refresh')
  try {
    return await withCodexAuthLock(async () => {
      const current = readCodexAuth(options.home)
      if (!current?.credential || current.generation !== generation) throw new Error('Codex credential changed while refresh was pending')
      if (!needsRefresh(current.credential, options)) return current.credential
      const response = await abortable((options.fetch ?? fetch)(options.endpoints?.token ?? CODEX_OAUTH_ENDPOINTS.token, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'refresh_token', refresh_token: current.credential.refresh_token,
          client_id: options.endpoints?.clientId ?? CODEX_OAUTH_ENDPOINTS.clientId,
        }),
        signal: operation.signal,
      }), operation.signal)
      const body = await boundedJson(response, operation.signal) as Record<string, unknown>
      if (!body || typeof body !== 'object') throw new Error('Codex refresh returned invalid token response')
      if (!response.ok) {
        if (body.error === 'invalid_grant') {
          markCodexReauthRequiredLocked(current, options.home)
          throw new Error('Codex login expired; run harness auth login openai --method browser')
        }
        throw new Error(`Codex refresh failed (${response.status})`)
      }
      const expires = body.expires_in ?? 3600
      if (typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0) throw new Error('Codex refresh returned invalid expiry')
      const account = extractAccountId(body as any) ?? current.credential.account_id
      const rotated = body.refresh_token === undefined ? current.credential.refresh_token : body.refresh_token
      operation.signal.throwIfAborted()
      const next = writeCodexCredentialLocked({
        kind: 'codex_oauth', access_token: body.access_token as string, refresh_token: rotated as string,
        expires_at: Date.now() + expires * 1000, account_id: account,
        ...(account === current.credential.account_id ? { generation } : {}),
      }, current, options.home)
      return next.credential!
    }, { home: options.home, signal: operation.signal, timeoutMs: options.timeoutMs ?? 30_000 })
  } finally { operation.close() }
}
