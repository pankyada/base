import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { existsSync, readFileSync } from 'node:fs'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { createCodexTownQuotaProvider, codexRateLimitSnapshot } from '../src/town/quota-codex.js'
import type { Profile } from '../src/profiles/schema.js'
import type { CodexCredential } from '../src/provider/auth/store.js'

class FakeAppServer extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  requests: Array<Record<string, any>> = []
  private buffer = ''

  constructor(private readonly limits: unknown) {
    super()
    this.stdin.on('data', chunk => {
      this.buffer += chunk.toString('utf8')
      while (this.buffer.includes('\n')) {
        const newline = this.buffer.indexOf('\n')
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        const request = JSON.parse(line) as Record<string, any>
        this.requests.push(request)
        if (request.id === undefined) continue
        const result = request.method === 'account/login/start' ? { type: 'chatgptAuthTokens' }
          : request.method === 'account/read' ? { account: { type: 'chatgpt', email: 'fixture@example.test', planType: 'plus' }, requiresOpenaiAuth: false }
            : request.method === 'account/rateLimits/read' ? this.limits : {}
        this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
      }
    })
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.exitCode = signal === 'SIGKILL' ? 137 : 0
    setImmediate(() => this.emit('exit', this.exitCode, signal ?? null))
    return true
  }
}

const fixedNow = () => new Date('2026-09-13T00:00:00.000Z')
const profile = { name: 'codex-fixture', model: { auth: 'codex_oauth', id: 'gpt-5.4-mini' } } as Profile

function rateLimits(extra: Record<string, unknown> = {}) {
  return { rateLimitsByLimitId: { codex: {
    limitId: 'codex', primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1_800_000_000 },
    secondary: { usedPercent: 55, windowDurationMins: 10_080, resetsAt: 1_800_000_000 },
    rateLimitReachedType: null, spendControlReached: false, ...extra,
  } } }
}

describe('Codex app-server quota adapter', () => {
  it('binds the exact Base credential in an isolated app-server session and preserves every window', async () => {
    const child = new FakeAppServer(rateLimits())
    let optionsSeen: SpawnOptions | undefined
    let cwdSeen = ''
    const spawn = vi.fn((_command: string, args: string[], options: SpawnOptions) => {
      expect(args).toEqual(['app-server'])
      optionsSeen = options
      cwdSeen = options.cwd as string
      expect(existsSync(`${cwdSeen}/config.toml`)).toBe(true)
      expect(readFileSync(`${cwdSeen}/config.toml`, 'utf8')).toContain('cli_auth_credentials_store = "file"')
      return child as unknown as ChildProcess
    })
    const secret = 'access-token-sentinel'
    const accountId = 'account-id-sentinel'
    const provider = createCodexTownQuotaProvider({
      now: fixedNow,
      getCredential: vi.fn(async () => ({ kind: 'codex_oauth', access_token: secret, refresh_token: 'refresh-sentinel', account_id: accountId, expires_at: fixedNow().getTime() + 3_600_000, generation: 'generation-123456' } as CodexCredential)),
      spawn,
    })

    const quota = await provider.read({ user: 'fixture-user', profile })

    expect(quota).toMatchObject({ provider: 'codex_oauth', status: 'available', provider_reached: false, spend_control_reached: false, windows: [
      { limit_id: 'codex:primary', used_percent: 20, window_minutes: 300 },
      { limit_id: 'codex:secondary', used_percent: 55, window_minutes: 10_080 },
    ] })
    expect(quota.account_scope).not.toContain(accountId)
    expect(JSON.stringify(quota)).not.toContain(secret)
    expect(JSON.stringify(quota)).not.toContain(accountId)
    expect(child.requests.map(request => request.method)).toEqual(['initialize', 'initialized', 'account/login/start', 'account/read', 'account/rateLimits/read'])
    expect(child.requests[0].params.capabilities.experimentalApi).toBe(true)
    expect(child.requests[2].params).toMatchObject({ type: 'chatgptAuthTokens', accessToken: secret, chatgptAccountId: accountId })
    expect(child.requests[3].params).toEqual({ refreshToken: false })
    expect(optionsSeen?.env?.CODEX_HOME).toBe(cwdSeen)
    expect(optionsSeen?.env?.HOME).toBe(cwdSeen)
    expect(optionsSeen?.env?.OPENAI_API_KEY).toBeUndefined()
    expect(optionsSeen?.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(existsSync(cwdSeen)).toBe(false)
  })

  it('holds capacity if the exact Codex bucket or backend spend signal is missing', () => {
    const noBucket = codexRateLimitSnapshot({ rateLimits: { primary: { usedPercent: 1 }, secondary: { usedPercent: 2 } } }, 'scope', fixedNow())
    const noSpendSignal = codexRateLimitSnapshot(rateLimits({ spendControlReached: null }), 'scope', fixedNow())
    expect(noBucket.status).toBe('unavailable')
    expect(noSpendSignal.status).toBe('unavailable')
  })

  it('holds on provider rate-limit and spend-control reached signals', () => {
    expect(codexRateLimitSnapshot(rateLimits({ rateLimitReachedType: 'workspace_owner_usage_limit_reached' }), 'scope', fixedNow()).status).toBe('exhausted')
    expect(codexRateLimitSnapshot(rateLimits({ spendControlReached: true }), 'scope', fixedNow()).status).toBe('exhausted')
    expect(codexRateLimitSnapshot(rateLimits({ primary: { usedPercent: 100 }, secondary: null }), 'scope', fixedNow()).status).toBe('exhausted')
  })

  it('does not launch app-server for a non-Codex profile', async () => {
    const spawn = vi.fn()
    const provider = createCodexTownQuotaProvider({ spawn: spawn as any })
    const quota = await provider.read({ user: 'fixture-user', profile: { name: 'api', model: { auth: 'api_key' } } as Profile })
    expect(quota.status).toBe('unsupported')
    expect(spawn).not.toHaveBeenCalled()
  })
})
