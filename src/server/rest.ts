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
import type { Skill } from '../tools/types.js'
import { createProject, listProjects, ensureInbox } from '../projects/store.js'
import { listSessionSummaries, assignSession } from '../session/store.js'
import type { ChannelRuntime } from '../channels/runtime.js'
import { PendingStore } from '../runs/pending.js'
import { isParkSignal } from '../runs/park.js'
import { resumeCancelledInput, resumePendingInput } from '../runs/resume.js'

const VERSION = '0.1.0'
const MAX_BODY_BYTES = 1 * 1024 * 1024 // 1 MB

export interface RestDeps {
  defaultProfile: Profile
  profiles?: Map<string, Profile>
  apiKey?: string
  runStore: RunStore
  abortRegistry: Map<string, AbortController>
  skills: Skill[]
  channels?: ChannelRuntime
  /** Resolve channel ownership after the request profile has been selected. */
  channelsForProfile?: (profile: Profile) => ChannelRuntime | undefined
  pendingStore?: PendingStore
}

interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  capabilities: { streaming: boolean }
  skills: Array<{ id: string; name: string; description: string }>
  authentication: { schemes: string[] }
}

function buildAgentCard(profile: Profile, skills: Skill[], host: string, proto: string): AgentCard {
  return {
    name: profile.name,
    description: profile.description ?? '',
    url: `${proto}://${host}/a2a`,
    version: VERSION,
    capabilities: { streaming: false },
    skills: skills.map(s => ({ id: s.name, name: s.name, description: s.description })),
    authentication: { schemes: ['bearer'] },
  }
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
  let total = 0
  for await (const c of req) {
    const chunk = c as Buffer
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      req.destroy()
      const err = new Error('request body too large') as any
      err.statusCode = 413
      throw err
    }
    chunks.push(chunk)
  }
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
  const registered = deps.profiles?.get(name)
  if (registered) return registered
  const path = findProfilePath(name)
  return path ? loadProfile(path) : null
}

function channelsFor(deps: RestDeps, profile: Profile | null | undefined): ChannelRuntime | undefined {
  return profile ? deps.channelsForProfile?.(profile) ?? deps.channels : deps.channels
}

function headlessEvents(): AgentLoopEvents {
  return {
    onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {},
    onToolPrompt: async () => false, onSessionEnd: () => {}, onStats: () => {},
  }
}

function pendingStore(deps: RestDeps): PendingStore {
  return deps.pendingStore ?? new PendingStore()
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
      channels: channelsFor(deps, prepared.profile),
      runId, pendingInputs: pendingStore(deps), unattended: true,
    })
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    if (isParkSignal(e)) {
      deps.runStore.update(runId, { status: 'waiting_input', session_id: e.sessionId })
      return sendJson(res, 202, { status: 'waiting_input', pending_id: e.pendingId, run_id: runId, session_id: e.sessionId })
    }
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
      channels: channelsFor(deps, prepared.profile),
      runId, pendingInputs: pendingStore(deps),
      unattended: true,
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
    if (isParkSignal(e)) {
      deps.runStore.update(runId, { status: 'waiting_input', session_id: e.sessionId })
      sse('pending', { status: 'waiting_input', pending_id: e.pendingId, run_id: runId, session_id: e.sessionId })
      return
    }
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

function handleListPending(req: IncomingMessage, res: ServerResponse, deps: RestDeps): void {
  const rawUrl = req.url ?? '/pending'
  const [, query = ''] = rawUrl.split('?')
  const params = new URLSearchParams(query)
  const store = pendingStore(deps)
  const pending = store.list({ user: params.get('user') ?? undefined, state: (params.get('state') ?? undefined) as any })
    .map(({ path: _path, ...record }) => record)
  sendJson(res, 200, { pending })
}

async function handleAnswerPending(req: IncomingMessage, res: ServerResponse, deps: RestDeps, runId: string): Promise<void> {
  let body: { pending_id?: string; value?: string }
  try { body = JSON.parse(await readBody(req)) } catch { return sendJson(res, 400, { error: 'malformed JSON body' }) }
  if (!body.pending_id || typeof body.value !== 'string') return sendJson(res, 400, { error: 'pending_id and value required' })
  const store = pendingStore(deps)
  const pending = store.get(body.pending_id)
  if (!pending || pending.run_id !== runId) return sendJson(res, 404, { error: 'pending input not found' })
  const result = await resumePendingInput(body.pending_id, body.value, 'rest', {
    pendingStore: store,
    runStore: deps.runStore,
    abortRegistry: deps.abortRegistry,
    resolveProfile: name => resolveProfile(name, deps),
    channels: channelsFor(deps, resolveProfile(deps.runStore.get(pending.run_id)?.profile, deps)),
  })
  if (result.status === 'ignored') return sendJson(res, 409, { error: result.reason })
  if (result.status === 'failed') return sendJson(res, 500, result)
  return sendJson(res, result.status === 'completed' ? 200 : 202, result)
}

async function handleCancelPending(req: IncomingMessage, res: ServerResponse, deps: RestDeps, pendingId: string): Promise<void> {
  const store = pendingStore(deps)
  const pending = store.get(pendingId)
  if (!pending) return sendJson(res, 404, { error: 'pending input not found' })
  if (pending.state !== 'open') return sendJson(res, 409, { error: `pending input is already ${pending.state}` })
  const run = deps.runStore.get(pending.run_id)
  if (!run || run.status !== 'waiting_input') return sendJson(res, 409, { error: 'run is not waiting for input' })
  const cancelled = store.cancel(pendingId)
  if (!cancelled) return sendJson(res, 409, { error: 'pending input could not be cancelled' })
  const result = await resumeCancelledInput(pendingId, {
    pendingStore: store,
    runStore: deps.runStore,
    abortRegistry: deps.abortRegistry,
    resolveProfile: name => resolveProfile(name, deps),
    channels: channelsFor(deps, resolveProfile(deps.runStore.get(pending.run_id)?.profile, deps)),
  })
  if (result.status === 'ignored') return sendJson(res, 409, { error: result.reason })
  return sendJson(res, result.status === 'failed' ? 500 : result.status === 'completed' ? 200 : 202, result)
}

function handleGetRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps, id: string): void {
  const run = deps.runStore.get(id)
  if (!run) return sendJson(res, 404, { error: 'run not found' })
  sendJson(res, 200, run)
}

function handleDeleteRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps, id: string): void {
  const run = deps.runStore.get(id)
  if (!run) return sendJson(res, 404, { error: 'run not found' })
  if (run.status !== 'running' && run.status !== 'pending' && run.status !== 'waiting_input') return sendJson(res, 409, { error: `run is already ${run.status}` })
  deps.abortRegistry.get(id)?.abort()
  if (run.status === 'waiting_input') {
    for (const pending of pendingStore(deps).list({ user: run.user, state: 'open' }).filter(item => item.run_id === id)) {
      pendingStore(deps).cancel(pending.id)
    }
  }
  deps.runStore.update(id, { status: 'cancelled', finished_at: new Date().toISOString() })
  sendJson(res, 200, { ok: true })
}

function queryUser(req: IncomingMessage): string | null {
  const raw = (req.url ?? '').split('?')[1] ?? ''
  const u = new URLSearchParams(raw).get('user')
  return u ? sanitizeUserId(u) : null
}

function handleListProjects(req: IncomingMessage, res: ServerResponse): void {
  const user = queryUser(req)
  if (!user) return sendJson(res, 400, { error: 'missing user' })
  ensureInbox(user)
  sendJson(res, 200, { projects: listProjects(user) })
}

async function handleCreateProject(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { user?: string; name?: string; description?: string }
  try { body = JSON.parse(await readBody(req)) } catch { return sendJson(res, 400, { error: 'malformed JSON body' }) }
  const user = body.user ? sanitizeUserId(body.user) : null
  if (!user) return sendJson(res, 400, { error: 'missing user' })
  if (!body.name) return sendJson(res, 400, { error: 'missing name' })
  sendJson(res, 201, { project: createProject(user, body.name, body.description) })
}

function handleProjectSessions(req: IncomingMessage, res: ServerResponse, projectId: string): void {
  const user = queryUser(req)
  if (!user) return sendJson(res, 400, { error: 'missing user' })
  sendJson(res, 200, { sessions: listSessionSummaries(user, projectId) })
}

async function handleAssignSession(req: IncomingMessage, res: ServerResponse, sessionId: string): Promise<void> {
  let body: { user?: string; projectId?: string }
  try { body = JSON.parse(await readBody(req)) } catch { return sendJson(res, 400, { error: 'malformed JSON body' }) }
  const user = body.user ? sanitizeUserId(body.user) : null
  if (!user) return sendJson(res, 400, { error: 'missing user' })
  if (!body.projectId) return sendJson(res, 400, { error: 'missing projectId' })
  assignSession(user, sessionId, body.projectId)
  sendJson(res, 200, { sessions: listSessionSummaries(user) })
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
      profile, userId, userMessage: inputCheck.userMessage, events: headlessEvents(), signal: abort.signal, channels: channelsFor(deps, profile),
      runId, pendingInputs: pendingStore(deps), unattended: true,
    })
    deps.abortRegistry.delete(runId)
    deps.runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
    const out = processOutput(result.finalText, compiled)
    if (!out.ok) return sendJson(res, 422, { error: out.error, kind: out.kind })
    return sendJson(res, 200, { output: out.output, usage: result.usage, session_id: result.session.id, run_id: runId })
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    if (isParkSignal(e)) {
      deps.runStore.update(runId, { status: 'waiting_input', session_id: e.sessionId })
      return sendJson(res, 202, { status: 'waiting_input', pending_id: e.pendingId, run_id: runId, session_id: e.sessionId })
    }
    const existing = deps.runStore.get(runId)
    if (existing?.status === 'running') {
      deps.runStore.update(runId, { status: 'failed', error: e.message, finished_at: new Date().toISOString() })
    }
    return sendJson(res, 500, { error: e.message })
  }
}

async function handleAcpCreateRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps, agentId: string): Promise<void> {
  if (!deps.defaultProfile.interop?.acp) return sendJson(res, 404, { error: 'ACP not enabled' })
  if (agentId !== deps.defaultProfile.name) return sendJson(res, 404, { error: `agent '${agentId}' not found` })

  let body: { input?: Array<{ type: string; text?: string }> }
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return sendJson(res, 400, { error: 'malformed JSON body' })
  }

  const input = body.input ?? []
  const userMessage = input.filter(i => i.type === 'text').map(i => i.text ?? '').join('\n')
  if (!userMessage) return sendJson(res, 400, { error: 'no text input items' })

  const runId = makeRunId()
  const userId = sanitizeUserId(process.env.HARNESS_USER ?? 'anonymous')
  deps.runStore.create({
    id: runId,
    profile: deps.defaultProfile.name,
    user: userId,
    trigger: 'acp',
    input: userMessage,
    status: 'pending',
    started_at: new Date().toISOString(),
  })

  sendJson(res, 201, { run: { id: runId, agent_id: deps.defaultProfile.name, status: 'created' } })
}

async function handleAcpMessages(
  req: IncomingMessage, res: ServerResponse, deps: RestDeps,
  runId: string, acpInFlight: Set<string>,
): Promise<void> {
  if (!deps.defaultProfile.interop?.acp) return sendJson(res, 404, { error: 'ACP not enabled' })

  if (acpInFlight.has(runId)) return sendJson(res, 409, { error: 'run is already being claimed' })
  acpInFlight.add(runId)

  const run = deps.runStore.get(runId)
  if (!run || run.trigger !== 'acp') { acpInFlight.delete(runId); return sendJson(res, 404, { error: 'run not found' }) }
  if (run.status !== 'pending') { acpInFlight.delete(runId); return sendJson(res, 409, { error: `run is already ${run.status}` }) }

  deps.runStore.update(runId, { status: 'running' })
  acpInFlight.delete(runId)

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const abort = new AbortController()
  req.on('close', () => abort.abort())
  deps.abortRegistry.set(runId, abort)

  const events: AgentLoopEvents = {
    onToken: t => sse('message', { type: 'token', content: t }),
    onToolStart: (n, i) => sse('message', { type: 'tool_start', name: n, input: i }),
    onToolEnd: (n, r) => sse('message', { type: 'tool_end', name: n, result: r }),
    onToolPrompt: async () => false,
    onSessionEnd: () => {},
    onStats: () => {},
  }

  try {
    const result = await runProfileOnce({
      profile: deps.defaultProfile,
      userId: run.user,
      userMessage: run.input as string,
      events,
      signal: abort.signal,
      channels: channelsFor(deps, deps.defaultProfile),
      runId, pendingInputs: pendingStore(deps), unattended: true,
    })
    deps.abortRegistry.delete(runId)
    deps.runStore.update(runId, {
      status: 'completed',
      session_id: result.session.id,
      finished_at: new Date().toISOString(),
    })
    sse('done', { type: 'done', output: result.finalText, session_id: result.session.id, run_id: runId })
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
    if ((e as Error).name !== 'AbortError') sse('error', { message: e.message })
  } finally {
    res.end()
  }
}

function handleAcpAgents(req: IncomingMessage, res: ServerResponse, deps: RestDeps): void {
  if (!deps.defaultProfile.interop?.acp) return sendJson(res, 404, { error: 'ACP not enabled' })
  sendJson(res, 200, {
    agents: [{
      agent_id: deps.defaultProfile.name,
      name: deps.defaultProfile.name,
      description: deps.defaultProfile.description ?? '',
    }],
  })
}

function handleAgentCard(req: IncomingMessage, res: ServerResponse, deps: RestDeps): void {
  if (!deps.defaultProfile.interop?.a2a) return sendJson(res, 404, { error: 'A2A not enabled' })
  const host = req.headers.host ?? 'localhost'
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)
    ?? ((req.socket as any)?.encrypted ? 'https' : 'http')
  sendJson(res, 200, buildAgentCard(deps.defaultProfile, deps.skills, host, proto))
}

async function handleA2ATask(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  if (!deps.defaultProfile.interop?.a2a) return sendJson(res, 404, { error: 'A2A not enabled' })

  let body: { id?: string; message?: { parts?: Array<{ type: string; text?: string }> } }
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return sendJson(res, 400, { error: 'malformed JSON body' })
  }

  const taskId = body.id ?? makeRunId()
  const parts = body.message?.parts ?? []
  const userMessage = parts
    .filter(p => p.type === 'text')
    .map(p => p.text ?? '')
    .join('\n')

  if (!userMessage) return sendJson(res, 400, { error: 'no text parts in message' })

  const userId = sanitizeUserId(process.env.HARNESS_USER ?? 'anonymous')
  const runId = makeRunId()
  const abort = new AbortController()
  deps.abortRegistry.set(runId, abort)
  deps.runStore.create({
    id: runId,
    profile: deps.defaultProfile.name,
    user: userId,
    trigger: 'a2a',
    input: userMessage,
    status: 'running',
    started_at: new Date().toISOString(),
  })

  try {
    const result = await runProfileOnce({
      profile: deps.defaultProfile,
      userId,
      userMessage,
      events: headlessEvents(),
      signal: abort.signal,
      channels: channelsFor(deps, deps.defaultProfile),
      runId, pendingInputs: pendingStore(deps), unattended: true,
    })
    deps.abortRegistry.delete(runId)
    deps.runStore.update(runId, {
      status: 'completed',
      session_id: result.session.id,
      finished_at: new Date().toISOString(),
    })
    sendJson(res, 200, {
      id: taskId,
      status: { state: 'completed' },
      artifacts: [{ parts: [{ type: 'text', text: result.finalText }] }],
    })
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    const existing = deps.runStore.get(runId)
    if (existing?.status === 'running') {
      if (isParkSignal(e)) {
        deps.runStore.update(runId, { status: 'waiting_input', session_id: e.sessionId })
        return sendJson(res, 202, { id: taskId, status: { state: 'waiting_input' }, run_id: runId, pending_id: e.pendingId })
      }
      deps.runStore.update(runId, {
        status: 'failed',
        error: e.message,
        finished_at: new Date().toISOString(),
      })
    }
    sendJson(res, 200, {
      id: taskId,
      status: { state: 'failed', error: { message: e.message } },
    })
  }
}

export function createRestHandler(deps: RestDeps) {
  const acpInFlight = new Set<string>()

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? '/').split('?')[0]
    const method = req.method ?? 'GET'

    try {
      if (method === 'POST' && url.startsWith('/channels/')) {
        const channel = url.slice('/channels/'.length, -'/inbound'.length)
        if (url.endsWith('/inbound') && deps.channels && await deps.channels.handleHttp(channel, req, res)) return
      }
      if (method === 'GET' && url === '/health') {
        return sendJson(res, 200, { status: 'ok', profile: deps.defaultProfile.name, profiles: deps.profiles ? [...deps.profiles.keys()].sort() : [deps.defaultProfile.name], version: VERSION })
      }

      if (deps.apiKey && req.headers['authorization'] !== `Bearer ${deps.apiKey}`) {
        return sendJson(res, 401, { error: 'unauthorized' })
      }

      if (method === 'GET' && url === '/agents') return handleAcpAgents(req, res, deps)

      if (method === 'POST' && url.startsWith('/agents/') && url.endsWith('/runs')) {
        return handleAcpCreateRun(req, res, deps, url.slice('/agents/'.length, -'/runs'.length))
      }

      if (method === 'GET' && url === '/.well-known/agent.json') return handleAgentCard(req, res, deps)

      if (method === 'POST' && url === '/a2a') return handleA2ATask(req, res, deps)

      if (method === 'POST' && url === '/run') return handleRun(req, res, deps)
      if (method === 'POST' && url === '/stream') return handleStream(req, res, deps)

      if (method === 'GET' && url === '/runs') return handleListRuns(req, res, deps)
      if (method === 'GET' && url === '/pending') return handleListPending(req, res, deps)
      if (method === 'POST' && url.startsWith('/runs/') && url.endsWith('/input')) {
        return handleAnswerPending(req, res, deps, url.slice('/runs/'.length, -'/input'.length))
      }
      if (method === 'DELETE' && url.startsWith('/pending/')) {
        return handleCancelPending(req, res, deps, url.slice('/pending/'.length))
      }
      if (method === 'GET' && url.startsWith('/runs/') && url.endsWith('/messages')) {
        return handleAcpMessages(req, res, deps, url.slice('/runs/'.length, -'/messages'.length), acpInFlight)
      }
      if (method === 'GET' && url.startsWith('/runs/') && !url.includes('/webhooks')) {
        return handleGetRun(req, res, deps, url.slice('/runs/'.length))
      }
      if (method === 'DELETE' && url.startsWith('/runs/')) {
        return handleDeleteRun(req, res, deps, url.slice('/runs/'.length))
      }

      if (method === 'POST' && url.startsWith('/webhooks/')) {
        return handleWebhook(req, res, deps, url.slice('/webhooks/'.length))
      }

      if (method === 'GET' && url === '/projects') return handleListProjects(req, res)
      if (method === 'POST' && url === '/projects') return handleCreateProject(req, res)
      if (method === 'GET' && url.startsWith('/projects/') && url.endsWith('/sessions')) {
        return handleProjectSessions(req, res, url.slice('/projects/'.length, -'/sessions'.length))
      }
      if (method === 'PATCH' && url.startsWith('/sessions/')) {
        return handleAssignSession(req, res, url.slice('/sessions/'.length))
      }

      return sendJson(res, 404, { error: 'not found' })
    } catch (e: any) {
      if (e?.statusCode === 413) return sendJson(res, 413, { error: 'request body too large' })
      throw e
    }
  }
}
