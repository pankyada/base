import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createSession, saveSession } from '../src/session/store.js'

type Wire = Record<string, any>
type Inbox = { messages: Wire[]; binaries: number; waiters: Array<{ resolve: (value: Wire) => void; reject: (error: Error) => void }> }

const root = mkdtempSync(join(tmpdir(), 'harness-core-lifecycle-mounted-'))
const registry = join(root, 'server-registry')
const inboxes = new WeakMap<WebSocket, Inbox>()
let api: Server
let harness: ChildProcess | undefined
let wsUrl = ''
let apiPort = 0
let serverOutput = ''
let harnessEnv: NodeJS.ProcessEnv
let hangRequests = 0
let cancelledUpstream = 0

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port))
  })
}

function streamResponse(res: any, text: string, usage = { prompt_tokens: 3, completion_tokens: 2 }): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close', 'cache-control': 'no-cache' })
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage })}\n\n`)
  res.end('data: [DONE]\n\n')
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const inbox: Inbox = { messages: [], binaries: 0, waiters: [] }
    inboxes.set(socket, inbox)
    socket.on('message', value => {
      if (typeof value !== 'string' && !Buffer.isBuffer(value)) return
      const raw = String(value)
      try {
        const message = JSON.parse(raw) as Wire
        const waiter = inbox.waiters.shift()
        if (waiter) waiter.resolve(message)
        else inbox.messages.push(message)
      } catch {
        inbox.binaries++
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

function waitForHarnessReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mounted harness startup timeout: ${serverOutput.slice(-2000)}`)), 15_000)
    const ready = (chunk: Buffer) => { serverOutput += chunk.toString(); if (serverOutput.includes('Harness server on')) { clearTimeout(timer); resolve() } }
    child.stdout?.on('data', ready)
    child.stderr?.on('data', ready)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`harness exited ${code}: ${serverOutput.slice(-2000)}`)) })
  })
}

async function stopHarness(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 4_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

function spawnHarness(): ChildProcess {
  return spawn(process.execPath, ['--import', 'tsx/esm', 'src/server/index.ts'], { cwd: process.cwd(), env: harnessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
}

async function nextType(socket: WebSocket, type: string, timeoutMs = 10_000): Promise<Wire> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const message = await Promise.race([
      next(socket),
      new Promise<Wire>((_, reject) => setTimeout(() => reject(new Error(`waiting for ${type}; server output: ${serverOutput.slice(-1200)}`)), Math.max(1, deadline - Date.now()))),
    ])
    if (message.type === type) return message
    if (message.type === 'error') throw new Error(`waiting for ${type}; server error: ${JSON.stringify(message)}`)
    if (Date.now() >= deadline) throw new Error(`waiting for ${type}`)
  }
}

async function hello(socket: WebSocket, user: string, profile: string, audio = false): Promise<Wire> {
  socket.send(JSON.stringify({ type: 'hello', protocol_version: 4, user_id: user, profile, audio_supported: audio }))
  return nextType(socket, 'session_ready')
}

async function waitForRun(base: string, user: string, status: string): Promise<Wire> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const response = await fetch(`${base}/runs?user=${encodeURIComponent(user)}`)
    const body = await response.json() as { runs: Wire[] }
    const run = body.runs.find(item => item.status === status)
    if (run) return run
    if (Date.now() >= deadline) throw new Error(`run ${status} not observed`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function waitForCondition(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('condition not observed before timeout')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function markerLines(path: string, line: string): number {
  if (!existsSync(path)) return 0
  return readFileSync(path, 'utf8').split('\n').filter(value => value === line).length
}

function parseSse(text: string): Array<{ event: string; data: Wire }> {
  return text.split('\n\n').filter(Boolean).map(block => {
    const event = block.match(/^event: ([^\n]+)$/m)?.[1] ?? ''
    const data = block.match(/^data: ([^\n]+)$/m)?.[1] ?? '{}'
    return { event, data: JSON.parse(data) as Wire }
  })
}

describe('Core S5-S7 mounted lifecycle contracts', () => {
  let base = ''

  beforeAll(async () => {
    api = createServer((req, res) => {
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
        return
      }
      if (!req.url?.endsWith('/chat/completions')) { res.writeHead(404); res.end(); return }
      let body = ''
      req.on('data', chunk => { body += chunk.toString() })
      req.on('aborted', () => { cancelledUpstream++ })
      req.on('close', () => { if (!res.writableEnded && body.includes('CANCEL_MARKER')) cancelledUpstream++ })
      req.on('end', () => {
        const parsed = JSON.parse(body) as { messages?: Array<{ content?: unknown }> }
        const input = String(parsed.messages?.at(-1)?.content ?? '')
        if (input.includes('SSE_FAIL')) {
          res.writeHead(502, { 'content-type': 'text/plain' })
          res.end('fixture upstream failure')
          return
        }
        if (input.includes('CANCEL_MARKER') || input.includes('interrupt')) {
          hangRequests++
          res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: input.includes('interrupt') ? 'interrupt now.' : 'partial' } }] })}\n\n`)
          return
        }
        streamResponse(res, input.includes('restart') ? 'restarted' : 'mounted complete')
      })
    })
    apiPort = await listen(api)

    const prompt = join(root, 'prompt.md')
    writeFileSync(prompt, 'fixture prompt', 'utf8')
    const profiles = join(root, '.harness', 'profiles')
    mkdirSync(profiles, { recursive: true })
    const mcpScript = join(root, 'fixture-mcp.mjs')
    writeFileSync(mcpScript, `
      import { appendFileSync } from 'node:fs'
      const marker = process.env.MCP_MARKER
      appendFileSync(marker, 'start\\n')
      let pending = ''
      const reply = message => {
        if (message.id === undefined) return
        const result = message.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture-mcp', version: '1' } }
          : message.method === 'tools/list' ? { tools: [] } : {}
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
      }
      process.stdin.on('data', chunk => {
        pending += chunk.toString()
        for (const line of pending.split('\\n').slice(0, -1)) { try { reply(JSON.parse(line)) } catch {} }
        pending = pending.slice(pending.lastIndexOf('\\n') + 1)
      })
      const stop = () => { appendFileSync(marker, 'stop\\n'); process.exit(0) }
      process.stdin.on('end', stop)
      process.on('SIGTERM', stop)
    `, 'utf8')
    const alphaMcpMarker = join(root, 'alpha-mcp.log')
    const betaMcpMarker = join(root, 'beta-mcp.log')
    const yaml = (name: string, voice = false, marker: string) => [
      `name: ${name}`,
      'model:',
      `  base_url: http://127.0.0.1:${apiPort}/v1`,
      '  api_key_env: TEST_KEY',
      '  id: fixture-model',
      `system_prompt: ${prompt}`,
      `artifact_dir: ${join(root, 'artifacts', name)}`,
      `working_dir: ${root}`,
      ...(voice ? ['voice:', '  stt:', '    provider: fixture', '  tts:', '    provider: fixture'] : []),
      'tools:',
      '  builtin:',
      '    AskUser: allow',
      '  mcp_servers:',
      `    - name: fixture-${name}`,
      '      transport: stdio',
      `      command: ${process.execPath}`,
      '      args:',
      `        - ${mcpScript}`,
      '      env:',
      `        MCP_MARKER: ${marker}`,
      '',
    ].join('\n')
    writeFileSync(join(profiles, 'alpha.yaml'), yaml('alpha', true, alphaMcpMarker), 'utf8')
    writeFileSync(join(profiles, 'beta.yaml'), yaml('beta', false, betaMcpMarker), 'utf8')

    const voiceDir = join(root, '.agents', 'voice')
    mkdirSync(voiceDir, { recursive: true })
    writeFileSync(join(voiceDir, `fixture-${process.pid}.mjs`), `
      export default {
        name: 'fixture',
        stt: { name: 'fixture-stt', async *transcribe(stream) {
          const decoder = new TextDecoder(); let text = ''
          for await (const chunk of stream) text += decoder.decode(chunk)
          if (text) yield { text, final: true }
        }},
        tts: { name: 'fixture-tts', async *synthesize(text, opts) {
          const encoder = new TextEncoder()
          for await (const part of text) {
            yield encoder.encode(part)
            if (part.includes('interrupt')) await new Promise(resolve => opts.signal?.addEventListener('abort', () => resolve(undefined), { once: true }))
          }
        }}
      }
    `, 'utf8')

    const stalledDir = join(root, '.harness', 'runs', 'restart-user')
    mkdirSync(stalledDir, { recursive: true })
    writeFileSync(join(stalledDir, '2026-09-11_restart01.json'), JSON.stringify({
      id: 'restart01', user: 'restart-user', profile: 'alpha', trigger: 'rest', input: 'restart recovery', status: 'running',
      started_at: '2026-09-11T00:00:00.000Z', revision: 1,
    }), 'utf8')

    const portServer = createServer()
    const port = await listen(portServer)
    await new Promise<void>(resolve => portServer.close(() => resolve()))
    wsUrl = `ws://127.0.0.1:${port}`
    harnessEnv = {
      PATH: process.env.PATH ?? '', LANG: process.env.LANG ?? 'C', HOME: root,
      HARNESS_PORT: String(port), HARNESS_PROFILE: 'alpha', HARNESS_SERVER_REGISTRY_DIR: registry,
      TEST_KEY: 'fixture-key', NODE_ENV: 'test',
    }
    harness = spawnHarness()
    await waitForHarnessReady(harness)
    base = `http://127.0.0.1:${port}`
  }, 30_000)

  afterAll(async () => {
    await stopHarness(harness)
    await new Promise<void>(resolve => api?.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  })

  it('starts multiple profiles, runs selected profile, and reports bounded startup state', async () => {
    const health = await fetch(`${base}/health`)
    expect(await health.json()).toMatchObject({ status: 'ok', profile: 'alpha', profiles: ['alpha', 'beta'] })
    const response = await fetch(`${base}/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'beta', user: 'mounted-user', input: 'hello' }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as Wire
    expect(body).toMatchObject({ output: 'mounted complete', usage: { tokens_in: 3, tokens_out: 2 }, run_id: expect.any(String) })
    const run = await (await fetch(`${base}/runs/${body.run_id}?user=mounted-user`)).json() as Wire
    expect(run).toMatchObject({ id: body.run_id, profile: 'beta', user: 'mounted-user', status: 'completed', session_id: body.session_id })
  }, 30_000)

  it('isolates concurrent profile MCP processes and closes each after its run', async () => {
    const alphaMarker = join(root, 'alpha-mcp.log')
    const betaMarker = join(root, 'beta-mcp.log')
    const alphaStarts = markerLines(alphaMarker, 'start')
    const alphaStops = markerLines(alphaMarker, 'stop')
    const betaStarts = markerLines(betaMarker, 'start')
    const betaStops = markerLines(betaMarker, 'stop')
    const [alpha, beta] = await Promise.all([
      fetch(`${base}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: 'alpha', user: 'mcp-alpha', input: 'mcp alpha' }) }),
      fetch(`${base}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: 'beta', user: 'mcp-beta', input: 'mcp beta' }) }),
    ])
    expect(alpha.status).toBe(200)
    expect(beta.status).toBe(200)
    await waitForCondition(() => markerLines(alphaMarker, 'stop') >= alphaStops + 1)
    await waitForCondition(() => markerLines(betaMarker, 'stop') >= betaStops + 1)
    expect(markerLines(alphaMarker, 'start')).toBe(alphaStarts + 1)
    expect(markerLines(alphaMarker, 'stop')).toBe(alphaStops + 1)
    expect(markerLines(betaMarker, 'start')).toBe(betaStarts + 1)
    expect(markerLines(betaMarker, 'stop')).toBe(betaStops + 1)
  }, 30_000)

  it('cancels an in-flight run through scoped REST and leaves no late completion', async () => {
    const priorHangRequests = hangRequests
    const priorCancelledUpstream = cancelledUpstream
    const pending = fetch(`${base}/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'alpha', user: 'cancel-user', input: 'CANCEL_MARKER' }),
    })
    const run = await waitForRun(base, 'cancel-user', 'running')
    // Let the mounted provider request reach the fake upstream before issuing
    // the cancellation; this keeps the assertion on upstream abort meaningful.
    await new Promise(resolve => setTimeout(resolve, 250))
    expect((await fetch(`${base}/runs/${run.id}?user=other-user`)).status).toBe(404)
    expect((await fetch(`${base}/runs/${run.id}?user=cancel-user`, { method: 'DELETE' })).status).toBe(200)
    const cancelledResponse = await pending
    expect(cancelledResponse.status).toBe(500)
    await new Promise(resolve => setTimeout(resolve, 30))
    const terminal = await (await fetch(`${base}/runs/${run.id}?user=cancel-user`)).json() as Wire
    expect(terminal.status).toBe('cancelled')
    await waitForCondition(() => hangRequests > priorHangRequests)
    await waitForCondition(() => cancelledUpstream > priorCancelledUpstream)
  }, 30_000)

  it('correlates SSE lifecycle events with REST run state and persisted replay terminal', async () => {
    const response = await fetch(`${base}/stream?user=sse-user`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'alpha', user: 'sse-user', input: 'sse correlation' }),
    })
    expect(response.status).toBe(200)
    const events = parseSse(await response.text())
    const token = events.find(item => item.event === 'token')?.data
    const resultEvent = events.find(item => item.event === 'result')
    expect(resultEvent).toBeDefined()
    const result = resultEvent!.data
    expect(token?.run_id).toBe(result?.run_id)
    expect(result).toMatchObject({ output: 'mounted complete', run_id: expect.any(String), session_id: expect.any(String) })
    const run = await (await fetch(`${base}/runs/${result.run_id}?user=sse-user`)).json() as Wire
    expect(run).toMatchObject({ id: result.run_id, status: 'completed', session_id: result.session_id })
    const summaries = await (await fetch(`${base}/replay?user=sse-user`)).json() as { journals: Array<{ id: string }> }
    expect(summaries.journals.length).toBeGreaterThan(0)
    const journal = await (await fetch(`${base}/replay/${summaries.journals.at(-1)!.id}?user=sse-user`)).json() as { journal: Wire }
    const terminal = journal.journal.events.find((event: Wire) => event.name === 'session_end' && event.payload?.status === 'completed')
    expect(terminal?.payload).toMatchObject({ status: 'completed', run_id: result.run_id })
  }, 30_000)

  it('correlates an SSE failure with failed REST state and persisted terminal', async () => {
    const response = await fetch(`${base}/stream?user=sse-failure-user`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'alpha', user: 'sse-failure-user', input: 'SSE_FAIL' }),
    })
    const events = parseSse(await response.text())
    const failure = events.find(item => item.event === 'error')?.data
    expect(failure).toMatchObject({ error: expect.any(String), run_id: expect.any(String) })
    const run = await (await fetch(`${base}/runs/${failure!.run_id}?user=sse-failure-user`)).json() as Wire
    expect(run).toMatchObject({ id: failure!.run_id, status: 'failed' })
    const summaries = await (await fetch(`${base}/replay?user=sse-failure-user`)).json() as { journals: Array<{ id: string }> }
    const journal = await (await fetch(`${base}/replay/${summaries.journals.at(-1)!.id}?user=sse-failure-user`)).json() as { journal: Wire }
    const terminal = journal.journal.events.find((event: Wire) => event.name === 'session_end' && event.payload?.status === 'failed')
    expect(terminal?.payload).toMatchObject({ status: 'failed', run_id: failure!.run_id })
  }, 30_000)

  it('requeues a persisted running run during startup recovery', async () => {
    const run = await waitForRun(base, 'restart-user', 'completed')
    expect(run).toMatchObject({ id: 'restart01', profile: 'alpha', status: 'completed', session_id: expect.any(String) })
    expect(existsSync(join(registry, `${new URL(base).port}.json`))).toBe(true)
  }, 30_000)

  it('mounts fake STT/TTS and barge-in cancels the active model and playback boundary', async () => {
    const socket = await open(wsUrl)
    await hello(socket, 'voice-user', 'alpha', true)
    socket.send(JSON.stringify({ type: 'audio_start', codec: 'pcm16', sample_rate: 16_000 }))
    socket.send(Buffer.from('interrupt'))
    socket.send(JSON.stringify({ type: 'audio_end' }))
    const transcript = await nextType(socket, 'transcript_partial')
    expect(transcript).toMatchObject({ text: 'interrupt', final: true })
    expect((await nextType(socket, 'audio_out_start')).sample_rate).toBe(24_000)
    socket.send(JSON.stringify({ type: 'barge_in' }))
    expect((await nextType(socket, 'audio_out_end')).reason).toBe('interrupted')
    expect((await nextType(socket, 'session_end')).status).toBe('cancelled')
    socket.close()
  }, 30_000)

  it('rejects cross-user control/project access and routes board_post through the live session', async () => {
    const alice = await open(wsUrl)
    const aliceReady = await hello(alice, 'project-alice', 'alpha')
    alice.send(JSON.stringify({ type: 'project_create', name: 'Alpha project' }))
    const created = await nextType(alice, 'project_created')
    const bob = await open(wsUrl)
    const bobReady = await hello(bob, 'project-bob', 'beta')
    bob.send(JSON.stringify({ type: 'attach', session_id: aliceReady.sessionId, mode: 'control', request_id: 'cross-control' }))
    expect(await nextType(bob, 'error')).toMatchObject({ request_id: 'cross-control', message: 'session not found or belongs to another user' })
    bob.send(JSON.stringify({ type: 'project_assign', sessionId: bobReady.sessionId, projectId: created.project.id }))
    expect(await nextType(bob, 'error')).toMatchObject({ message: 'project not found' })
    bob.send(JSON.stringify({ type: 'board_post', subject: 'fixture', body: 'board message' }))
    expect(await nextType(bob, 'agent_message')).toMatchObject({ post: { subject: 'fixture', body_preview: 'board message', from_agent_id: 'root', tainted: false } })
    const observer = await open(wsUrl)
    await hello(observer, 'project-bob', 'beta')
    observer.send(JSON.stringify({ type: 'attach', session_id: bobReady.sessionId, mode: 'observe', request_id: 'observe-bob' }))
    await nextType(observer, 'runtime')
    observer.send(JSON.stringify({ type: 'board_post', subject: 'observer', body: 'must refuse' }))
    expect(await nextType(observer, 'error')).toMatchObject({ message: 'observer connection cannot mutate session; claim control first' })
    observer.close()
    bob.send(JSON.stringify({ type: 'agents_list' }))
    expect((await nextType(bob, 'agent_catalog')).type).toBe('agent_catalog')
    alice.close(); bob.close()
  }, 30_000)

  it('rejects REST assignment to a foreign project without mutating caller session', async () => {
    const foreign = await (await fetch(`${base}/projects?user=rest-alice`)).json() as { projects: Wire[] }
    const project = foreign.projects.find(item => item.id !== 'inbox') ?? (await (await fetch(`${base}/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'rest-alice', name: 'foreign' }),
    })).json() as Wire).project
    const previousStateDir = process.env.HARNESS_STATE_DIR
    const seeded = (() => {
      try {
        process.env.HARNESS_STATE_DIR = join(root, '.harness')
        const session = createSession('alpha', 'rest-bob')
        saveSession(session)
        return session
      } finally {
        if (previousStateDir === undefined) delete process.env.HARNESS_STATE_DIR
        else process.env.HARNESS_STATE_DIR = previousStateDir
      }
    })()
    const assignment = await fetch(`${base}/sessions/${seeded.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'rest-bob', projectId: project.id }),
    })
    expect(assignment.status).toBe(404)
    expect(await assignment.json()).toEqual({ error: 'project not found' })
    const inbox = await (await fetch(`${base}/projects/inbox/sessions?user=rest-bob`)).json() as { sessions: Wire[] }
    expect(inbox.sessions.find(item => item.id === seeded.id)).toMatchObject({ id: seeded.id, project: 'inbox' })
  }, 30_000)

  it('survives an actual process run/cancel/shutdown/restart cycle and removes owned registry state', async () => {
    const pending = fetch(`${base}/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'alpha', user: 'cycle-user', input: 'CANCEL_MARKER cycle' }),
    })
    const run = await waitForRun(base, 'cycle-user', 'running')
    expect((await fetch(`${base}/runs/${run.id}?user=cycle-user`, { method: 'DELETE' })).status).toBe(200)
    expect((await pending).status).toBe(500)
    await new Promise(resolve => setTimeout(resolve, 50))
    await stopHarness(harness)
    expect(existsSync(join(registry, `${new URL(base).port}.json`))).toBe(false)

    serverOutput = ''
    harness = spawnHarness()
    await waitForHarnessReady(harness)
    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ status: 'ok', profile: 'alpha', profiles: ['alpha', 'beta'] })
    const persisted = await (await fetch(`${base}/runs?user=cycle-user`)).json() as { runs: Wire[] }
    expect(persisted.runs.find(item => item.id === run.id)).toMatchObject({ status: 'cancelled' })
  }, 45_000)
})
