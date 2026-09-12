import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

type Wire = Record<string, any>
const root = mkdtempSync(join(tmpdir(), 'core-uplift-ws-'))
let api: Server
let harness: ChildProcess
let wsUrl: string

function listen(server: Server): Promise<number> {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)))
}
function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}
function closeAndWait(socket: WebSocket): Promise<void> {
  return new Promise(resolve => {
    socket.once('close', () => resolve())
    socket.close()
  })
}
function next(socket: WebSocket): Promise<Wire> {
  return new Promise((resolve, reject) => {
    const onMessage = (value: any) => { cleanup(); try { resolve(JSON.parse(String(value))) } catch (error) { reject(error) } }
    const onError = (error: Error) => { cleanup(); reject(error) }
    const cleanup = () => { socket.off('message', onMessage); socket.off('error', onError) }
    socket.on('message', onMessage); socket.once('error', onError)
  })
}
async function nextType(socket: WebSocket, type: string): Promise<Wire> {
  for (;;) { const message = await next(socket); if (message.type === type) return message }
}
async function nextTypeOrError(socket: WebSocket, type: string): Promise<Wire> {
  for (;;) { const message = await next(socket); if (message.type === type || message.type === 'error') return message }
}
async function hello(socket: WebSocket, user?: string, profile?: string, workingDir?: string): Promise<Wire> {
  const response = nextType(socket, 'session_ready')
  socket.send(JSON.stringify({ type: 'hello', protocol_version: 4, ...(user === undefined ? {} : { user_id: user }), ...(profile === undefined ? {} : { profile }), ...(workingDir === undefined ? {} : { working_dir: workingDir }) }))
  return response
}

describe('Core WebSocket scope fixture', () => {
  beforeAll(async () => {
    const apiPort = await listen(api = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [] })) }))
    const artifact = join(root, 'artifacts'); const prompt = join(root, 'prompt.md'); const otherWorkingDir = join(root, 'other-working-dir')
    mkdirSync(otherWorkingDir, { recursive: true })
    writeFileSync(prompt, 'fixture prompt', 'utf8')
    const model = `  base_url: http://127.0.0.1:${apiPort}/v1\n  api_key_env: TEST_KEY\n  id: fixture-model`
    const yaml = (name: string) => `name: ${name}\nmodel:\n${model}\nsystem_prompt: ${prompt}\nartifact_dir: ${artifact}\nworking_dir: ${name === 'other' ? otherWorkingDir : root}\n`
    const profiles = join(root, '.harness', 'profiles')
    mkdirSync(profiles, { recursive: true })
    writeFileSync(join(profiles, 'fixture.yaml'), yaml('fixture'), 'utf8')
    writeFileSync(join(profiles, 'other.yaml'), yaml('other'), 'utf8')
    const portServer = createServer(); const port = await listen(portServer); await new Promise<void>(resolve => portServer.close(() => resolve()))
    wsUrl = `ws://127.0.0.1:${port}`
    harness = spawn('pnpm', ['exec', 'tsx', 'src/server/index.ts'], {
      cwd: process.cwd(), env: { ...process.env, HOME: root, HARNESS_PORT: String(port), HARNESS_PROFILE: 'fixture', TEST_KEY: 'fixture-key' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await new Promise<void>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error(`harness startup timeout: ${output.slice(-1000)}`)), 15_000)
      const ready = (chunk: Buffer) => { output += chunk.toString(); if (output.includes('Harness server on')) { clearTimeout(timer); resolve() } }
      harness.stdout?.on('data', ready); harness.stderr?.on('data', ready)
      harness.once('exit', code => { clearTimeout(timer); reject(new Error(`harness exited ${code}: ${output.slice(-1000)}`)) })
    })
  }, 30_000)

  afterAll(async () => {
    if (harness && harness.exitCode === null) {
      harness.kill('SIGTERM')
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { harness.kill('SIGKILL'); resolve() }, 3000)
        harness.once('exit', () => { clearTimeout(timer); resolve() })
      })
    }
    await new Promise<void>(resolve => api?.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  })

  it('isolates users and preserves profile selection across sessions', async () => {
    const alice = await open(wsUrl); const aliceReady = await hello(alice, 'alice', 'fixture')
    expect(aliceReady).toMatchObject({ type: 'session_ready', profile: 'fixture' })
    const bob = await open(wsUrl); const bobReady = await hello(bob, 'bob', 'other')
    expect(bobReady).toMatchObject({ type: 'session_ready', profile: 'other', working_dir: realpathSync(join(root, 'other-working-dir')) })
    alice.send(JSON.stringify({ type: 'attach', session_id: bobReady.sessionId, mode: 'observe' }))
    expect(await nextType(alice, 'error')).toMatchObject({ type: 'error', message: 'session not found or belongs to another user' })
    alice.send(JSON.stringify({ type: 'runtime_subscribe', session_id: aliceReady.sessionId, after_seq: 999999, request_id: 'resync-1' }))
    expect(await nextType(alice, 'runtime')).toMatchObject({ request_id: 'resync-1', snapshot: { gap: true } })
    const observer = await open(wsUrl); await hello(observer, 'alice', 'fixture')
    observer.send(JSON.stringify({ type: 'attach', session_id: aliceReady.sessionId, mode: 'observe' }))
    expect(await nextType(observer, 'runtime')).toMatchObject({ snapshot: { session_id: aliceReady.sessionId } })
    observer.send(JSON.stringify({ type: 'message', content: 'must reject' }))
    expect(await nextType(observer, 'error')).toMatchObject({ message: 'observer connection cannot mutate session; claim control first' })
    observer.close()
    alice.close(); bob.close()
  })

  it('rejects malformed envelopes and invalid scope while retaining omitted default user', async () => {
    const socket = await open(wsUrl)
    socket.send('null'); expect(await nextType(socket, 'error')).toMatchObject({ type: 'error', message: 'Invalid message' })
    socket.send('[]'); expect(await nextType(socket, 'error')).toMatchObject({ type: 'error', message: 'Invalid message' })
    socket.send(JSON.stringify({ type: 'hello', user_id: null, protocol_version: 4 })); expect(await nextType(socket, 'error')).toMatchObject({ type: 'error', message: 'invalid user scope' })
    const ready = await hello(socket, undefined, 'other'); expect(ready).toMatchObject({ type: 'session_ready', profile: 'other' })
    socket.send(JSON.stringify({ type: 'runtime_subscribe', session_id: 42 })); expect(await nextType(socket, 'error')).toMatchObject({ type: 'error', message: 'invalid runtime cursor' })
    socket.send(JSON.stringify({ type: 'input_response', id: 'stale', value: 'late' })); expect(await nextType(socket, 'error')).toMatchObject({ type: 'error', message: 'stale or unknown response id' })
    socket.close()
  })

  it('returns a gap snapshot after wire-event retention overflows', async () => {
    const socket = await open(wsUrl)
    const ready = await hello(socket, 'overflow-user', 'fixture')
    for (let index = 0; index < 270; index += 1) {
      socket.send(JSON.stringify({ type: 'profiles_list' }))
      await nextType(socket, 'profiles')
    }
    socket.send(JSON.stringify({ type: 'runtime_subscribe', session_id: ready.sessionId, after_seq: 1 }))
    const runtime = await nextType(socket, 'runtime')
    expect(runtime.snapshot.gap).toBe(true)
    expect(runtime.snapshot.last_seq).toBeGreaterThan(256)
    expect(runtime.snapshot.events.length).toBeLessThanOrEqual(256)
    socket.close()
  })

  it('reports the resumed session\'s own profile in session_resumed, not the connection profile (PT-033)', async () => {
    const first = await open(wsUrl)
    const created = await hello(first, 'carol', 'fixture')
    expect(created).toMatchObject({ type: 'session_ready', profile: 'fixture' })
    first.close()

    // New connection starts on a different profile ('other'), then resumes the session
    // created under 'fixture' — session_resumed must report the resumed session's own
    // profile ('fixture'), since the resume handler re-resolves baseProfile to it.
    const second = await open(wsUrl)
    await hello(second, 'carol', 'other')
    second.send(JSON.stringify({ type: 'resume', sessionId: created.sessionId }))
    const resumed = await nextType(second, 'session_resumed')
    expect(resumed).toMatchObject({ type: 'session_resumed', sessionId: created.sessionId, profile: 'fixture' })
    second.close()
  })

  it('uses the TUI working directory for new sessions, profile switches, persistence, and resume', async () => {
    const projectA = join(root, 'project-a')
    const projectB = join(root, 'project-b')
    mkdirSync(projectA, { recursive: true })
    mkdirSync(projectB, { recursive: true })

    const first = await open(wsUrl)
    const created = await hello(first, 'cwd-user', 'fixture', projectA)
    expect(created).toMatchObject({ working_dir: realpathSync(projectA) })

    const switchedResponse = nextType(first, 'session_ready')
    first.send(JSON.stringify({ type: 'set_profile', profile: 'other' }))
    const switched = await switchedResponse
    expect(switched).toMatchObject({ profile: 'other', working_dir: realpathSync(projectA) })
    await closeAndWait(first)

    const second = await open(wsUrl)
    const fresh = await hello(second, 'cwd-user', 'other', projectB)
    expect(fresh).toMatchObject({ working_dir: realpathSync(projectB) })
    const resumedResponse = nextTypeOrError(second, 'session_resumed')
    second.send(JSON.stringify({ type: 'resume', sessionId: switched.sessionId }))
    const resumed = await resumedResponse
    expect(resumed).toMatchObject({ type: 'session_resumed', sessionId: switched.sessionId, profile: 'other', working_dir: realpathSync(projectA) })
    second.close()
  })

  it('rejects a supplied working directory that does not exist', async () => {
    const socket = await open(wsUrl)
    const errorResponse = nextType(socket, 'error')
    socket.send(JSON.stringify({ type: 'hello', protocol_version: 4, user_id: 'cwd-invalid', working_dir: join(root, 'missing-project') }))
    expect(await errorResponse).toMatchObject({ type: 'error', message: 'invalid working directory' })
    socket.close()
  })
})
