import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

type Wire = Record<string, any>
const root = mkdtempSync(join(tmpdir(), 'core-uplift-decisions-'))
let api: Server
let harness: ChildProcess
let wsUrl: string
let completionCalls = 0
const completionRequests: Wire[] = []
const inboxes = new WeakMap<WebSocket, { messages: Wire[]; waiters: Array<{ resolve: (value: Wire) => void; reject: (error: Error) => void }> }>()

function listen(server: Server): Promise<number> {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)))
}
function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url); const inbox: { messages: Wire[]; waiters: Array<{ resolve: (value: Wire) => void; reject: (error: Error) => void }> } = { messages: [], waiters: [] }; inboxes.set(socket, inbox)
    socket.on('message', value => {
      try {
        const message = JSON.parse(String(value)) as Wire
        const waiter = inbox.waiters.shift(); if (waiter) waiter.resolve(message); else inbox.messages.push(message)
      } catch (error) { const waiter = inbox.waiters.shift(); if (waiter) waiter.reject(error as Error) }
    })
    socket.on('error', error => { while (inbox.waiters.length) inbox.waiters.shift()!.reject(error as Error) })
    socket.once('open', () => resolve(socket)); socket.once('error', reject)
  })
}
function next(socket: WebSocket): Promise<Wire> {
  const inbox = inboxes.get(socket)!; const message = inbox.messages.shift(); if (message) return Promise.resolve(message)
  return new Promise((resolve, reject) => inbox.waiters.push({ resolve, reject }))
}
async function nextType(socket: WebSocket, type: string): Promise<Wire> {
  for (;;) { const message = await next(socket); if (message.type === type) return message }
}
async function hello(socket: WebSocket): Promise<Wire> {
  socket.send(JSON.stringify({ type: 'hello', protocol_version: 4, user_id: 'decision-user', profile: 'fixture' }))
  return nextType(socket, 'session_ready')
}
function streamResponse(res: any, chunks: unknown[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close', 'cache-control': 'no-cache' })
  for (const chunk of chunks) res.write(`data: ${chunk === '[DONE]' ? chunk : JSON.stringify(chunk)}\n\n`)
  res.end()
}

describe('Core correlated decisions over mounted WebSocket', () => {
  beforeAll(async () => {
    const apiPort = await listen(api = createServer((_req, res) => {
      if (_req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'fixture-model', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }], default_reasoning_level: 'medium' }] }))
        return
      }
      if (!(_req.url?.endsWith('/chat/completions'))) { res.writeHead(404); res.end(); return }
      let body = ''
      _req.on('data', chunk => { body += chunk.toString() })
      _req.on('end', () => {
      let request: Wire = {}
      try { request = JSON.parse(body); completionRequests.push(request) } catch { /* assertion reports missing request */ }
      completionCalls += 1
      const reconnectApproval = JSON.stringify(request).includes('reconnect approval')
      if (completionCalls === 1 || reconnectApproval) return streamResponse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'approval-call', function: { name: 'Bash', arguments: '{"command":"rm -rf /tmp/core-uplift-decision-noop"}' } }] } }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }, '[DONE]',
      ])
      if (completionCalls === 2) return streamResponse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'input-call', function: { name: 'AskUser', arguments: '{"prompt":"Choose","kind":"text"}' } }] } }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }, '[DONE]',
      ])
      return streamResponse(res, [
        { choices: [{ delta: { content: 'done' } }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }, '[DONE]',
      ])
      })
    }))
    const prompt = join(root, 'prompt.md'); writeFileSync(prompt, 'fixture prompt', 'utf8')
    const profiles = join(root, '.harness', 'profiles'); mkdirSync(profiles, { recursive: true })
    const yaml = [
      'name: fixture', 'model:', `  base_url: http://127.0.0.1:${apiPort}/v1`, '  api_key_env: TEST_KEY', '  id: fixture-model',
      `system_prompt: ${prompt}`, `artifact_dir: ${join(root, 'artifacts')}`, `working_dir: ${root}`, 'approval_mode: danger', 'safety:', '  enabled: false',
      'tools:', '  builtin:', '    Bash: prompt', '    AskUser: allow', '',
    ].join('\n')
    writeFileSync(join(profiles, 'fixture.yaml'), yaml, 'utf8')
    const portServer = createServer(); const port = await listen(portServer); await new Promise<void>(resolve => portServer.close(() => resolve()))
    wsUrl = `ws://127.0.0.1:${port}`
    const env = { ...process.env }
    for (const key of ['HARNESS_PROFILE', 'HARNESS_USER', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY']) delete env[key]
    Object.assign(env, { HOME: root, HARNESS_PORT: String(port), HARNESS_PROFILE: 'fixture', TEST_KEY: 'fixture-key' })
    harness = spawn('pnpm', ['exec', 'tsx', 'src/server/index.ts'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error(`harness startup timeout: ${output.slice(-1000)}`)), 15_000)
      const ready = (chunk: Buffer) => { output += chunk.toString(); if (output.includes('Harness server on')) { clearTimeout(timer); resolve() } }
      harness.stdout?.on('data', ready); harness.stderr?.on('data', ready); harness.once('exit', code => { clearTimeout(timer); reject(new Error(`harness exited ${code}: ${output.slice(-1000)}`)) })
    })
  }, 30_000)

  afterAll(async () => {
    if (harness && harness.exitCode === null) {
      harness.kill('SIGTERM')
      await new Promise<void>(resolve => { const timer = setTimeout(() => { harness.kill('SIGKILL'); resolve() }, 3000); harness.once('exit', () => { clearTimeout(timer); resolve() }) })
    }
    await new Promise<void>(resolve => api?.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  })

  it('deduplicates repeated approval and input decisions with correlated ACKs', async () => {
    const socket = await open(wsUrl); const ready = await hello(socket)
    expect(ready.capabilities).toMatchObject({ runtime_recovery: true, correlated_decisions: true, model_effort_selection: true })
    socket.send(JSON.stringify({ type: 'message', content: 'start' }))
    const prompt = await nextType(socket, 'tool_prompt'); expect(prompt.id).toBe('approval-call')
    const approve = JSON.stringify({ type: 'tool_approve', id: prompt.id, request_id: 'approve-1' })
    socket.send(approve); expect(await nextType(socket, 'notice')).toMatchObject({ request_id: 'approve-1', message: 'decision accepted' })
    socket.send(approve); expect(await nextType(socket, 'notice')).toMatchObject({ request_id: 'approve-1', message: 'decision accepted' })
    expect((await nextType(socket, 'tool_end')).ok).toBe(true)
    const input = await nextType(socket, 'input_request')
    const answer = JSON.stringify({ type: 'input_response', id: input.id, value: 'answer', request_id: 'input-1' })
    socket.send(answer); expect(await nextType(socket, 'notice')).toMatchObject({ request_id: 'input-1', message: 'response accepted' })
    socket.send(answer); expect(await nextType(socket, 'notice')).toMatchObject({ request_id: 'input-1', message: 'response accepted' })
    expect((await nextType(socket, 'session_end')).status).toBe('completed')
    expect(completionCalls).toBe(3); expect(ready.profile).toBe('fixture'); socket.close()
  })

  it('recovers an in-process approval after its controlling socket reconnects', async () => {
    const first = await open(wsUrl); const ready = await hello(first)
    first.send(JSON.stringify({ type: 'message', content: 'reconnect approval' }))
    const prompt = await nextType(first, 'tool_prompt')
    const closed = new Promise<void>(resolve => first.once('close', () => resolve()))
    first.close()
    await closed

    const second = await open(wsUrl); await hello(second)
    second.send(JSON.stringify({ type: 'resume', sessionId: ready.sessionId }))
    expect(await nextType(second, 'session_resumed')).toMatchObject({ sessionId: ready.sessionId, profile: 'fixture' })
    second.send(JSON.stringify({ type: 'runtime_subscribe', session_id: ready.sessionId }))
    const runtime = await nextType(second, 'runtime')
    expect(runtime.snapshot.actionable).toEqual([expect.objectContaining({ id: prompt.id, name: 'Bash', input: { command: 'rm -rf /tmp/core-uplift-decision-noop' } })])

    second.send(JSON.stringify({ type: 'tool_approve', id: prompt.id, request_id: 'reconnect-approve' }))
    expect(await nextType(second, 'notice')).toMatchObject({ request_id: 'reconnect-approve', message: 'decision accepted' })
    expect((await nextType(second, 'tool_end')).ok).toBe(true)
    second.close()
  })

  it('rejects unknown and mismatched actions, and blocks observers', async () => {
    const socket = await open(wsUrl); const ready = await hello(socket)
    socket.send(JSON.stringify({ type: 'input_response', id: 'missing', value: 'x', request_id: 'bad-1' }))
    expect(await nextType(socket, 'error')).toMatchObject({ request_id: 'bad-1', message: 'stale or unknown response id' })
    socket.send(JSON.stringify({ type: 'tool_approve', id: 'different', request_id: 'bad-1' }))
    expect(await nextType(socket, 'error')).toMatchObject({ request_id: 'bad-1', message: 'request id already used for another action' })
    const observer = await open(wsUrl); await hello(observer)
    observer.send(JSON.stringify({ type: 'attach', session_id: ready.sessionId, mode: 'observe' })); await nextType(observer, 'runtime')
    observer.send(JSON.stringify({ type: 'input_response', id: 'missing', value: 'x', request_id: 'observer-1' }))
    expect(await nextType(observer, 'error')).toMatchObject({ request_id: 'observer-1', message: 'observer connection cannot mutate session; claim control first' })
    observer.close(); socket.close()
  })

  it('discovers effort, acknowledges atomic selection, and sends effective pair', async () => {
    const socket = await open(wsUrl); await hello(socket)
    socket.send(JSON.stringify({ type: 'models_list' }))
    const models = await nextType(socket, 'models')
    expect(models.models[0].effort).toMatchObject({ status: 'unknown' })
    socket.send(JSON.stringify({ type: 'set_model', model: 'fixture-model', effort: 'low', request_id: 'model-1' }))
    expect(await nextType(socket, 'notice')).toMatchObject({ message: 'model effort change refused', request_id: 'model-1' })
    socket.send(JSON.stringify({ type: 'set_model', model: 'fixture-model', effort: null, request_id: 'model-2' }))
    expect(await nextType(socket, 'model_changed')).toMatchObject({ model: 'fixture-model', effort: null, request_id: 'model-2' })
    socket.send(JSON.stringify({ type: 'message', content: 'payload check' }))
    await nextType(socket, 'session_end')
    expect(completionRequests.at(-1)).toMatchObject({ model: 'fixture-model' })
    expect(completionRequests.at(-1)).not.toHaveProperty('reasoning_effort')
    socket.close()
  })
})
