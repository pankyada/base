import { describe, expect, it, vi } from 'vitest'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { checkOrigin, loadOriginPolicy } from '../src/server/origin.js'
import { createRestHandler } from '../src/server/rest.js'

describe('origin policy', () => {
  it('allows configured exact origins only', () => {
    const policy = loadOriginPolicy({ HARNESS_ALLOWED_ORIGINS: 'http://localhost:3000' })

    expect(checkOrigin('http://localhost:3000', policy)).toEqual({ ok: true })
    expect(checkOrigin('http://evil-localhost.com', policy)).toMatchObject({ ok: false })
    expect(checkOrigin('https://localhost:3000', policy)).toMatchObject({ ok: false })
    expect(checkOrigin('http://localhost:7337', policy)).toMatchObject({ ok: false })
  })

  it('allows browserless clients through their explicit branch', () => {
    expect(checkOrigin(undefined, { allowed: [], allowBrowserless: true })).toEqual({ ok: true })
    expect(checkOrigin(undefined, { allowed: [], allowBrowserless: false })).toMatchObject({ ok: false })
  })

  it('accepts the all-origin escape hatch and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const policy = loadOriginPolicy({ HARNESS_ALLOWED_ORIGINS: '*' })

    expect(checkOrigin('https://example.test', policy)).toEqual({ ok: true })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe('REST origin enforcement', () => {
  it('rejects a mismatched browser origin before route matching and reports policy from health', async () => {
    const handler = createRestHandler({
      defaultProfile: { name: 'test' },
      runStore: {} as any,
      abortRegistry: new Map(),
      skills: [],
      originPolicy: loadOriginPolicy({ HARNESS_ALLOWED_ORIGINS: 'http://localhost:3000' }),
    } as any)
    const server = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>(resolve => server.listen(0, resolve))
    const address = server.address() as AddressInfo
    const base = `http://127.0.0.1:${address.port}`

    const rejected = await fetch(`${base}/not-found`, { headers: { Origin: 'http://evil-localhost.com' } })
    expect(rejected.status).toBe(403)

    const health = await fetch(`${base}/health`, { headers: { Origin: 'http://localhost:3000' } })
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ origin_policy: { allowed: ['http://localhost:3000'], allowBrowserless: true } })
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
})
