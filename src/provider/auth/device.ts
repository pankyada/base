import { CODEX_OAUTH_ENDPOINTS, extractAccountId, parseTokenResponse, type OAuthEndpoints, type OAuthFetch } from './oauth.js'
import { writeCodexCredential, type CodexCredential } from './store.js'
import { abortable, boundedJson, delay, lifetime } from './async.js'

export interface DeviceLoginOptions {
  home?: string; endpoints?: Partial<OAuthEndpoints>; fetch?: OAuthFetch
  write?: (message: string) => void; signal?: AbortSignal; timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}
const DEVICE_REDIRECT = 'https://auth.openai.com/deviceauth/callback'

export async function loginWithDevice(options: DeviceLoginOptions = {}): Promise<CodexCredential> {
  if (process.env.HARNESS_DISABLE_CODEX_OAUTH === '1') throw new Error('Codex OAuth is disabled')
  options.signal?.throwIfAborted()
  const endpoints = { ...CODEX_OAUTH_ENDPOINTS, ...options.endpoints }
  const totalMs = Math.min(options.timeoutMs ?? 900_000, 900_000)
  const operation = lifetime(totalMs, options.signal, 'Device login')
  let deadline = Date.now() + totalMs
  const fetcher = options.fetch ?? fetch
  const jsonHeaders = { 'content-type': 'application/json', accept: 'application/json' }
  const request = async (url: string, init: RequestInit, token = false) => {
    operation.signal.throwIfAborted()
    if (Date.now() >= deadline) throw new Error('Device login timed out')
    const network = lifetime(Math.min(15_000, deadline - Date.now()), operation.signal, 'Device request')
    try {
      const response = await abortable(fetcher(url, { ...init, redirect: 'error', signal: network.signal }), network.signal)
      const body = token ? await parseTokenResponse(response, network.signal) : await boundedJson(response, network.signal)
      return { response, body: body as Record<string, any> }
    } finally { network.close() }
  }
  try {
    const initial = await request(endpoints.deviceCode, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ client_id: endpoints.clientId }),
    })
    if (!initial.response.ok) throw new Error(`Device authorization failed (${initial.response.status})`)
    const device = initial.body
    if (!device || !nonempty(device.user_code) || !nonempty(device.device_auth_id)) throw new Error('Device authorization missing required fields')
    const interval = device.interval === undefined ? 5 : Number(device.interval)
    if (!Number.isFinite(interval) || interval <= 0 || interval > 900) throw new Error('Device authorization has invalid interval')
    let waitMs = interval * 1000 + 3000
    if (device.expires_in !== undefined) {
      if (typeof device.expires_in !== 'number' || !Number.isFinite(device.expires_in) || device.expires_in <= 0) throw new Error('Device authorization has invalid expiry')
      deadline = Math.min(deadline, Date.now() + device.expires_in * 1000)
    }
    options.write?.(`Open ${endpoints.issuer}/codex/device and enter code ${device.user_code}`)
    while (Date.now() < deadline) {
      const polled = await request(endpoints.deviceToken, {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ device_auth_id: device.device_auth_id, user_code: device.user_code }),
      })
      const body = polled.body
      const error = typeof body?.error === 'string' ? body.error : body?.error?.code
      // OpenCode's captured branch treats 403/404 as pending. Restrict the
      // empty-object fixture and explicit pending codes; never swallow denial.
      const emptyPending = [403, 404].includes(polled.response.status) && body && Object.keys(body).length === 0
      const pending = emptyPending || error === 'authorization_pending' || error === 'slow_down' || polled.response.status === 429
      if (pending) {
        if (error === 'slow_down') waitMs += 5000
        const retry = Number(polled.response.headers.get('retry-after'))
        const pause = Math.min(Math.max(waitMs, Number.isFinite(retry) ? retry * 1000 : 0), deadline - Date.now())
        if (options.sleep) await abortable(options.sleep(pause), operation.signal)
        else await delay(pause, operation.signal)
        continue
      }
      if (!polled.response.ok || error) throw new Error(`Device authorization denied or failed (${polled.response.status})`)
      if (!body || !nonempty(body.authorization_code) || !nonempty(body.code_verifier)) throw new Error('Device authorization missing code exchange fields')
      const exchanged = await request(endpoints.token, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: body.authorization_code,
          redirect_uri: DEVICE_REDIRECT, client_id: endpoints.clientId, code_verifier: body.code_verifier }),
      }, true)
      const token = exchanged.body
      operation.signal.throwIfAborted()
      if (Date.now() >= deadline) throw new Error('Device login timed out')
      return (await writeCodexCredential({
        kind: 'codex_oauth', access_token: token.access_token, refresh_token: token.refresh_token,
        expires_at: Date.now() + (token.expires_in ?? 3600) * 1000,
        account_id: extractAccountId(token as any)!,
      }, options.home, operation.signal)).credential!
    }
    throw new Error('Device login timed out')
  } finally { operation.close() }
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 16_384
}
