import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { writeCodexCredential, type CodexCredential } from './store.js'
import { sanitizeError } from './redact.js'
import { abortable, boundedJson, lifetime } from './async.js'

export interface OAuthEndpoints {
  issuer: string; authorize: string; token: string; deviceCode: string; deviceToken: string; clientId: string
}
export const CODEX_OAUTH_ENDPOINTS: OAuthEndpoints = {
  issuer: 'https://auth.openai.com', authorize: 'https://auth.openai.com/oauth/authorize',
  token: 'https://auth.openai.com/oauth/token', deviceCode: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
  deviceToken: 'https://auth.openai.com/api/accounts/deviceauth/token', clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
}
export const CODEX_OAUTH_PORT = 1455
export const CODEX_OAUTH_REDIRECT = `http://localhost:${CODEX_OAUTH_PORT}/auth/callback`
export interface OAuthFetch { (input: string | URL, init?: RequestInit): Promise<Response> }
export interface BrowserLoginOptions {
  home?: string; endpoints?: Partial<OAuthEndpoints>; fetch?: OAuthFetch
  openBrowser?: (url: string) => Promise<void> | void; timeoutMs?: number; signal?: AbortSignal; port?: number
}
interface Pkce { verifier: string; challenge: string }

export async function loginWithBrowser(options: BrowserLoginOptions = {}): Promise<CodexCredential> {
  if (process.env.HARNESS_DISABLE_CODEX_OAUTH === '1') throw new Error('Codex OAuth is disabled')
  options.signal?.throwIfAborted()
  const endpoints = { ...CODEX_OAUTH_ENDPOINTS, ...options.endpoints }
  const operation = lifetime(options.timeoutMs ?? 300_000, options.signal, 'OAuth login')
  const pkce = generatePkce()
  const state = randomUUID()
  const server = createServer()
  const sockets = new Set<Socket>()
  let callbackUsed = false
  let redirect = CODEX_OAUTH_REDIRECT
  let boundPort = options.port ?? CODEX_OAUTH_PORT
  let resolveLogin!: (value: CodexCredential) => void
  let rejectLogin!: (error: Error) => void
  const callback = new Promise<CodexCredential>((resolve, reject) => { resolveLogin = resolve; rejectLogin = reject })
  void callback.catch(() => undefined)
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  server.on('request', (request, response) => {
    const reply = (status: number, text: string) => {
      if (response.destroyed) return
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end(text)
    }
    void (async () => {
      let url: URL
      try { url = new URL(request.url ?? '/', redirect) } catch { reply(400, 'Invalid callback'); return }
      if (url.pathname !== '/auth/callback' || request.method !== 'GET' || request.headers.host !== `localhost:${boundPort}`) {
        reply(404, 'Not found'); return
      }
      if (callbackUsed) { reply(409, 'Login callback already used'); return }
      if (url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) {
        reply(400, 'Invalid login state'); return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      if (error) {
        callbackUsed = true
        reply(400, 'Login denied')
        rejectLogin(new Error(`OAuth authorization denied: ${sanitizeError(error)}`))
        return
      }
      if (!code || code.length > 16_384 || url.searchParams.getAll('code').length !== 1) {
        reply(400, 'Missing or duplicate authorization code'); return
      }
      callbackUsed = true
      try {
        const token = await exchangeCodeForTokens(code, redirect, pkce, endpoints, options.fetch ?? fetch, operation.signal)
        operation.signal.throwIfAborted()
        const account = extractAccountId(token)!
        const record = await writeCodexCredential({
          kind: 'codex_oauth', access_token: token.access_token, refresh_token: token.refresh_token,
          expires_at: Date.now() + (token.expires_in ?? 3600) * 1000, account_id: account,
        }, options.home, operation.signal)
        reply(200, 'Login complete. You can close this window.')
        resolveLogin(record.credential!)
      } catch (failure) {
        reply(400, 'Login failed')
        rejectLogin(new Error(sanitizeError(failure)))
      }
    })().catch(error => { reply(400, 'Login failed'); rejectLogin(new Error(sanitizeError(error))) })
  })
  try {
    await abortable(listen(server, options.port ?? CODEX_OAUTH_PORT, operation.signal), operation.signal)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('OAuth callback listener unavailable')
    boundPort = address.port
    redirect = `http://localhost:${boundPort}/auth/callback`
    const authorize = new URL(endpoints.authorize)
    authorize.search = new URLSearchParams({
      response_type: 'code', client_id: endpoints.clientId, redirect_uri: redirect,
      scope: 'openid profile email offline_access', code_challenge: pkce.challenge, code_challenge_method: 'S256',
      id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', state, originator: 'base',
    }).toString()
    const opened = Promise.resolve().then(() => options.openBrowser?.(authorize.toString()))
    await abortable(opened, operation.signal)
    return await abortable(callback, operation.signal)
  } finally {
    operation.close()
    rejectLogin(new Error('OAuth login ended'))
    await close(server, sockets)
  }
}

function generatePkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}
export interface TokenResponse {
  id_token?: string; access_token: string; refresh_token: string; expires_in?: number; account_id?: string; account?: { id?: string }
}
export interface IdTokenClaims {
  chatgpt_account_id?: string; chatgpt_compute_residency?: string; organizations?: Array<{ id: string }>
  ['https://api.openai.com/auth']?: { chatgpt_account_id?: string; chatgpt_compute_residency?: string }
}
export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  if (typeof token !== 'string' || token.length > 128 * 1024) return undefined
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const value = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch { return undefined }
}
export function extractAccountId(tokens: TokenResponse): string | undefined {
  const candidates: unknown[] = []
  for (const token of [tokens.id_token, tokens.access_token]) {
    if (typeof token !== 'string') continue
    const claims = parseJwtClaims(token)
    candidates.push(claims?.chatgpt_account_id, claims?.['https://api.openai.com/auth']?.chatgpt_account_id)
    if (Array.isArray(claims?.organizations)) candidates.push(claims.organizations[0]?.id)
  }
  candidates.push(tokens.account_id, tokens.account?.id)
  return candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 1024 && !/[\r\n]/.test(value))
}
export function extractResidency(token: string): string | undefined {
  const claims = parseJwtClaims(token)
  const value = claims?.['https://api.openai.com/auth']?.chatgpt_compute_residency ?? claims?.chatgpt_compute_residency
  return typeof value === 'string' && value !== 'no_constraint' ? value : undefined
}
export async function exchangeCodeForTokens(code: string, redirectUri: string, pkce: Pkce, endpoints = CODEX_OAUTH_ENDPOINTS, fetcher: OAuthFetch = fetch, signal?: AbortSignal): Promise<TokenResponse> {
  const response = await abortable(fetcher(endpoints.token, {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: endpoints.clientId, code_verifier: pkce.verifier }), signal,
  }), signal)
  return parseTokenResponse(response, signal)
}
export async function parseTokenResponse(response: Response, signal?: AbortSignal): Promise<TokenResponse> {
  const body = await boundedJson(response, signal) as TokenResponse
  const validToken = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 128 * 1024
  if (!response.ok || !body || !validToken(body.access_token) || !validToken(body.refresh_token) ||
      (body.expires_in !== undefined && (!Number.isFinite(body.expires_in) || body.expires_in <= 0))) {
    throw new Error(`OAuth token exchange failed (${response.status})`)
  }
  if (!extractAccountId(body)) throw new Error('OAuth token response did not include a validated account id')
  return body
}
function listen(server: Server, port: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ port, host: '127.0.0.1', signal }, () => { server.off('error', reject); resolve() })
  })
}
function close(server: Server, sockets: Set<Socket>): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(() => { for (const socket of sockets) socket.destroy() }, 500)
    server.close(() => { clearTimeout(timer); resolve() })
  })
}
