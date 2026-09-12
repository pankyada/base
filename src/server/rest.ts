import type { IncomingMessage, ServerResponse } from 'http'
import { existsSync } from 'fs'
import { join } from 'path'
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
import { createProject, getProject, listProjects, ensureInbox } from '../projects/store.js'
import { listSessionSummaries, assignSession } from '../session/store.js'
import type { ChannelRuntime } from '../channels/runtime.js'
import { PendingStore } from '../runs/pending.js'
import { isParkSignal } from '../runs/park.js'
import { RunBudget } from '../runs/budget.js'
import { resumeCancelledInput, resumePendingInput } from '../runs/resume.js'
import { checkOrigin, loadOriginPolicy, type OriginPolicy } from './origin.js'
import { createReadApiHandler, type ReadApiDeps } from './read-api.js'
import { MissionStore, completeHumanCriterion, createMission, type MissionInput } from '../missions/index.js'
import { handleReplayRequest } from '../replay/router.js'
import { handleEvaluationRequest, handleEvaluationExecutionRequest } from '../evaluation/router.js'
import { deterministicAssertion, EvaluationStore, runEvaluation } from '../evaluation/index.js'
import { applyEvaluation, CorrectionStore, promoteCorrection, proposeCorrection, rollbackCorrection } from '../improver/corrections.js'
import { readJson } from '../shared/atomic-json.js'
import { userPaths } from '../session/user-paths.js'
import { ArtifactStore, createFileDependencyResolver, promoteArtifact, type ArtifactExecutionRequest } from '../artifacts/index.js'
import { ReplayStore } from '../replay/store.js'
import { hashArguments, markCheckpoint, newJournal, recordEffect, recordEvent, type EffectReceipt, type RunJournal } from '../replay/index.js'
import { detectConflicts, MemoryConflictStore, resolveConflict } from '../memory/conflicts.js'
import { resolveAclDecision } from '../tools/acl.js'
import { assertMatchingScopes, normalizeUserScope, ScopeError } from './scope.js'
import pkg from '../../package.json' with { type: 'json' }

const VERSION = pkg.version
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
  originPolicy?: OriginPolicy
  readApi?: Partial<Omit<ReadApiDeps, 'defaultProfile' | 'profiles'>>
  /** Generator executor built from registered tools and normal ACL/provenance gates. */
  artifactGenerator?: (request: ArtifactExecutionRequest, context: { user: string; profile: Profile; budget?: RunBudget; signal?: AbortSignal; confirmed: boolean }) => Promise<{ payload: unknown }>
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
    resolve(homedir(), '.harness', 'profiles', `${name}.yaml`),
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

function resolveProfile(name: string | undefined, deps: RestDeps): Profile | null {
  if (!name || name === deps.defaultProfile.name) return deps.defaultProfile
  const registered = deps.profiles?.get(name)
  if (registered) return registered
  const path = findProfilePath(name)
  return path ? loadProfile(path) : null
}

function channelsFor(deps: RestDeps, profile: Profile | null | undefined): ChannelRuntime | undefined {
  return profile ? deps.channelsForProfile?.(profile) ?? deps.channels : deps.channels
}

interface ReplayCapture {
  journal: RunJournal
  store: ReplayStore
  effects: Map<string, EffectReceipt>
  persist(sessionId?: string, status?: string): void
}

function createReplayCapture(user: string, profile: Profile, runId: string, input: string): ReplayCapture {
  const journal = newJournal({
    user,
    session_id: runId,
    profile: profile.name,
    config_fingerprint: hashArguments({ profile: profile.name, model: profile.model, input }),
    mode: 'live-branch',
  })
  const store = new ReplayStore(user)
  const effects = new Map<string, EffectReceipt>()
  const persist = (sessionId?: string, status?: string): void => {
    if (sessionId) journal.session_id = sessionId
    if (status) recordEvent(journal, 'result', { status, run_id: runId }, 'session_end')
    try { store.save(journal) } catch (error: any) { console.warn(`[replay] REST journal save failed: ${error.message}`) }
  }
  recordEvent(journal, 'result', { input }, 'turn_start')
  markCheckpoint(journal, 'turn_start')
  persist()
  return { journal, store, effects, persist }
}

function headlessEvents(capture?: ReplayCapture): AgentLoopEvents {
  return {
    onToken: token => { if (capture) { recordEvent(capture.journal, 'token', token); capture.persist() } },
    onToolStart: (id, name, input) => {
      if (!capture) return
      recordEvent(capture.journal, 'tool_start', input, name)
      capture.effects.set(id, recordEffect(capture.journal, { tool: name, argument_hash: hashArguments(input), state: 'started' }))
      capture.persist()
    },
    onToolEnd: (id, name, result, ok) => {
      if (!capture) return
      recordEvent(capture.journal, 'tool_end', { result, ok }, name)
      const effect = capture.effects.get(id)
      if (effect) { effect.state = ok ? 'completed' : 'failed'; effect.completed_at = new Date().toISOString(); effect.result_hash = hashArguments(result) }
      capture.persist()
    },
    onEvidence: (id, name, _input, result, ok, provenance, source) => {
      if (!capture) return
      recordEvent(capture.journal, 'result', { tool_call_id: id, ok, provenance, source, result }, name)
      capture.persist()
    },
    onToolPrompt: async () => false,
    onSessionEnd: sessionId => capture?.persist(sessionId),
    onStats: () => {},
  }
}

function pendingStore(deps: RestDeps): PendingStore {
  return deps.pendingStore ?? new PendingStore()
}

interface RunRequest { profile?: string; user?: unknown; input?: unknown }

/**
 * Parse + validate the request shared by /run and /stream.
 * Returns either a ready-to-run payload, or an error with a status code.
 */
function prepareRun(bodyText: string, deps: RestDeps, queryUser?: unknown):
  | { ok: true; profile: Profile; userId: string; userMessage: string; compiled: ReturnType<typeof compileContract> }
  | { ok: false; status: number; body: unknown } {
  let body: RunRequest
  try {
    body = JSON.parse(bodyText)
  } catch {
    return { ok: false, status: 400, body: { error: 'malformed JSON body' } }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, body: { error: 'request must be an object' } }
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
  let userId: string
  try {
    const asserted = assertMatchingScopes(queryUser, body.user)
    userId = normalizeUserScope(asserted, process.env.HARNESS_USER ?? 'anonymous')
  } catch (error) {
    return { ok: false, status: (error as ScopeError).status, body: { error: (error as Error).message } }
  }
  return { ok: true, profile, userId, userMessage: inputCheck.userMessage, compiled }
}

async function handleRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  const prepared = prepareRun(await readBody(req), deps, requestQueryUser(req))
  if (!prepared.ok) return sendJson(res, prepared.status, prepared.body)

  const runId = makeRunId()
  const capture = createReplayCapture(prepared.userId, prepared.profile, runId, prepared.userMessage)
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
      userMessage: prepared.userMessage, events: headlessEvents(capture),
      signal: abort.signal,
      channels: channelsFor(deps, prepared.profile),
      runId, pendingInputs: pendingStore(deps), unattended: true,
    })
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    if (isParkSignal(e)) {
      deps.runStore.update(runId, { status: 'waiting_input', session_id: e.sessionId })
      capture.persist(e.sessionId, 'waiting_input')
      return sendJson(res, 202, { status: 'waiting_input', pending_id: e.pendingId, run_id: runId, session_id: e.sessionId })
    }
    const existing = deps.runStore.get(runId)
    if (existing?.status === 'running') {
      deps.runStore.update(runId, { status: 'failed', error: e.message, finished_at: new Date().toISOString() })
    }
    capture.persist(undefined, 'failed')
    return sendJson(res, 500, { error: e.message })
  }

  deps.abortRegistry.delete(runId)
  deps.runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
  capture.persist(result.session.id, 'completed')
  const out = processOutput(result.finalText, prepared.compiled)
  if (!out.ok) return sendJson(res, 422, { error: out.error, kind: out.kind })
  return sendJson(res, 200, { output: out.output, usage: result.usage, session_id: result.session.id, run_id: runId })
}

async function handleStream(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  const prepared = prepareRun(await readBody(req), deps, requestQueryUser(req))
  if (!prepared.ok) return sendJson(res, prepared.status, prepared.body)

  const runId = makeRunId()
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  const capture = createReplayCapture(prepared.userId, prepared.profile, runId, prepared.userMessage)
  const abort = new AbortController()
  req.on('close', () => abort.abort())
  deps.abortRegistry.set(runId, abort)
  deps.runStore.create({
    id: runId, profile: prepared.profile.name, user: prepared.userId,
    trigger: 'stream', input: prepared.userMessage, status: 'running',
    started_at: new Date().toISOString(),
  })

  const replayEvents = headlessEvents(capture)
  const events: AgentLoopEvents = {
    onToken: t => { replayEvents.onToken(t); sse('token', { content: t, run_id: runId }) },
    // A prompted tool may be immediately denied below; tool_start marks its lifecycle, not execution.
    onToolStart: (id, n, i) => { replayEvents.onToolStart(id, n, i); sse('tool_start', { id, name: n, input: i, run_id: runId }) },
    onToolEnd: (id, n, r, ok) => { replayEvents.onToolEnd(id, n, r, ok); sse('tool_end', { id, name: n, result: r, ok, run_id: runId }) },
    onEvidence: replayEvents.onEvidence,
    onToolPrompt: async () => false,
    onSessionEnd: replayEvents.onSessionEnd,
    onStats: (tokens_in, tokens_out, cost_usd) => sse('stats', { tokens_in, tokens_out, cost_usd, run_id: runId }),
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
    capture.persist(result.session.id, 'completed')
    const out = processOutput(result.finalText, prepared.compiled)
    if (!out.ok) {
      sse('error', { error: out.error, run_id: runId })
    } else {
      sse('result', { output: out.output, usage: result.usage, session_id: result.session.id, run_id: runId })
    }
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    if (isParkSignal(e)) {
      deps.runStore.update(runId, { status: 'waiting_input', session_id: e.sessionId })
      capture.persist(e.sessionId, 'waiting_input')
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
    capture.persist(undefined, (e as Error).name === 'AbortError' ? 'cancelled' : 'failed')
    if ((e as Error).name !== 'AbortError') sse('error', { error: e.message, run_id: runId })
  } finally {
    res.end()
  }
}

function handleListRuns(req: IncomingMessage, res: ServerResponse, deps: RestDeps): void {
  const rawUrl = req.url ?? '/runs'
  const [, query = ''] = rawUrl.split('?')
  const params = new URLSearchParams(query)
  if (params.has('user') && !params.get('user')) return sendJson(res, 400, { error: 'user scope must not be empty' })
  const options = {
    user: params.get('user') ?? undefined,
    status: (params.get('status') ?? undefined) as Run['status'] | undefined,
    profile: params.get('profile') ?? undefined,
    limit: params.has('limit') ? parseInt(params.get('limit')!) : 50,
  }
  if (params.has('cursor') && typeof (deps.runStore as any).listPage === 'function') {
    try {
      const page = (deps.runStore as any).listPage({ ...options, cursor: params.get('cursor') ?? undefined })
      if (typeof (deps.runStore as any).getDiagnostics !== 'function') return sendJson(res, 200, page)
      const diagnostics = (deps.runStore as any).getDiagnostics()
      return sendJson(res, 200, { ...page, diagnostics: { count: Array.isArray(diagnostics) ? diagnostics.length : 0 } })
    } catch (error) { return sendJson(res, 400, { error: error instanceof Error ? error.message : 'invalid run history cursor' }) }
  }
  const runs = deps.runStore.list(options)
  if (typeof (deps.runStore as any).getDiagnostics !== 'function') return sendJson(res, 200, { runs })
  const diagnostics = (deps.runStore as any).getDiagnostics()
  sendJson(res, 200, { runs, diagnostics: { count: Array.isArray(diagnostics) ? diagnostics.length : 0 } })
}

function handleListPending(req: IncomingMessage, res: ServerResponse, deps: RestDeps): void {
  const rawUrl = req.url ?? '/pending'
  const [, query = ''] = rawUrl.split('?')
  const params = new URLSearchParams(query)
  if (params.has('user') && !params.get('user')) return sendJson(res, 400, { error: 'user scope must not be empty' })
  const store = pendingStore(deps)
  const pending = store.list({ user: params.get('user') ?? undefined, state: (params.get('state') ?? undefined) as any })
    .map(({ path: _path, ...record }) => record)
  sendJson(res, 200, { pending })
}

function handleListChannels(req: IncomingMessage, res: ServerResponse, deps: RestDeps): void {
  const rawUrl = req.url ?? '/channels'
  const [, query = ''] = rawUrl.split('?')
  const params = new URLSearchParams(query)
  const user = sanitizeUserId(params.get('user') ?? process.env.HARNESS_USER ?? 'anonymous')
  const runtime = channelsFor(deps, deps.defaultProfile)
  sendJson(res, 200, { channels: runtime?.statusForUser(user) ?? [] })
}

function requestQueryUser(req: IncomingMessage): string | undefined {
  const raw = new URL(req.url ?? '/', 'http://localhost').searchParams.get('user')
  return raw === null ? undefined : raw
}

async function handleAnswerPending(req: IncomingMessage, res: ServerResponse, deps: RestDeps, runId: string): Promise<void> {
  let body: { pending_id?: string; value?: string; user?: unknown }
  try { body = JSON.parse(await readBody(req)) } catch { return sendJson(res, 400, { error: 'malformed JSON body' }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { error: 'request must be an object' })
  if (!body.pending_id || typeof body.value !== 'string') return sendJson(res, 400, { error: 'pending_id and value required' })
  let requestedUser: string | undefined
  try { requestedUser = assertMatchingScopes(requestQueryUser(req), body.user) } catch (error) { return sendJson(res, (error as ScopeError).status, { error: (error as Error).message }) }
  const store = pendingStore(deps)
  const pending = store.get(body.pending_id)
  if (!pending || pending.run_id !== runId || (requestedUser && pending.user !== requestedUser)) return sendJson(res, 404, { error: 'pending input not found' })
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
  let requestedUser: string | undefined
  try { requestedUser = requestQueryUser(req) === undefined ? undefined : normalizeUserScope(requestQueryUser(req)) } catch (error) { return sendJson(res, (error as ScopeError).status, { error: (error as Error).message }) }
  const store = pendingStore(deps)
  const pending = store.get(pendingId)
  if (!pending || (requestedUser && pending.user !== requestedUser)) return sendJson(res, 404, { error: 'pending input not found' })
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
  let requestedUser: string | undefined
  try { requestedUser = requestQueryUser(req) === undefined ? undefined : normalizeUserScope(requestQueryUser(req)) } catch (error) { return sendJson(res, (error as ScopeError).status, { error: (error as Error).message }) }
  if (!run || (requestedUser && run.user !== requestedUser)) return sendJson(res, 404, { error: 'run not found' })
  sendJson(res, 200, run)
}

function handleDeleteRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps, id: string): void {
  const run = deps.runStore.get(id)
  let requestedUser: string | undefined
  try { requestedUser = requestQueryUser(req) === undefined ? undefined : normalizeUserScope(requestQueryUser(req)) } catch (error) { return sendJson(res, (error as ScopeError).status, { error: (error as Error).message }) }
  if (!run || (requestedUser && run.user !== requestedUser)) return sendJson(res, 404, { error: 'run not found' })
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

function missionUser(req: IncomingMessage, bodyUser?: string): string {
  try {
    const asserted = assertMatchingScopes(requestQueryUser(req), bodyUser)
    return normalizeUserScope(asserted, process.env.HARNESS_USER ?? 'anonymous')
  } catch { return '' }
}
function handleListMissions(req: IncomingMessage, res: ServerResponse): void {
  const user = missionUser(req); if (!user) return sendJson(res, 400, { error: 'missing user' }); sendJson(res, 200, { missions: new MissionStore(user).list() })
}
function handleGetMission(req: IncomingMessage, res: ServerResponse, id: string): void {
  const user = missionUser(req); if (!user) return sendJson(res, 400, { error: 'missing user' }); const mission = new MissionStore(user).get(id); if (!mission) return sendJson(res, 404, { error: 'mission not found' }); sendJson(res, 200, { mission, receipts: new MissionStore(user).receipts(id) })
}
async function handleCreateMission(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Partial<MissionInput> & { user?: string }
  try { body = JSON.parse(await readBody(req)) } catch { return sendJson(res, 400, { error: 'malformed JSON body' }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { error: 'request must be an object' })
  const user = missionUser(req, body.user); if (!user) return sendJson(res, 400, { error: 'missing user' })
  if (typeof body.outcome !== 'string' || !Array.isArray(body.criteria) || typeof body.profile !== 'string' || typeof body.project !== 'string') return sendJson(res, 400, { error: 'profile, project, outcome, and criteria required' })
  const mission = createMission({ ...body, user, constraints: Array.isArray(body.constraints) ? body.constraints : [] } as MissionInput); new MissionStore(user).save(mission); sendJson(res, 201, { mission })
}
async function handleCompleteHuman(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  let body: { user?: string; criterion_id?: string; revision?: number; completed_by?: string }
  try { body = JSON.parse(await readBody(req)) } catch { return sendJson(res, 400, { error: 'malformed JSON body' }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { error: 'request must be an object' })
  const user = missionUser(req, body.user); if (!body.criterion_id || body.revision === undefined) return sendJson(res, 400, { error: 'criterion_id and revision required' }); const store = new MissionStore(user); const mission = store.get(id); if (!mission) return sendJson(res, 404, { error: 'mission not found' }); try { const next = completeHumanCriterion(mission, body.criterion_id, body.completed_by ?? user, body.revision); store.save(next); return sendJson(res, 200, { mission: next }) } catch (error) { return sendJson(res, 409, { error: error instanceof Error ? error.message : String(error) }) }
}

async function handleListMemoryConflicts(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = missionUser(req)
  return sendJson(res, 200, { conflicts: new MemoryConflictStore(user).list() })
}

async function handleDetectMemoryConflicts(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { user?: string; scope?: string; entries?: any[]; dependent_missions?: string[] }
  try { body = JSON.parse(await readBody(req)) } catch { return sendJson(res, 400, { error: 'malformed JSON body' }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { error: 'request must be an object' })
  const user = missionUser(req, body.user)
  if (!body.scope || !Array.isArray(body.entries)) return sendJson(res, 400, { error: 'scope and entries required' })
  const store = new MemoryConflictStore(user)
  const conflicts = detectConflicts(body.entries, user, body.scope).map(conflict => ({ ...conflict, dependent_missions: body.dependent_missions ?? [] }))
  conflicts.forEach(conflict => store.save(conflict))
  return sendJson(res, 201, { conflicts })
}

async function handleResolveMemoryConflict(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  let body: { user?: string; revision?: number; chosen_key?: string; preserve_ambiguity?: boolean; reason?: string }
  try { body = JSON.parse(await readBody(req)) } catch { return sendJson(res, 400, { error: 'malformed JSON body' }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { error: 'request must be an object' })
  const user = missionUser(req, body.user)
  if (body.revision === undefined) return sendJson(res, 400, { error: 'revision required' })
  const store = new MemoryConflictStore(user)
  const conflict = store.get(id)
  if (!conflict) return sendJson(res, 404, { error: 'memory conflict not found' })
  try {
    const next = resolveConflict(conflict, { user, revision: body.revision, chosenKey: body.chosen_key, preserveAmbiguity: body.preserve_ambiguity, reason: body.reason })
    store.save(next)
    const missions = new MissionStore(user)
    for (const missionId of next.dependent_missions) {
      const mission = missions.get(missionId)
      if (!mission) continue
      missions.save({ ...mission, revision: mission.revision + 1, status: 'needs_human', criteria: mission.criteria.map(criterion => criterion.state === 'verified' ? { ...criterion, state: 'needs_human', failure: `memory conflict ${next.id} requires revalidation` } : criterion) })
    }
    return sendJson(res, 200, { conflict: next })
  } catch (error) { return sendJson(res, 409, { error: error instanceof Error ? error.message : String(error) }) }
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
  if (!getProject(user, body.projectId)) return sendJson(res, 404, { error: 'project not found' })
  assignSession(user, sessionId, body.projectId)
  sendJson(res, 200, { sessions: listSessionSummaries(user) })
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse, deps: RestDeps, profileName: string): Promise<void> {
  const profile = resolveProfile(profileName, deps)

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
    onToken: t => sse('message', { type: 'token', content: t, run_id: runId }),
    // A prompted tool may be immediately denied below; tool_start marks its lifecycle, not execution.
    onToolStart: (id, n, i) => sse('message', { type: 'tool_start', id, name: n, input: i, run_id: runId }),
    onToolEnd: (id, n, r, ok) => sse('message', { type: 'tool_end', id, name: n, result: r, ok, run_id: runId }),
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
    if ((e as Error).name !== 'AbortError') sse('error', { message: e.message, run_id: runId })
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
  const originPolicy = deps.originPolicy ?? loadOriginPolicy()
  const readHandler = createReadApiHandler({ defaultProfile: deps.defaultProfile, profiles: deps.profiles, ...deps.readApi })
  let rejectedOrigins = 0

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? '/').split('?')[0]
    const method = req.method ?? 'GET'

    try {
      const header = req.headers.origin
      const origin = typeof header === 'string' ? header : header ? '__invalid_origin__' : undefined
      const originResult = checkOrigin(origin, originPolicy)
      if (!originResult.ok) {
        rejectedOrigins += 1
        console.warn(`[origin] rejected REST request: ${origin ?? 'missing'} (${originResult.reason})`)
        return sendJson(res, 403, { error: 'forbidden', reason: originResult.reason })
      }
      if (origin) {
        res.setHeader('access-control-allow-origin', origin)
        res.setHeader('vary', 'Origin')
        res.setHeader('access-control-allow-headers', 'content-type, authorization')
        res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
      }
      if (method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      if (method === 'POST' && url.startsWith('/channels/')) {
        const channel = url.slice('/channels/'.length, -'/inbound'.length)
        if (url.endsWith('/inbound') && deps.channels && await deps.channels.handleHttp(channel, req, res)) return
      }
      if (method === 'GET' && url === '/health') {
        return sendJson(res, 200, { status: 'ok', profile: deps.defaultProfile.name, profiles: deps.profiles ? [...deps.profiles.keys()].sort() : [deps.defaultProfile.name], version: VERSION, origin_policy: originPolicy, origin_rejections: rejectedOrigins })
      }

      if (deps.apiKey && req.headers['authorization'] !== `Bearer ${deps.apiKey}`) {
        return sendJson(res, 401, { error: 'unauthorized' })
      }

      const scopedUser = sanitizeUserId(new URL(req.url ?? '/', 'http://localhost').searchParams.get('user') ?? process.env.HARNESS_USER ?? 'anonymous')
      if (await handleReplayRequest(req, res, { user: scopedUser })) return
      if (await handleEvaluationExecutionRequest(req, res, { user: scopedUser })) return
      if (handleEvaluationRequest(req, res, { user: scopedUser })) return
      const conflictId = /^\/memory\/conflicts\/([^/]+)\/resolve$/.exec(url)
      if (method === 'GET' && url === '/memory/conflicts') return handleListMemoryConflicts(req, res)
      if (method === 'POST' && url === '/memory/conflicts/detect') return handleDetectMemoryConflicts(req, res)
      if (method === 'POST' && conflictId) return handleResolveMemoryConflict(req, res, decodeURIComponent(conflictId[1]))
      const evaluationRun = /^\/evaluations\/([^/]+)\/run$/.exec(url)
      if (method === 'POST' && evaluationRun) {
        const store = new EvaluationStore(scopedUser); const dataset = store.getDataset(decodeURIComponent(evaluationRun[1]))
        if (!dataset) return sendJson(res, 404, { error: 'evaluation dataset not found' })
        const run = await runEvaluation(dataset, { profile: deps.defaultProfile.name, configFingerprint: 'fixture-rest', execute: async test => ({ correct: deterministicAssertion(test.expected, test.expected), actual: test.expected, tool_errors: 0, human_intervention: false }) })
        store.saveRun(run); return sendJson(res, 201, { run })
      }
      if (method === 'POST' && url === '/corrections') {
        const input = JSON.parse(await readBody(req)) as { scope?: string; source_mission_id?: string; rationale?: string; before?: string; after?: string; regression_case_ids?: string[]; source?: 'operator' }
        if (!input.scope || !input.source_mission_id || typeof input.before !== 'string' || typeof input.after !== 'string') return sendJson(res, 400, { error: 'scope, source_mission_id, before and after required' })
        let proposal
        try { proposal = proposeCorrection({ scope: input.scope, sourceMissionId: input.source_mission_id, rationale: input.rationale ?? '', before: input.before, after: input.after, regressionCaseIds: input.regression_case_ids ?? [], source: input.source }) }
        catch (error) { return sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) }) }
        const path = join(userPaths(scopedUser, '').artifactsDir, 'corrections', `${proposal.id}.json`); new CorrectionStore(path).save(proposal); return sendJson(res, 201, { proposal })
      }
      if (method === 'GET' && url === '/artifacts') return sendJson(res, 200, { recipes: new ArtifactStore(scopedUser).list() })
      if (method === 'POST' && url === '/artifacts') {
        const input = JSON.parse(await readBody(req)) as { profile?: string; generating_tool?: string; parameters?: Record<string, unknown>; payload?: unknown; source_dependencies?: string[]; session_id?: string; tool_call_id?: string }
        if (!input.generating_tool || input.payload === undefined) return sendJson(res, 400, { error: 'generating_tool and payload required' })
        const recipe = promoteArtifact(scopedUser, { profile: input.profile ?? deps.defaultProfile.name, generatingTool: input.generating_tool, parameters: input.parameters ?? {}, payload: input.payload, sourceDependencies: input.source_dependencies, sessionId: input.session_id, toolCallId: input.tool_call_id }); new ArtifactStore(scopedUser).save(recipe); return sendJson(res, 201, { recipe })
      }
      const artifactRefresh = /^\/artifacts\/([^/]+)\/refresh$/.exec(url)
      if (method === 'POST' && artifactRefresh) {
        const store = new ArtifactStore(scopedUser); const recipe = store.get(decodeURIComponent(artifactRefresh[1])); if (!recipe) return sendJson(res, 404, { error: 'artifact recipe not found' })
        try {
          const bodyText = await readBody(req)
          let body: { confirm?: boolean } = {}
          if (bodyText.trim()) {
            try { body = JSON.parse(bodyText) as { confirm?: boolean } } catch { return sendJson(res, 400, { error: 'malformed JSON body' }) }
          }
          if (recipe.profile !== deps.defaultProfile.name) return sendJson(res, 403, { error: 'artifact recipe profile is not active' })
          const acl = resolveAclDecision(recipe.generating_tool, recipe.parameters, deps.defaultProfile, 'danger')
          if (acl.value === 'deny') return sendJson(res, 403, { error: `artifact generator denied by profile ACL: ${acl.reason}` })
          if (recipe.refresh_policy.confirm_new_effects && body.confirm !== true) return sendJson(res, 409, { error: 'artifact refresh requires explicit confirmation' })
          const budget = deps.defaultProfile.triggers?.budget ? new RunBudget(deps.defaultProfile.triggers.budget) : undefined
          const updated = await store.refreshRuntime(recipe.id, {
            resolveDependency: createFileDependencyResolver(deps.defaultProfile.working_dir),
            approval: body.confirm === true ? { approved: true, reason: 'explicit operator confirmation' } : undefined,
            budget,
            execute: async request => {
              if (request.recipe.generating_tool === 'fixture' && request.dependencies.length === 1) return { payload: request.dependencies[0].payload }
              if (!deps.artifactGenerator) throw new Error(`no artifact generator executor registered for ${request.generatingTool}`)
              return deps.artifactGenerator(request, { user: scopedUser, profile: deps.defaultProfile, budget, signal: undefined, confirmed: body.confirm === true })
            },
          })
          store.save(updated)
          return sendJson(res, 200, { recipe: updated })
        } catch (error) { return sendJson(res, 409, { error: error instanceof Error ? error.message : String(error) }) }
      }
      const correctionEvaluate = /^\/corrections\/([^/]+)\/evaluate$/.exec(url)
      const correctionPromote = /^\/corrections\/([^/]+)\/promote$/.exec(url)
      const correctionRollback = /^\/corrections\/([^/]+)\/rollback$/.exec(url)
      if ((method === 'POST' && correctionEvaluate) || (method === 'POST' && correctionPromote) || (method === 'POST' && correctionRollback)) {
        const id = decodeURIComponent((correctionEvaluate ?? correctionPromote ?? correctionRollback)![1]); if (!/^[a-f0-9-]+$/.test(id)) return sendJson(res, 400, { error: 'invalid correction id' })
        const path = join(userPaths(scopedUser, '').artifactsDir, 'corrections', `${id}.json`); let proposal: any
        try { proposal = readJson(path) } catch { return sendJson(res, 404, { error: 'correction not found' }) }
        if (correctionEvaluate) { const input = JSON.parse(await readBody(req)) as { passed?: boolean; complete?: boolean }; proposal = applyEvaluation(proposal, { passed: input.passed === true, complete: input.complete === true }) }
        else if (correctionPromote) { const input = JSON.parse(await readBody(req)) as { current?: string }; if (typeof input.current !== 'string') return sendJson(res, 400, { error: 'current content required' }); proposal = promoteCorrection(proposal, input.current) }
        else { const input = JSON.parse(await readBody(req)) as { current?: string }; if (typeof input.current !== 'string') return sendJson(res, 400, { error: 'current content required' }); const rolledBack = rollbackCorrection(proposal, input.current); proposal = rolledBack.proposal }
        new CorrectionStore(path).save(proposal); return sendJson(res, 200, { proposal })
      }

      if (await readHandler(req, res)) return

      if (method === 'GET' && url === '/channels') return handleListChannels(req, res, deps)

      if (method === 'GET' && url === '/agents') return handleAcpAgents(req, res, deps)

      if (method === 'POST' && url.startsWith('/agents/') && url.endsWith('/runs')) {
        return handleAcpCreateRun(req, res, deps, url.slice('/agents/'.length, -'/runs'.length))
      }

      if (method === 'GET' && url === '/.well-known/agent.json') return handleAgentCard(req, res, deps)

      if (method === 'POST' && url === '/a2a') return handleA2ATask(req, res, deps)

      if (method === 'POST' && url === '/run') return handleRun(req, res, deps)
      if (method === 'POST' && url === '/stream') return handleStream(req, res, deps)

      if (method === 'GET' && url === '/missions') return handleListMissions(req, res)
      if (method === 'POST' && url === '/missions') return handleCreateMission(req, res)
      if (method === 'POST' && url.startsWith('/missions/') && url.endsWith('/human')) return handleCompleteHuman(req, res, url.slice('/missions/'.length, -'/human'.length))
      if (method === 'GET' && url.startsWith('/missions/')) return handleGetMission(req, res, url.slice('/missions/'.length))

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
