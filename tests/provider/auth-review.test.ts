import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { writeCodexCredential, readCodexAuth } from '../../src/provider/auth/store.js'
import { withCodexAuthLock } from '../../src/provider/auth/lock.js'
import { getValidCodexCredential } from '../../src/provider/auth/manager.js'
import { loginWithDevice } from '../../src/provider/auth/device.js'
import { loginWithBrowser } from '../../src/provider/auth/oauth.js'

const homes: string[] = []
function home() {
  const path = mkdtempSync(join(tmpdir(), 'base-auth-review-'))
  homes.push(path)
  return path
}
const credential = {
  kind: 'codex_oauth' as const, access_token: 'access-canary', refresh_token: 'refresh-canary',
  expires_at: Date.now() - 1, account_id: 'account-review',
}
afterEach(() => homes.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))

describe('independent credential lifecycle review', () => {
  it('rejects invalid replacement before touching the prior credential', async () => {
    const dir = home()
    await writeCodexCredential(credential, dir)
    const path = join(dir, '.harness/auth/openai-codex.json')
    const before = readFileSync(path, 'utf8')
    await expect(writeCodexCredential({ ...credential, expires_at: Infinity }, dir)).rejects.toThrow(/invalid/i)
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('read-only status rejects a symlinked parent directory', async () => {
    const outside = home()
    await writeCodexCredential(credential, outside)
    const dir = home()
    mkdirSync(join(dir, '.harness'))
    symlinkSync(join(outside, '.harness/auth'), join(dir, '.harness/auth'))
    expect(() => readCodexAuth(dir)).toThrow(/unsafe|symlink/i)
  })

  it('does not retry the mutation when its body raises EEXIST', async () => {
    let calls = 0
    await expect(withCodexAuthLock(() => {
      calls++
      throw Object.assign(new Error('mutation failed'), { code: 'EEXIST' })
    }, { home: home(), timeoutMs: 40 })).rejects.toThrow('mutation failed')
    expect(calls).toBe(1)
  })

  it('serializes credential mutations across real child processes', async () => {
    const dir = home()
    const moduleUrl = pathToFileURL(join(process.cwd(), 'src/provider/auth/store.ts')).href
    const script = `import { writeCodexCredential } from ${JSON.stringify(moduleUrl)};
      await writeCodexCredential(${JSON.stringify(credential)}, process.argv[1]);`
    const run = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, dir], { stdio: ['ignore', 'ignore', 'pipe'] })
      let error = ''
      child.stderr.on('data', data => { error += data.toString() })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(error)))
    })
    await Promise.all([run(), run(), run()])
    expect(readCodexAuth(dir)?.revision).toBe(3)
  })

  it('rotates account generation when refresh changes accounts', async () => {
    const dir = home()
    const before = await writeCodexCredential(credential, dir)
    const result = await getValidCodexCredential({ home: dir, fetch: async () => new Response(JSON.stringify({
      access_token: 'new-access', refresh_token: 'new-refresh', account_id: 'different-account', expires_in: 3600,
    })) })
    expect(result.generation).not.toBe(before.generation)
  })

  it('bounds body reads even if a transport ignores abort', async () => {
    const dir = home()
    await writeCodexCredential(credential, dir)
    const response = new Response(new ReadableStream({ start() {} }))
    const call = getValidCodexCredential({ home: dir, timeoutMs: 25, fetch: async () => response })
    const outcome = await Promise.race([
      call.then(() => 'resolved', error => String(error)),
      new Promise<string>(resolve => setTimeout(() => resolve('hung'), 150)),
    ])
    expect(outcome).toMatch(/timed out|timeout/i)
  })

  it('does not persist canceled login while waiting for another writer', async () => {
    const dir = home()
    await writeCodexCredential(credential, dir)
    let release!: () => void
    const held = withCodexAuthLock(() => new Promise<void>(resolve => { release = resolve }), { home: dir })
    const controller = new AbortController()
    const pending = writeCodexCredential({ ...credential, access_token: 'late-token' }, dir, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/abort/i)
    release()
    await held
    expect(readCodexAuth(dir)?.credential?.access_token).toBe(credential.access_token)
  })

  it('stops device denial rather than treating every 403 as pending', async () => {
    let calls = 0
    await expect(loginWithDevice({ home: home(), fetch: async () => {
      calls++
      return calls === 1
        ? new Response(JSON.stringify({ device_auth_id: 'device', user_code: 'code', interval: 1 }))
        : new Response(JSON.stringify({ error: 'access_denied' }), { status: 403 })
    } })).rejects.toThrow(/denied/i)
    expect(calls).toBe(2)
  })

  it('rejects duplicate callback state without consuming the valid login', async () => {
    const dir = home()
    let badStatus: number | undefined
    await loginWithBrowser({ home: dir, port: 0, timeoutMs: 1000,
      fetch: async () => new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', account_id: 'account' })),
      openBrowser: async raw => {
        const url = new URL(raw)
        const state = url.searchParams.get('state')!
        const callback = url.searchParams.get('redirect_uri')!
        badStatus = (await fetch(`${callback}?state=${state}&state=${state}&code=valid`)).status
        await fetch(`${callback}?state=${state}&code=valid`)
      },
    })
    expect(badStatus).toBe(400)
    expect(readCodexAuth(dir)?.credential?.access_token).toBe('access')
  })
})
