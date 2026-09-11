import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

type Wire = Record<string, any>
type Inbox = { messages: Wire[]; waiters: Array<{ resolve: (value: Wire) => void; reject: (error: Error) => void }> }

const enabled = process.env.CORE_FINAL_BUILD_FIXTURE === '1'
let root = ''
const inboxes = new WeakMap<WebSocket, Inbox>()
let api: Server
let harness: ChildProcess | undefined
let wsUrl = ''
let completionCalls = 0
let serverOutput = ''
const completionRequests: Wire[] = []

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port))
  })
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const inbox: Inbox = { messages: [], waiters: [] }
    inboxes.set(socket, inbox)
    socket.on('message', value => {
      try {
        const message = JSON.parse(String(value)) as Wire
        const waiter = inbox.waiters.shift()
        if (waiter) waiter.resolve(message)
        else inbox.messages.push(message)
      } catch (error) {
        const waiter = inbox.waiters.shift()
        if (waiter) waiter.reject(error as Error)
      }
    })
    socket.on('error', error => { while (inbox.waiters.length) inbox.waiters.shift()!.reject(error as Error) })
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

function next(socket: WebSocket): Promise<Wire> {
  const inbox = inboxes.get(socket)!
  const message = inbox.messages.shift()
  if (message) return Promise.resolve(message)
  return new Promise((resolve, reject) => inbox.waiters.push({ resolve, reject }))
}

async function nextType(socket: WebSocket, type: string): Promise<Wire> {
  const deadline = Date.now() + 10_000
  const seen: string[] = []
  for (;;) {
    const message = await new Promise<Wire>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`waiting for ${type}; seen ${seen.join(',')}; server output: ${serverOutput.slice(-2000)}`)), Math.max(1, deadline - Date.now()))
      next(socket).then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
    })
    if (message.type === type) return message
    seen.push(String(message.type))
    if (message.type === 'error') throw new Error(`waiting for ${type}; server error: ${JSON.stringify(message)}`)
    if (Date.now() >= deadline) throw new Error(`waiting for ${type}; seen ${seen.join(',')}; server output: ${serverOutput.slice(-2000)}`)
  }
}

async function hello(socket: WebSocket, user: string, profile: string): Promise<Wire> {
  socket.send(JSON.stringify({ type: 'hello', protocol_version: 4, user_id: user, profile }))
  return nextType(socket, 'session_ready')
}

function streamResponse(res: any, chunks: unknown[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close', 'cache-control': 'no-cache' })
  for (const chunk of chunks) res.write(`data: ${chunk === '[DONE]' ? chunk : JSON.stringify(chunk)}\n\n`)
  res.end()
}

function assertFreshCompiledServer(): string {
  const compiled = join(process.cwd(), 'dist', 'src', 'server', 'index.js')
  const sourceRoot = join(process.cwd(), 'src')
  expect(existsSync(compiled)).toBe(true)
  const sourceFiles: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.endsWith('.ts')) sourceFiles.push(path)
    }
  }
  visit(sourceRoot)
  const latestSource = Math.max(...sourceFiles.map(path => statSync(path).mtimeMs))
  expect(statSync(compiled).mtimeMs).toBeGreaterThanOrEqual(latestSource)
  const text = readFileSync(compiled, 'utf8')
  expect(text).toContain('Harness server on ws://localhost:')
  return compiled
}

describe.skipIf(!enabled)('Core final validation against compiled build', () => {
  beforeAll(async () => {
    const compiled = assertFreshCompiledServer()
    root = mkdtempSync(join(tmpdir(), 'core-final-build-'))
    const apiPort = await listen(api = createServer((req, res) => {
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
        return
      }
      if (!req.url?.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return }
      let body = ''
      req.on('data', chunk => { body += chunk.toString() })
      req.on('end', () => {
        try { completionRequests.push(JSON.parse(body)) } catch { /* assertion reports missing request */ }
        completionCalls += 1
        if (completionCalls === 1) return streamResponse(res, [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'approval-call', function: { name: 'Bash', arguments: '{"command":"rm -rf /tmp/core-final-build-validation-noop"}' } }] } }] },
          { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }, '[DONE]',
        ])
        if (completionCalls === 2) return streamResponse(res, [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'input-call', function: { name: 'AskUser', arguments: '{"prompt":"Choose","kind":"text"}' } }] } }] },
          { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }, '[DONE]',
        ])
        return streamResponse(res, [
          { choices: [{ delta: { content: 'fixture complete' } }] },
          { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }, '[DONE]',
        ])
      })
    }))
    const prompt = join(root, 'prompt.md')
    const artifact = join(root, 'artifacts')
    writeFileSync(prompt, 'compiled fixture prompt', 'utf8')
    const profiles = join(root, '.harness', 'profiles')
    mkdirSync(profiles, { recursive: true })
    const yaml = (name: string) => [
      `name: ${name}`,
      'model:',
      `  base_url: http://127.0.0.1:${apiPort}/v1`,
      '  api_key_env: TEST_KEY',
      '  id: fixture-model',
      `system_prompt: ${prompt}`,
      `artifact_dir: ${artifact}`,
      `working_dir: ${root}`,
      'approval_mode: danger',
      'safety:',
      '  enabled: false',
      'tools:',
      '  builtin:',
      '    Bash: prompt',
      '    AskUser: allow',
      '',
    ].join('\n')
    writeFileSync(join(profiles, 'fixture.yaml'), yaml('fixture'), 'utf8')
    writeFileSync(join(profiles, 'other.yaml'), yaml('other'), 'utf8')

    const portServer = createServer()
    const port = await listen(portServer)
    await new Promise<void>(resolve => portServer.close(() => resolve()))
    wsUrl = `ws://127.0.0.1:${port}`
    const env = {
      PATH: process.env.PATH ?? '',
      LANG: process.env.LANG ?? 'C',
      HOME: root,
      HARNESS_PORT: String(port),
      HARNESS_PROFILE: 'fixture',
      TEST_KEY: 'fixture-key',
      NODE_ENV: 'test',
    }
    harness = spawn(process.execPath, [compiled], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`compiled harness startup timeout: ${serverOutput.slice(-2000)}`)), 15_000)
      const ready = (chunk: Buffer) => {
        serverOutput += chunk.toString()
        if (serverOutput.includes('Harness server on')) { clearTimeout(timer); resolve() }
      }
      harness?.stdout?.on('data', ready)
      harness?.stderr?.on('data', ready)
      harness?.once('exit', code => { clearTimeout(timer); reject(new Error(`compiled harness exited ${code}: ${serverOutput.slice(-2000)}`)) })
    })
  }, 30_000)

  afterAll(async () => {
    if (harness && harness.exitCode === null) {
      harness.kill('SIGTERM')
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { harness?.kill('SIGKILL'); resolve() }, 3000)
        harness?.once('exit', () => { clearTimeout(timer); resolve() })
      })
    }
    await new Promise<void>(resolve => { if (!api) resolve(); else api.close(() => resolve()) })
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('enforces mounted user/profile scope and runtime recovery boundaries', async () => {
    const alice = await open(wsUrl)
    const aliceReady = await hello(alice, 'alice', 'fixture')
    const bob = await open(wsUrl)
    const bobReady = await hello(bob, 'bob', 'other')
    alice.send(JSON.stringify({ type: 'attach', session_id: bobReady.sessionId, mode: 'observe' }))
    expect(await nextType(alice, 'error')).toMatchObject({ message: 'session not found or belongs to another user' })
    alice.send(JSON.stringify({ type: 'runtime_subscribe', session_id: aliceReady.sessionId, after_seq: 999999, request_id: 'future-cursor' }))
    expect(await nextType(alice, 'runtime')).toMatchObject({ request_id: 'future-cursor', snapshot: { gap: true } })
    for (let index = 0; index < 270; index += 1) {
      alice.send(JSON.stringify({ type: 'profiles_list' }))
      await nextType(alice, 'profiles')
    }
    alice.send(JSON.stringify({ type: 'runtime_subscribe', session_id: aliceReady.sessionId, after_seq: 1 }))
    const recovered = await nextType(alice, 'runtime')
    expect(recovered.snapshot.gap).toBe(true)
    expect(recovered.snapshot.last_seq).toBeGreaterThan(256)
    expect(recovered.snapshot.events.length).toBeLessThanOrEqual(256)
    const observer = await open(wsUrl)
    await hello(observer, 'alice', 'fixture')
    observer.send(JSON.stringify({ type: 'attach', session_id: aliceReady.sessionId, mode: 'observe' }))
    await nextType(observer, 'runtime')
    observer.send(JSON.stringify({ type: 'message', content: 'observer mutation' }))
    expect(await nextType(observer, 'error')).toMatchObject({ message: 'observer connection cannot mutate session; claim control first' })
    observer.close(); alice.close(); bob.close()
  }, 30_000)

  it('deduplicates mounted decisions and rejects stale or observer responses', async () => {
    const socket = await open(wsUrl)
    const ready = await hello(socket, 'decision-user', 'fixture')
    expect(ready.capabilities).toMatchObject({ runtime_recovery: true, correlated_decisions: true, model_effort_selection: true })
    socket.send(JSON.stringify({ type: 'message', content: 'start decisions' }))
    const prompt = await nextType(socket, 'tool_prompt')
    const approve = JSON.stringify({ type: 'tool_approve', id: prompt.id, request_id: 'approve-1' })
    socket.send(approve); expect(await nextType(socket, 'notice')).toMatchObject({ request_id: 'approve-1', message: 'decision accepted' })
    socket.send(approve); expect(await nextType(socket, 'notice')).toMatchObject({ request_id: 'approve-1', message: 'decision accepted' })
    expect((await nextType(socket, 'tool_end')).ok).toBe(true)
    const input = await nextType(socket, 'input_request')
    const answer = JSON.stringify({ type: 'input_response', id: input.id, value: 'answer', request_id: 'input-1' })
    socket.send(answer); expect(await nextType(socket, 'notice')).toMatchObject({ request_id: 'input-1', message: 'response accepted' })
    socket.send(answer); expect(await nextType(socket, 'notice')).toMatchObject({ request_id: 'input-1', message: 'response accepted' })
    expect((await nextType(socket, 'session_end')).status).toBe('completed')
    expect(completionCalls).toBe(3)

    socket.send(JSON.stringify({ type: 'input_response', id: 'stale', value: 'late', request_id: 'stale-1' }))
    expect(await nextType(socket, 'error')).toMatchObject({ request_id: 'stale-1', message: 'stale or unknown response id' })
    socket.close()
  }, 30_000)

  it('keeps provider effort default omission through mounted discovery and selection', async () => {
    const socket = await open(wsUrl)
    await hello(socket, 'provider-user', 'fixture')
    socket.send(JSON.stringify({ type: 'models_list' }))
    const models = await nextType(socket, 'models')
    expect(models.models[0].effort).toMatchObject({ status: 'unknown' })
    socket.send(JSON.stringify({ type: 'set_model', model: 'fixture-model', effort: 'low', request_id: 'model-invalid' }))
    expect(await nextType(socket, 'notice')).toMatchObject({ request_id: 'model-invalid', message: 'model effort change refused' })
    socket.send(JSON.stringify({ type: 'set_model', model: 'fixture-model', effort: null, request_id: 'model-default' }))
    expect(await nextType(socket, 'model_changed')).toMatchObject({ request_id: 'model-default', model: 'fixture-model', effort: null })
    socket.send(JSON.stringify({ type: 'message', content: 'provider payload' }))
    expect((await nextType(socket, 'session_end')).status).toBe('completed')
    expect(completionRequests.at(-1)).toMatchObject({ model: 'fixture-model' })
    expect(completionRequests.at(-1)).not.toHaveProperty('reasoning_effort')
    socket.close()
  }, 30_000)
})
