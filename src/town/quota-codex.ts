import { createHash } from 'node:crypto'
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createInterface } from 'node:readline'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Profile } from '../profiles/schema.js'
import { getValidCodexCredential } from '../provider/auth/manager.js'
import type { CodexCredential } from '../provider/auth/store.js'
import type { QuotaSnapshot, QuotaWindow } from './types.js'

const PROVIDER = 'codex_oauth'
const LIMIT_ID = 'codex'
const MAX_LINE_BYTES = 1024 * 1024
const RPC_TIMEOUT_MS = 3_000

interface JsonRpcMessage { id?: number | string; method?: string; result?: unknown; error?: unknown; params?: unknown }
type SpawnAppServer = (command: string, args: string[], options: SpawnOptions) => ChildProcess

export interface CodexQuotaProviderOptions {
  /** Base auth store home. The child app-server receives its own private CODEX_HOME. */
  home?: string
  getCredential?: (home: string) => Promise<CodexCredential>
  spawn?: SpawnAppServer
  now?: () => Date
  rpcTimeoutMs?: number
}

function record(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined
}

function unavailable(reason: string, now: Date, scope = ''): QuotaSnapshot {
  return {
    provider: PROVIDER, account_scope: scope, status: 'unavailable', fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 15_000).toISOString(), windows: [], source: 'Codex app-server account rate limits', last_error: reason,
  }
}

function parseWindow(raw: unknown, id: string): QuotaWindow | undefined {
  if (raw === null || raw === undefined) return undefined
  const value = record(raw)
  if (!value || !Number.isFinite(value.usedPercent) || value.usedPercent < 0 || value.usedPercent > 100) throw new Error('invalid quota window')
  const window: QuotaWindow = { limit_id: id, used_percent: value.usedPercent, exhausted: value.usedPercent >= 100 }
  if (value.windowDurationMins !== null && value.windowDurationMins !== undefined) {
    if (!Number.isFinite(value.windowDurationMins) || value.windowDurationMins <= 0) throw new Error('invalid quota duration')
    window.window_minutes = value.windowDurationMins
  }
  if (value.resetsAt !== null && value.resetsAt !== undefined) {
    if (!Number.isFinite(value.resetsAt) || value.resetsAt <= 0) throw new Error('invalid quota reset')
    window.resets_at = new Date(value.resetsAt * 1000).toISOString()
  }
  return window
}

/** Parse only the exact Codex bucket. A null/missing provider signal remains unavailable. */
export function codexRateLimitSnapshot(result: unknown, accountScope: string, now = new Date()): QuotaSnapshot {
  const payload = record(result)
  const buckets = record(payload?.rateLimitsByLimitId)
  const bucket = record(buckets?.[LIMIT_ID])
  if (!bucket || (typeof bucket.limitId === 'string' && bucket.limitId !== LIMIT_ID)) return unavailable('authoritative Codex quota bucket is missing', now, accountScope)
  if (!Object.hasOwn(bucket, 'rateLimitReachedType') || !Object.hasOwn(bucket, 'spendControlReached') || typeof bucket.spendControlReached !== 'boolean') {
    return unavailable('Codex capacity signals are incomplete', now, accountScope)
  }
  const reachedType = bucket.rateLimitReachedType
  if (reachedType !== null && typeof reachedType !== 'string') return unavailable('Codex capacity signals are invalid', now, accountScope)
  try {
    const windows = [
      parseWindow(bucket.primary, `${LIMIT_ID}:primary`),
      parseWindow(bucket.secondary, `${LIMIT_ID}:secondary`),
    ].filter((item): item is QuotaWindow => item !== undefined)
    if (!windows.length) return unavailable('Codex returned no applicable quota windows', now, accountScope)
    const providerReached = reachedType !== null
    const exhausted = providerReached || bucket.spendControlReached || windows.some(item => item.used_percent >= 100)
    return {
      provider: PROVIDER,
      account_scope: accountScope,
      status: exhausted ? 'exhausted' : 'available',
      provider_reached: providerReached,
      spend_control_reached: bucket.spendControlReached,
      ...(providerReached ? { reached_type: reachedType } : {}),
      fetched_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 30_000).toISOString(),
      windows,
      source: 'Codex app-server account/rateLimits/read',
    }
  } catch {
    return unavailable('Codex returned an invalid quota window', now, accountScope)
  }
}

function opaqueScope(accountId: string): string {
  return createHash('sha256').update(`codex_subscription\u0000${accountId}`).digest('hex').slice(0, 24)
}

function jsonRpc(child: ChildProcess, timeoutMs: number): { request(method: string, params?: unknown): Promise<unknown>; notify(method: string): void; close(): void } {
  if (!child.stdin || !child.stdout) throw new Error('Codex app-server pipes are unavailable')
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>()
  let nextId = 1
  let closed = false
  const rejectPending = (error: Error) => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
    pending.clear()
  }
  lines.on('line', line => {
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) { rejectPending(new Error('oversized Codex protocol response')); return }
    let message: JsonRpcMessage
    try { message = JSON.parse(line) as JsonRpcMessage } catch { rejectPending(new Error('invalid Codex protocol response')); return }
    if (message.method && message.id !== undefined) {
      // This quota-only client has no refresh or other server-initiated capabilities.
      child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unsupported quota probe request' } })}\n`)
      return
    }
    if (typeof message.id !== 'number') return
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    clearTimeout(item.timer)
    if (message.error !== undefined) item.reject(new Error('Codex app-server request failed'))
    else item.resolve(message.result)
  })
  child.stderr?.on('data', () => { /* stderr may contain sensitive provider details; drain and discard */ })
  child.once('error', () => rejectPending(new Error('Codex app-server could not start')))
  child.once('exit', () => { closed = true; rejectPending(new Error('Codex app-server exited')) })
  return {
    request(method, params) {
      if (closed) return Promise.reject(new Error('Codex app-server is closed'))
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Codex app-server request timed out')) }, timeoutMs)
        timer.unref?.()
        pending.set(id, { resolve, reject, timer })
        const request = { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }
        try { child.stdin!.write(`${JSON.stringify(request)}\n`) } catch {
          clearTimeout(timer)
          pending.delete(id)
          reject(new Error('Codex app-server request failed'))
        }
      })
    },
    notify(method) { child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`) },
    close() { lines.close(); closed = true; rejectPending(new Error('Codex app-server closed')) },
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already stopped */ }; resolve() }, 500)
    timer.unref?.()
    child.once('exit', () => { clearTimeout(timer); resolve() })
    try { child.kill('SIGTERM') } catch { clearTimeout(timer); resolve() }
  })
}

/**
 * Uses Codex app-server's documented external-token lifecycle in a private CODEX_HOME.
 * See https://developers.openai.com/codex/app-server and
 * https://developers.openai.com/codex/config-advanced. No thread/model methods are called.
 */
export function createCodexTownQuotaProvider(options: CodexQuotaProviderOptions = {}) {
  const now = options.now ?? (() => new Date())
  const getCredential = options.getCredential ?? (home => getValidCodexCredential({ home }))
  const spawnAppServer = options.spawn ?? ((command, args, spawnOptions) => nodeSpawn(command, args, spawnOptions))
  return {
    async read({ profile }: { user: string; profile: Profile }): Promise<QuotaSnapshot> {
      if (profile.model?.auth !== 'codex_oauth') return {
        provider: String(profile.model?.auth ?? 'unknown'), account_scope: '', status: 'unsupported', windows: [],
        source: 'Codex app-server account rate limits', last_error: 'selected profile does not use Base Codex OAuth',
      }
      let credential: CodexCredential
      try { credential = await getCredential(options.home ?? homedir()) }
      catch { return unavailable('Base Codex credentials are unavailable', now()) }
      if (!credential.account_id || !credential.access_token || credential.expires_at <= now().getTime()) return unavailable('Base Codex credentials are not valid', now())
      const accountScope = opaqueScope(credential.account_id)
      let home: string | undefined
      let child: ChildProcess | undefined
      let rpc: ReturnType<typeof jsonRpc> | undefined
      try {
        home = await mkdtemp(join(tmpdir(), 'harness-town-codex-'))
        await chmod(home, 0o700)
        await mkdir(join(home, 'auth'), { mode: 0o700 })
        await writeFile(join(home, 'config.toml'), 'cli_auth_credentials_store = "file"\ncheck_for_update_on_startup = false\n[history]\npersistence = "none"\n', { mode: 0o600 })
        const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home, HOME: home, USERPROFILE: home }
        delete env.OPENAI_API_KEY
        child = spawnAppServer('codex', ['app-server'], { cwd: home, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
        rpc = jsonRpc(child, options.rpcTimeoutMs ?? RPC_TIMEOUT_MS)
        await rpc.request('initialize', { clientInfo: { name: 'base-town-quota', version: '1.0.0' }, capabilities: { experimentalApi: true } })
        rpc.notify('initialized')
        const login = record(await rpc.request('account/login/start', {
          type: 'chatgptAuthTokens', accessToken: credential.access_token, chatgptAccountId: credential.account_id,
        }))
        if (login?.type !== 'chatgptAuthTokens') return unavailable('Codex rejected the external Base credential', now(), accountScope)
        const accountResult = record(await rpc.request('account/read', { refreshToken: false }))
        if (record(accountResult?.account)?.type !== 'chatgpt') return unavailable('Codex account identity could not be confirmed', now(), accountScope)
        const rateResult = await rpc.request('account/rateLimits/read')
        return codexRateLimitSnapshot(rateResult, accountScope, now())
      } catch {
        return unavailable('Codex quota probe failed', now(), accountScope)
      } finally {
        rpc?.close()
        if (child) await stopChild(child)
        if (home) await rm(home, { recursive: true, force: true }).catch(() => undefined)
      }
    },
  }
}
