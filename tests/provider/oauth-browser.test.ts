import { describe, expect, it } from 'vitest'
import { loginWithBrowser, extractAccountId, parseJwtClaims } from '../../src/provider/auth/oauth.js'
import { readCodexAuth } from '../../src/provider/auth/store.js'
import { writeCodexCredential } from '../../src/provider/auth/store.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function jwt(payload: Record<string, unknown>): string { const part = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `eyJhbGciOiJub25lIn0.${part}.sig` }
describe('Codex browser OAuth', () => {
  it('requires exchange and stores account from id token claims before success', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-oauth-')); let callbackResult: Response | undefined
    const id = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-from-claim' } })
    const fakeFetch = async (_input: string | URL, init?: RequestInit) => { expect(init?.redirect).toBe('error'); return new Response(JSON.stringify({ id_token: id, access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }) }
    const login = loginWithBrowser({ home, port: 0, fetch: fakeFetch, openBrowser: async url => { const parsed = new URL(url); const redirect = new URL(parsed.searchParams.get('redirect_uri')!); await new Promise(resolve => setTimeout(resolve, 5)); callbackResult = await fetch(`${redirect.origin}${redirect.pathname}?state=${parsed.searchParams.get('state')}&code=valid`) } })
    const result = await login
    expect(result.account_id).toBe('acct-from-claim'); expect(readCodexAuth(home)?.credential?.account_id).toBe('acct-from-claim'); expect(callbackResult?.status).toBe(200)
  })
  it('extracts nested account claim and rejects malformed JWT safely', () => { expect(extractAccountId({ access_token: jwt({ chatgpt_account_id: 'acct' }), refresh_token: 'r' })).toBe('acct'); expect(parseJwtClaims('not-a-jwt')).toBeUndefined() })
  it('keeps prior credential when exchange fails', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-oauth-')); await writeCodexCredential({ kind: 'codex_oauth', access_token: 'prior', refresh_token: 'prior-refresh', expires_at: Date.now() + 100000, account_id: 'prior-account' }, home)
    const fakeFetch = async () => new Response(JSON.stringify({ error: 'denied' }), { status: 400 })
    await expect(loginWithBrowser({ home, port: 0, timeoutMs: 500, fetch: fakeFetch, openBrowser: async url => { const parsed = new URL(url); const redirect = new URL(parsed.searchParams.get('redirect_uri')!); await fetch(`${redirect.origin}${redirect.pathname}?state=${parsed.searchParams.get('state')}&code=bad`) } })).rejects.toThrow()
    expect(readCodexAuth(home)?.credential?.access_token).toBe('prior')
  })
  it('does not save a late token after caller abort when exchange ignores signal', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-codex-oauth-')); const controller = new AbortController(); const id = jwt({ chatgpt_account_id: 'late-account' })
    const fakeFetch = async () => { await new Promise(resolve => setTimeout(resolve, 80)); return new Response(JSON.stringify({ id_token: id, access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600 }), { status: 200 }) }
    const login = loginWithBrowser({ home, port: 0, signal: controller.signal, timeoutMs: 500, fetch: fakeFetch, openBrowser: async url => { const parsed = new URL(url); const redirect = new URL(parsed.searchParams.get('redirect_uri')!); void fetch(`${redirect.origin}${redirect.pathname}?state=${parsed.searchParams.get('state')}&code=late`); await new Promise(resolve => setTimeout(resolve, 10)); controller.abort() } })
    await expect(login).rejects.toThrow('aborted'); await new Promise(resolve => setTimeout(resolve, 120)); expect(readCodexAuth(home)).toBeNull()
  })
})
