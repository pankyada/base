import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
async function hello(socket: WebSocket, user?: string, profile?: string): Promise<Wire> {
  socket.send(JSON.stringify({ type: 'hello', protocol_version: 4, ...(user === undefined ? {} : { user_id: user }), ...(profile === undefined ? {} : { profile }) }))
  return nextType(socket, 'session_ready')
}

describe('Core WebSocket scope fixture', () => {
  beforeAll(async () => {
    const apiPort = await listen(api = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [] })) }))
    const artifact = join(root, 'artifacts'); const prompt = join(root, 'prompt.md')
    writeFileSync(prompt, 'fixture prompt', 'utf8')
    const model = `  base_url: http://127.0.0.1:${apiPort}/v1\n  api_key_env: TEST_KEY\n  id: fixture-model`
    const yaml = (name: string) => `name: ${name}\nmodel:\n${model}\nsystem_prompt: ${prompt}\nartifact_dir: ${artifact}\nworking_dir: ${root}\n`
    const profiles = join(root, '.harness', 'profiles')
    const { mkdirSync } = await import('node:fs'); mkdirSync(profiles, { recursive: true })
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
    expect(bobReady).toMatchObject({ type: 'session_ready', profile: 'other' })
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
})
