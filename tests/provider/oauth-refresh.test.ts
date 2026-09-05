import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getValidCodexCredential } from '../../src/provider/auth/manager.js'
import { codexAuthStatus, readCodexAuth, writeCodexCredential } from '../../src/provider/auth/store.js'

describe('Codex refresh manager', () => {
  it('refreshes once, keeps home and generation, and does not deadlock nested lock', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-refresh-')); const prior = await writeCodexCredential({ kind: 'codex_oauth', access_token: 'old', refresh_token: 'refresh', expires_at: Date.now() - 1, account_id: 'acct' }, home); let calls = 0
    const fakeFetch = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 10)); return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }), { status: 200 }) }
    const [one, two] = await Promise.all([getValidCodexCredential({ home, fetch: fakeFetch }), getValidCodexCredential({ home, fetch: fakeFetch })])
    expect(calls).toBe(1); expect(one.access_token).toBe('new'); expect(two.access_token).toBe('new'); const saved = readCodexAuth(home)!; expect(saved.generation).toBe(prior.generation); expect(saved.credential?.refresh_token).toBe('rotated')
  })
  it('canceling one waiter does not cancel shared refresh', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-refresh-')); await writeCodexCredential({ kind: 'codex_oauth', access_token: 'old', refresh_token: 'refresh', expires_at: Date.now() - 1, account_id: 'acct' }, home); let resolveFetch!: () => void
    const fakeFetch = async () => { await new Promise<void>(resolve => { resolveFetch = resolve }); return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'refresh', expires_in: 3600 }), { status: 200 }) }
    const cancel = new AbortController(); const first = getValidCodexCredential({ home, fetch: fakeFetch, signal: cancel.signal }); const second = getValidCodexCredential({ home, fetch: fakeFetch }); cancel.abort(); await expect(first).rejects.toThrow('aborted'); resolveFetch(); await expect(second).resolves.toMatchObject({ access_token: 'new' })
  })
  it('persists reauth tombstone on invalid grant', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-refresh-')); await writeCodexCredential({ kind: 'codex_oauth', access_token: 'old', refresh_token: 'refresh', expires_at: Date.now() - 1, account_id: 'acct' }, home)
    const fakeFetch = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    await expect(getValidCodexCredential({ home, fetch: fakeFetch })).rejects.toThrow('login expired')
    expect(readCodexAuth(home)?.credential).toBeUndefined(); expect(codexAuthStatus(home).status).toBe('reauth_required')
  })
})
