import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, statSync, symlinkSync, mkdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logoutCodex, readCodexAuth, writeCodexCredential } from '../../src/provider/auth/store.js'

function home(): string { return mkdtempSync(join(tmpdir(), 'harness-codex-auth-')) }
const credential = { kind: 'codex_oauth' as const, access_token: 'access-a', refresh_token: 'refresh-a', expires_at: Date.now() + 60_000, account_id: 'acct-12345678' }

describe('Codex auth store', () => {
  it('writes versioned private record under auth path and preserves generation', async () => {
    const dir = home(); const first = await writeCodexCredential(credential, dir); const second = await writeCodexCredential({ ...credential, access_token: 'access-b' }, dir)
    expect(second.revision).toBe(2); expect(second.generation).not.toBe(first.generation); expect(readCodexAuth(dir)?.credential?.access_token).toBe('access-b')
    const path = join(dir, '.harness', 'auth', 'openai-codex.json'); expect(statSync(path).mode & 0o777).toBe(0o600); expect(readFileSync(path, 'utf8')).toContain('access-b')
  })
  it('logs out with tombstone without deleting unrelated key material', async () => {
    const dir = home(); const prior = await writeCodexCredential(credential, dir); const loggedOut = await logoutCodex(dir)
    expect(loggedOut.revision).toBe(prior.revision + 1); expect(loggedOut.credential).toBeUndefined(); expect(loggedOut.generation).not.toBe(prior.generation)
  })
  it('rejects symlinked auth directory and credential file', async () => {
    const dir = home(); const outside = home(); mkdirSync(join(outside, 'auth'), { recursive: true }); symlinkSync(join(outside, 'auth'), join(dir, '.harness'))
    await expect(writeCodexCredential(credential, dir)).rejects.toThrow('unsafe Codex auth directory')
    const safe = home(); await writeCodexCredential(credential, safe); const path = join(safe, '.harness', 'auth', 'openai-codex.json'); const target = join(safe, 'target.json'); unlinkSync(path); symlinkSync(target, path); expect(() => readCodexAuth(safe)).toThrow('non-regular')
  })
})
