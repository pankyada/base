import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runAuthCommand } from '../src/cli/auth.js'
import { writeCodexCredential } from '../src/provider/auth/store.js'

function home() { return mkdtempSync(join(tmpdir(), 'harness-auth-cli-')) }
function io() { const lines: string[] = []; return { lines, io: { write: (line: string) => lines.push(line), error: (line: string) => lines.push(`ERR:${line}`) } } }
describe('auth CLI', () => {
  it('reports local status without refreshing or exposing tokens', async () => { const dir = home(); await writeCodexCredential({ kind: 'codex_oauth', access_token: 'access-secret', refresh_token: 'refresh-secret', expires_at: Date.now() + 100000, account_id: 'account-123456' }, dir); const capture = io(); const code = await runAuthCommand(['status', 'openai', '--json'], { homeDir: dir, io: capture.io }); expect(code).toBe(0); expect(capture.lines.join('\n')).toContain('active'); expect(capture.lines.join('\n')).not.toContain('access-secret'); expect(capture.lines.join('\n')).not.toContain('refresh-secret') })
  it('login browser stores only through injected login and logout preserves API files', async () => { const dir = home(); const capture = io(); const code = await runAuthCommand(['login', 'openai', '--method', 'browser'], { homeDir: dir, io: capture.io, browserLogin: async ({ home: authHome } = {}) => { const stored = await writeCodexCredential({ kind: 'codex_oauth', access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 100000, account_id: 'account-123456' }, authHome); return stored.credential! } }); expect(code).toBe(0); const out = await runAuthCommand(['logout', 'openai'], { homeDir: dir, io: capture.io }); expect(out).toBe(0); expect(capture.lines.join('\n')).toContain('API keys unchanged') })
  it('validates arguments and returns login-required for missing status', async () => { const capture = io(); expect(await runAuthCommand(['status', 'openai'], { homeDir: home(), io: capture.io })).toBe(3); expect(await runAuthCommand(['login', 'openai', '--method', 'wat'], { io: capture.io })).toBe(2); expect(await runAuthCommand(['status', 'anthropic'], { io: capture.io })).toBe(2) })
})
