import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'

type Wire = Record<string, any>
type Inbox = { messages: Wire[]; waiters: Array<{ resolve: (value: Wire) => void; reject: (error: Error) => void }> }
const root = mkdtempSync(join(tmpdir(), 'workflow-map-mounted-ws-'))
const inboxes = new WeakMap<WebSocket, Inbox>()
const validArtifact = [
  '## Files touched\nnone', '## Prior knowledge\nnone', '## Open questions\nnone',
  '## Plan\nsteps', '## Risks\nnone', '## Result\nok', '## Verification\npassed',
].join('\n')
let provider: Server
let child: ChildProcess | undefined
let port = 0
let base = ''
let wsUrl = ''
let serverOutput = ''
let harnessEnv: NodeJS.ProcessEnv
let holdNextCompletion = false
let heldResponse: ((text: string) => void) | undefined
let heldStarted: (() => void) | undefined
let heldStartedPromise = new Promise<void>(resolve => { heldStarted = resolve })

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port))
  })
}
function response(res: any, text: string, streaming = true): void {
  if (!streaming) {
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
    res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 4, completion_tokens: 4 } }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close', 'cache-control': 'no-cache' })
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 4, completion_tokens: 4 } })}\n\n`)
  res.end('data: [DONE]\n\n')
}
function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const inbox: Inbox = { messages: [], waiters: [] }
    inboxes.set(socket, inbox)
    socket.on('message', value => {
      try {
        const message = JSON.parse(String(value)) as Wire
        const waiter = inbox.waiters.shift()
        if (waiter) waiter.resolve(message)
        else inbox.messages.push(message)
      } catch { /* mounted fixture emits only JSON text */ }
    })
    socket.on('error', error => { while (inbox.waiters.length) inbox.waiters.shift()!.reject(error as Error) })
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}
function next(socket: WebSocket, timeoutMs = 10_000): Promise<Wire> {
  const inbox = inboxes.get(socket)!
  const queued = inbox.messages.shift()
  if (queued) return Promise.resolve(queued)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = inbox.waiters.findIndex(waiter => waiter.resolve === wrapped)
      if (i >= 0) inbox.waiters.splice(i, 1)
      reject(new Error(`mounted workflow-map frame timeout; server output: ${serverOutput.slice(-1200)}`))
    }, timeoutMs)
    const wrapped = (message: Wire) => { clearTimeout(timer); resolve(message) }
    inbox.waiters.push({ resolve: wrapped, reject })
  })
}
async function nextType(socket: WebSocket, type: string, timeoutMs = 10_000): Promise<Wire> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const message = await next(socket, Math.max(1, deadline - Date.now()))
    if (message.type === type) return message
    if (message.type === 'error') throw new Error(`waiting for ${type}; server error: ${JSON.stringify(message)}`)
    if (Date.now() >= deadline) throw new Error(`waiting for ${type}`)
  }
}
async function nextMapOrError(socket: WebSocket): Promise<Wire> {
  for (;;) {
    const message = await next(socket)
    if (message.type === 'workflow_map' || message.type === 'error') return message
  }
}
async function hello(socket: WebSocket, user: string, profile: string): Promise<Wire> {
  const ready = nextType(socket, 'session_ready')
  socket.send(JSON.stringify({ type: 'hello', protocol_version: 4, user_id: user, profile }))
  return ready
}
function sendMap(socket: WebSocket, scope: Wire, after_revision?: number): void {
  socket.send(JSON.stringify({ type: 'workflow_map', scope, ...(after_revision === undefined ? {} : { after_revision }) }))
}
async function close(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return
  await new Promise<void>(resolve => { socket.once('close', () => resolve()); socket.close() })
}
function reservePort(): Promise<number> {
  return new Promise(resolve => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const selected = (server.address() as any).port
      server.close(() => resolve(selected))
    })
  })
}
async function startHarness(): Promise<void> {
  serverOutput = ''
  child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/server/index.ts'], { cwd: process.cwd(), env: harnessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mounted harness startup timeout: ${serverOutput.slice(-1800)}`)), 15_000)
    const ready = (chunk: Buffer) => { serverOutput += chunk.toString(); if (serverOutput.includes('Harness server on')) { clearTimeout(timer); resolve() } }
    child!.stdout?.on('data', ready)
    child!.stderr?.on('data', ready)
    child!.once('exit', code => { clearTimeout(timer); reject(new Error(`harness exited ${code}: ${serverOutput.slice(-1800)}`)) })
  })
}
async function stopHarness(): Promise<void> {
  if (!child || child.exitCode !== null) return
  const running = child
  running.kill('SIGTERM')
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { running.kill('SIGKILL'); resolve() }, 4_000)
    running.once('exit', () => { clearTimeout(timer); resolve() })
  })
}
async function waitUntil(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`fixture condition timed out; server output: ${serverOutput.slice(-1600)}`)
    await new Promise(resolve => setTimeout(resolve, 15))
  }
}

beforeAll(async () => {
  const apiPort = await listen(provider = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] })); return
    }
    if (!req.url?.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return }
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      const request = JSON.parse(body) as { stream?: boolean; messages?: Array<{ content?: unknown }> }
      const prompt = String(request.messages?.at(-1)?.content ?? '')
      if (prompt.includes('Classify request for playbook')) {
        response(res, JSON.stringify({ task_class: 'general', recon_intensity: 1 }), request.stream === true); return
      }
      if (prompt.includes('Return ONLY JSON matching this schema')) {
        response(res, JSON.stringify({ task_class: 'general', blast_radius: 'module', reversibility: 'easy', intensity: { recon: 1, plan: 1, design: 0, build: 1, verify: 1, review: 0 }, confidence: 0.9, why: 'mounted fixture' }), request.stream === true); return
      }
      if (holdNextCompletion && prompt.includes('Stage contract:')) {
        holdNextCompletion = false
        heldStarted?.()
        heldResponse = text => response(res, text)
        return
      }
      response(res, validArtifact)
    })
  }))
  port = await reservePort()
  wsUrl = `ws://127.0.0.1:${port}`
  base = `http://127.0.0.1:${port}`
  const profiles = join(root, '.harness', 'profiles')
  mkdirSync(profiles, { recursive: true })
  const prompt = join(root, 'prompt.md')
  writeFileSync(prompt, 'isolated workflow map fixture', 'utf8')
  const profileYaml = (name: string, enabled: boolean) => [
    `name: ${name}`,
    'model:', `  base_url: http://127.0.0.1:${apiPort}/v1`, '  api_key_env: TEST_KEY', '  id: fixture-model',
    `system_prompt: ${prompt}`, `working_dir: ${root}`, `artifact_dir: ${join(root, 'artifacts', name)}`,
    ...(enabled ? [
      'workflow:', '  enabled: true', '  playbook: generic',
      '  budget:', '    max_usd_per_task: 2', '    max_stage_retries: 0', '    max_stage_minutes: 2',
      '  routing:', '    policy: static', '    explore_rate: 0', '    shadow_rate: 0', '    table: { recon: cheap, plan: cheap, build: cheap, verify: cheap }',
      '  knowledge:', '    graph: false', '    generalization_probe: false',
    ] : []),
    'tools:', '  builtin:', '    AskUser: allow', '  mcp_servers: []', '',
  ].join('\n')
  writeFileSync(join(profiles, 'map-fixture.yaml'), profileYaml('map-fixture', true), 'utf8')
  writeFileSync(join(profiles, 'flat-fixture.yaml'), profileYaml('flat-fixture', false), 'utf8')
  harnessEnv = { ...process.env, HOME: root, HARNESS_PORT: String(port), HARNESS_PROFILE: 'map-fixture', TEST_KEY: 'local-fixture-key', NODE_ENV: 'test' }
  await startHarness()
}, 30_000)

afterAll(async () => {
  await stopHarness()
  await new Promise<void>(resolve => provider?.close(() => resolve()))
  rmSync(root, { recursive: true, force: true })
})

describe('workflow map mounted WebSocket recovery and restart acceptance', () => {
  it('streams exact-scope observations to an observer, replays terminal history, rejects mismatches, and marks process restart unavailable', async () => {
    const controller = await open()
    const ready = await hello(controller, 'map-ws-user', 'map-fixture')
    holdNextCompletion = true
    heldStartedPromise = new Promise<void>(resolve => { heldStarted = resolve })
    controller.send(JSON.stringify({ type: 'message', content: 'safe fixture task' }))
    const started = await nextType(controller, 'turn_start')
    expect(started.run_id).toEqual(expect.any(String))
    const first = await nextType(controller, 'workflow_map')
    expect(first.observation).toMatchObject({ scope: { run_id: started.run_id, session_id: ready.sessionId, profile: 'map-fixture' }, kind: 'pass_started' })
    await heldStartedPromise
    let attemptStart: Wire
    do { attemptStart = await nextType(controller, 'workflow_map') } while (attemptStart.observation.kind !== 'attempt_started')
    expect(attemptStart.observation.kind).toBe('attempt_started')
    const currentRevision = attemptStart.observation.revision

    const observer = await open()
    await hello(observer, 'map-ws-user', 'map-fixture')
    observer.send(JSON.stringify({ type: 'attach', session_id: ready.sessionId, mode: 'observe' }))
    await nextType(observer, 'runtime')
    const scope = { run_id: started.run_id, session_id: ready.sessionId, profile: 'map-fixture' }
    sendMap(observer, scope)
    const initial = await nextType(observer, 'workflow_map')
    expect(initial.snapshot).toMatchObject({ scope, revision: currentRevision, availability: { state: 'available' }, attempts: [expect.objectContaining({ state: 'running' })] })

    heldResponse?.(validArtifact)
    heldResponse = undefined
    const live = await nextType(observer, 'workflow_map')
    expect(live.observation.scope).toEqual(scope)
    expect(live.observation.revision).toBeGreaterThan(currentRevision)

    const end = await nextType(controller, 'session_end')
    expect(end.status).toBe('completed')
    await close(observer)

    const replaySocket = await open()
    await hello(replaySocket, 'map-ws-user', 'map-fixture')
    replaySocket.send(JSON.stringify({ type: 'attach', session_id: ready.sessionId, mode: 'observe' }))
    await nextType(replaySocket, 'runtime')
    sendMap(replaySocket, scope, 0)
    const replayed: Wire[] = []
    for (;;) {
      const frame = await nextMapOrError(replaySocket)
      expect(frame.type).toBe('workflow_map')
      expect(frame.observation.scope).toEqual(scope)
      replayed.push(frame.observation)
      if (frame.observation.kind === 'terminal') break
    }
    expect(replayed[0].revision).toBe(1)
    expect(replayed.at(-1), JSON.stringify(replayed.map(item => ({ kind: item.kind, stage: item.attempt?.stage, state: item.attempt?.state, terminal: item.terminal })))).toMatchObject({ kind: 'terminal', terminal: 'completed' })
    expect(replayed.map(item => item.revision)).toEqual([...replayed].map(item => item.revision).sort((a, b) => a - b))

    for (const mismatched of [
      { ...scope, session_id: 'wrong-session' },
      { ...scope, profile: 'flat-fixture' },
      { ...scope, run_id: '00000000-0000-4000-8000-000000000001' },
    ]) {
      sendMap(replaySocket, mismatched)
      expect(await nextMapOrError(replaySocket)).toMatchObject({ type: 'error', message: 'workflow map scope mismatch' })
      await new Promise(resolve => setTimeout(resolve, 25))
      expect(inboxes.get(replaySocket)!.messages.filter(message => message.type === 'workflow_map')).toHaveLength(0)
    }
    expect(replayed.map(item => item.revision)).toEqual(replayed.map((_, index) => index + 1))
    await close(controller)
    await close(replaySocket)
    await stopHarness()
    await startHarness()

    const resumed = await open()
    await hello(resumed, 'map-ws-user', 'map-fixture')
    resumed.send(JSON.stringify({ type: 'resume', sessionId: ready.sessionId }))
    expect(await nextType(resumed, 'session_resumed')).toMatchObject({ sessionId: ready.sessionId, profile: 'map-fixture' })
    sendMap(resumed, scope)
    const afterRestart = await nextType(resumed, 'workflow_map')
    expect(afterRestart.snapshot).toMatchObject({
      scope,
      availability: { state: 'unavailable', reason: 'server_restarted' },
      attempts: [], transitions: [], advice: [],
    })
    await close(resumed)
  }, 45_000)

  it('projects the actual workflow for a REST /run into a later scoped observer snapshot', async () => {
    const response = await fetch(`${base}/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'map-fixture', user: 'rest-map-user', input: 'safe REST fixture task' }),
    })
    expect(response.status).toBe(200)
    const result = await response.json() as Wire
    expect(result).toMatchObject({ run_id: expect.any(String), session_id: expect.any(String) })
    const scope = { run_id: result.run_id, session_id: result.session_id, profile: 'map-fixture' }
    const runResponse = await fetch(`${base}/runs/${encodeURIComponent(scope.run_id)}?user=rest-map-user`)
    expect(await runResponse.json()).toMatchObject({ id: scope.run_id, session_id: scope.session_id, profile: scope.profile, status: 'completed' })

    const observer = await open()
    await hello(observer, 'rest-map-user', 'map-fixture')
    sendMap(observer, scope)
    const map = await nextType(observer, 'workflow_map')
    expect(map.snapshot).toMatchObject({ scope, availability: { state: 'available' }, terminal: 'completed' })
    expect(map.snapshot.attempts.length).toBeGreaterThan(0)
    expect(map.snapshot.transitions.length).toBeGreaterThan(0)
    await close(observer)
  }, 30_000)

  it('does not invent an execution map for a flat-loop run', async () => {
    const socket = await open()
    const ready = await hello(socket, 'flat-map-user', 'flat-fixture')
    socket.send(JSON.stringify({ type: 'message', content: 'flat fixture turn' }))
    const started = await nextType(socket, 'turn_start')
    expect(started.run_id).toEqual(expect.any(String))
    expect((await nextType(socket, 'session_end')).status).toBe('completed')
    sendMap(socket, { run_id: started.run_id, session_id: ready.sessionId, profile: 'flat-fixture' })
    const frame = await nextType(socket, 'workflow_map')
    expect(frame.snapshot).toMatchObject({ availability: { state: 'empty' }, attempts: [], transitions: [], advice: [] })
    await close(socket)
  }, 30_000)
})
