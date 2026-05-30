import type { IncomingMessage, ServerResponse } from 'http'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { loadProfile } from '../profiles/loader.js'
import { sanitizeUserId } from '../session/user-paths.js'
import { runProfileOnce } from './run-profile.js'
import { compileContract, validateAndBuildInput, processOutput } from './contract.js'
import type { Profile } from '../profiles/schema.js'
import type { AgentLoopEvents } from '../tools/types.js'
import { randomUUID } from 'crypto'
import type { RunStore } from '../runs/store.js'
import type { Run } from '../runs/types.js'

const VERSION = '0.1.0'

export interface RestDeps {
  defaultProfile: Profile
  apiKey?: string
  runStore: RunStore
  abortRegistry: Map<string, AbortController>
}

function makeRunId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

export function findProfilePath(name: string): string | null {
  const candidates = [
    resolve(process.cwd(), 'profiles', `${name}.yaml`),
    resolve(homedir(), '.harness', 'profiles', `${name}.yaml`),
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

function resolveProfile(name: string | undefined, deps: RestDeps): Profile | null {
  if (!name) return deps.defaultProfile
  const path = findProfilePath(name)
  return path ? loadProfile(path) : null
}

function headlessEvents(): AgentLoopEvents {
  return {
    onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {},
    onToolPrompt: async () => false, onSessionEnd: () => {}, onStats: () => {},
  }
}

interface RunRequest { profile?: string; user?: string; input?: unknown }

/**
 * Parse + validate the request shared by /run and /stream.
 * Returns either a ready-to-run payload, or an error with a status code.
 */
function prepareRun(bodyText: string, deps: RestDeps):
  | { ok: true; profile: Profile; userId: string; userMessage: string; compiled: ReturnType<typeof compileContract> }
  | { ok: false; status: number; body: unknown } {
  let body: RunRequest
  try {
    body = JSON.parse(bodyText)
  } catch {
    return { ok: false, status: 400, body: { error: 'malformed JSON body' } }
  }
  if (body.input === undefined) {
    return { ok: false, status: 400, body: { error: 'missing input' } }
  }
  const profile = resolveProfile(body.profile, deps)
  if (!profile) {
    return { ok: false, status: 404, body: { error: `profile "${body.profile}" not found` } }
  }
  const compiled = compileContract(profile)
  const inputCheck = validateAndBuildInput(body.input, compiled)
  if (!inputCheck.ok) {
    const status = inputCheck.details ? 422 : 400
    return { ok: false, status, body: { error: inputCheck.error, details: inputCheck.details } }
  }
  const userId = sanitizeUserId(body.user ?? process.env.HARNESS_USER ?? 'anonymous')
  return { ok: true, profile, userId, userMessage: inputCheck.userMessage, compiled }
}

async function handleRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  const prepared = prepareRun(await readBody(req), deps)
  if (!prepared.ok) return sendJson(res, prepared.status, prepared.body)

  const runId = makeRunId()
  const abort = new AbortController()
  deps.abortRegistry.set(runId, abort)
  deps.runStore.create({
    id: runId, profile: prepared.profile.name, user: prepared.userId,
    trigger: 'rest', input: prepared.userMessage, status: 'running',
    started_at: new Date().toISOString(),
  })

  let result
  try {
    result = await runProfileOnce({
      profile: prepared.profile, userId: prepared.userId,
      userMessage: prepared.userMessage, events: headlessEvents(),
      signal: abort.signal,
    })
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    const existing = deps.runStore.get(runId)
    if (existing?.status === 'running') {
      deps.runStore.update(runId, { status: 'failed', error: e.message, finished_at: new Date().toISOString() })
    }
    return sendJson(res, 500, { error: e.message })
  }

  deps.abortRegistry.delete(runId)
  deps.runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
  const out = processOutput(result.finalText, prepared.compiled)
  if (!out.ok) return sendJson(res, 422, { error: out.error, kind: out.kind })
  return sendJson(res, 200, { output: out.output, usage: result.usage, session_id: result.session.id, run_id: runId })
}

async function handleStream(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  const prepared = prepareRun(await readBody(req), deps)
  if (!prepared.ok) return sendJson(res, prepared.status, prepared.body)

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const runId = makeRunId()
  const abort = new AbortController()
  req.on('close', () => abort.abort())
  deps.abortRegistry.set(runId, abort)
  deps.runStore.create({
    id: runId, profile: prepared.profile.name, user: prepared.userId,
    trigger: 'stream', input: prepared.userMessage, status: 'running',
    started_at: new Date().toISOString(),
  })

  const events: AgentLoopEvents = {
    onToken: t => sse('token', { content: t }),
    onToolStart: (n, i) => sse('tool_start', { name: n, input: i }),
    onToolEnd: (n, r) => sse('tool_end', { name: n, result: r }),
    onToolPrompt: async () => false,
    onSessionEnd: () => {},
    onStats: (tokens_in, tokens_out, cost_usd) => sse('stats', { tokens_in, tokens_out, cost_usd }),
  }

  try {
    const result = await runProfileOnce({
      profile: prepared.profile, userId: prepared.userId,
      userMessage: prepared.userMessage, events, signal: abort.signal,
    })
    deps.abortRegistry.delete(runId)
    deps.runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
    const out = processOutput(result.finalText, prepared.compiled)
    if (!out.ok) {
      sse('error', { error: out.error })
    } else {
      sse('result', { output: out.output, usage: result.usage, session_id: result.session.id, run_id: runId })
    }
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    const existing = deps.runStore.get(runId)
    if (existing?.status === 'running') {
      const isCancelled = (e as Error).name === 'AbortError'
      deps.runStore.update(runId, {
        status: isCancelled ? 'cancelled' : 'failed',
        error: isCancelled ? undefined : e.message,
        finished_at: new Date().toISOString(),
      })
    }
    if ((e as Error).name !== 'AbortError') sse('error', { error: e.message })
  } finally {
    res.end()
  }
}

function handleListRuns(req: IncomingMessage, res: ServerResponse, deps: RestDeps): void {
  const rawUrl = req.url ?? '/runs'
  const [, query = ''] = rawUrl.split('?')
  const params = new URLSearchParams(query)
  const runs = deps.runStore.list({
    user: params.get('user') ?? undefined,
    status: (params.get('status') ?? undefined) as Run['status'] | undefined,
    profile: params.get('profile') ?? undefined,
    limit: params.has('limit') ? parseInt(params.get('limit')!) : 50,
  })
  sendJson(res, 200, { runs })
}

function handleGetRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps, id: string): void {
  const run = deps.runStore.get(id)
  if (!run) return sendJson(res, 404, { error: 'run not found' })
  sendJson(res, 200, run)
}

function handleDeleteRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps, id: string): void {
  const run = deps.runStore.get(id)
  if (!run) return sendJson(res, 404, { error: 'run not found' })
  if (run.status !== 'running') return sendJson(res, 409, { error: `run is already ${run.status}` })
  deps.abortRegistry.get(id)?.abort()
  deps.runStore.update(id, { status: 'cancelled', finished_at: new Date().toISOString() })
  sendJson(res, 200, { ok: true })
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse, deps: RestDeps, profileName: string): Promise<void> {
  const profilePath = findProfilePath(profileName)
  let profile: Profile | null = null
  try {
    profile = profilePath ? loadProfile(profilePath) : (deps.defaultProfile.name === profileName ? deps.defaultProfile : null)
  } catch (e) {
    // falls through to 404
  }

  if (!profile || profile.triggers?.webhook !== true) {
    return sendJson(res, 404, { error: `webhook not found: ${profileName}` })
  }

  const bodyText = await readBody(req)
  let body: { input?: unknown; user?: string }
  try { body = JSON.parse(bodyText) } catch { return sendJson(res, 400, { error: 'malformed JSON body' }) }
  if (body.input === undefined) return sendJson(res, 400, { error: 'missing input' })

  const compiled = compileContract(profile)
  const inputCheck = validateAndBuildInput(body.input, compiled)
  if (!inputCheck.ok) {
    const status = inputCheck.details ? 422 : 400
    return sendJson(res, status, { error: inputCheck.error, details: inputCheck.details })
  }

  const userId = sanitizeUserId(body.user ?? process.env.HARNESS_USER ?? 'anonymous')
  const runId = makeRunId()
  const abort = new AbortController()
  deps.abortRegistry.set(runId, abort)
  deps.runStore.create({
    id: runId, profile: profile.name, user: userId,
    trigger: 'webhook', input: inputCheck.userMessage, status: 'running',
    started_at: new Date().toISOString(),
  })

  try {
    const result = await runProfileOnce({
      profile, userId, userMessage: inputCheck.userMessage, events: headlessEvents(), signal: abort.signal,
    })
    deps.abortRegistry.delete(runId)
    deps.runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
    const out = processOutput(result.finalText, compiled)
    if (!out.ok) return sendJson(res, 422, { error: out.error, kind: out.kind })
    return sendJson(res, 200, { output: out.output, usage: result.usage, session_id: result.session.id, run_id: runId })
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    const existing = deps.runStore.get(runId)
    if (existing?.status === 'running') {
      deps.runStore.update(runId, { status: 'failed', error: e.message, finished_at: new Date().toISOString() })
    }
    return sendJson(res, 500, { error: e.message })
  }
}

export function createRestHandler(deps: RestDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? '/').split('?')[0]
    const method = req.method ?? 'GET'

    if (method === 'GET' && url === '/health') {
      return sendJson(res, 200, { status: 'ok', profile: deps.defaultProfile.name, version: VERSION })
    }

    if (deps.apiKey && req.headers['authorization'] !== `Bearer ${deps.apiKey}`) {
      return sendJson(res, 401, { error: 'unauthorized' })
    }

    if (method === 'POST' && url === '/run') return handleRun(req, res, deps)
    if (method === 'POST' && url === '/stream') return handleStream(req, res, deps)

    if (method === 'GET' && url === '/runs') return handleListRuns(req, res, deps)
    if (method === 'GET' && url.startsWith('/runs/') && !url.includes('/webhooks')) {
      return handleGetRun(req, res, deps, url.slice('/runs/'.length))
    }
    if (method === 'DELETE' && url.startsWith('/runs/')) {
      return handleDeleteRun(req, res, deps, url.slice('/runs/'.length))
    }

    if (method === 'POST' && url.startsWith('/webhooks/')) {
      return handleWebhook(req, res, deps, url.slice('/webhooks/'.length))
    }

    return sendJson(res, 404, { error: 'not found' })
  }
}
