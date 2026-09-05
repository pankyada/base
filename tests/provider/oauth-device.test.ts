import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loginWithDevice } from '../../src/provider/auth/device.js'
import { readCodexAuth } from '../../src/provider/auth/store.js'

function home() { return mkdtempSync(join(tmpdir(), 'harness-codex-device-')) }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }
describe('Codex device login', () => {
  it('polls pending statuses then exchanges authorization code at OAuth token endpoint', async () => {
    const calls: Array<{ url: string; body: string }> = []; let polls = 0
    const fetcher = async (input: string | URL, init?: RequestInit) => { const url = String(input); calls.push({ url, body: String(init?.body ?? '') }); if (url.endsWith('/usercode')) return response({ device_auth_id: 'device-id', user_code: 'ABCD-EFGH', interval: '1' }); if (url.endsWith('/deviceauth/token')) { polls += 1; return polls === 1 ? response({}, 403) : response({ authorization_code: 'auth-code', code_verifier: 'verifier' }) }; return response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, account_id: 'acct-device' }) }
    const sleeps: number[] = []; const dir = home(); const credential = await loginWithDevice({ home: dir, fetch: fetcher, sleep: async ms => { sleeps.push(ms) } })
    expect(credential.account_id).toBe('acct-device'); expect(sleeps[0]).toBe(4000); expect(calls.at(-1)?.url).toContain('/oauth/token'); expect(calls.at(-1)?.body).toContain('redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback'); expect(readCodexAuth(dir)?.credential?.access_token).toBe('access')
  })
})
