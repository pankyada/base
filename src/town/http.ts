import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Profile } from '../profiles/schema.js'
import { normalizeUserScope, ScopeError } from '../server/scope.js'
import { RevisionConflictError } from '../shared/atomic-json.js'
import { defaultTownRoot, TownStore, type NewTownMessage } from './store.js'
import { discoverTownProjects } from './discovery.js'
import type { QuotaSnapshot, TownMessage, TownProject, TownTask, TownTaskState } from './types.js'

const MAX_BODY_BYTES = 1024 * 1024
const QUOTA_MAX_AGE_MS = 60_000

export interface TownRuntimeStart {
  start(input: { user: string; profile: Profile; task: TownTask; project: TownProject; workingDirectory: string; orchestrator: boolean; store: TownStore; dispatchWorker: TownDispatchWorker }): Promise<{ session_id: string; run_id: string }>
  answer?(input: { user: string; profile: Profile; store: TownStore; question: TownMessage; answer: string; dispatchWorker?: TownDispatchWorker }): Promise<{ resumed: boolean; state?: string; error?: string }>
  canRecoverContinuation?(input: { user: string; task: TownTask; question: TownMessage }): boolean
  cancel?(input: { user: string; task: TownTask; store: TownStore }): Promise<void>
}

export interface TownDispatchWorker {
  (taskId: string): Promise<unknown>
  /** Permanently revoke this run's manual quota inheritance when it parks. */
  revokeManualQuotaOverride?: () => void
  isManualQuotaOverrideActive?: () => boolean
}

export interface TownQuotaProvider {
  read(input: { user: string; profile: Profile }): Promise<QuotaSnapshot>
}

export interface TownHttpDeps {
  defaultProfile: Profile
  profiles?: Map<string, Profile>
  baseDirectory?: string
  rootPolicy?: string
  quotaProvider?: TownQuotaProvider
  runtime?: TownRuntimeStart
  now?: () => Date
  /** Deterministic scheduler cadence; production defaults to a bounded 30s recheck. */
  queuePollMs?: number
}

export type TownHttpHandler = ((req: IncomingMessage, res: ServerResponse) => Promise<boolean>) & { close(): Promise<void> }

interface JsonRequest extends IncomingMessage { url?: string }
type DispatchReason = 'quota' | 'dependency' | 'workspace' | 'concurrency'
interface ManualQuotaAuthorization { authorityTaskId: string; authorizedBy: string; authorizedAt: string; parentTaskId?: string; scope: 'dispatch' | 'answer_resume' }

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request body too large'), { status: 413 })
    chunks.push(bytes)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  let value: unknown
  try { value = JSON.parse(text) } catch { throw Object.assign(new Error('malformed JSON body'), { status: 400 }) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('request must be an object'), { status: 400 })
  return value as Record<string, unknown>
}

function string(value: unknown, name: string, max = 20_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Object.assign(new Error(`${name} is required`), { status: 400 })
  return value.trim()
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw Object.assign(new Error('current revision is required'), { status: 400 })
  return Number(value)
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function safeError(error: unknown): { status: number; error: string; code: string } {
  if (error instanceof RevisionConflictError) return { status: 409, error: error.message, code: 'revision_conflict' }
  const value = error as Error & { status?: number }
  const message = value?.message ?? 'Town request failed'
  const status = value?.status ?? (/not found/i.test(message) ? 404 : /already answered|continuation|invalid task transition|closed/i.test(message) ? 409 : 400)
  return { status, error: message, code: status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'invalid_request' }
}

function answerResponse(message: TownMessage, outcome: NonNullable<TownMessage['answer_outcome']>, manualQuotaOverride?: TownTask['manual_quota_override'], quota?: QuotaSnapshot): Record<string, unknown> {
  return { message, resumed: outcome.resumed, ...(outcome.error ? { resume_error: outcome.error } : {}), ...(outcome.state ? { state: outcome.state } : {}), ...(manualQuotaOverride ? { manual_quota_override: manualQuotaOverride } : {}), ...(quota ? { quota } : {}) }
}

function profileFor(req: IncomingMessage, deps: TownHttpDeps): Profile | null {
  const requested = new URL(req.url ?? '/', 'http://localhost').searchParams.get('profile')
  if (!requested || requested === deps.defaultProfile.name) return deps.defaultProfile
  return deps.profiles?.get(requested) ?? null
}

function ensureFreshQuota(snapshot: QuotaSnapshot, now: Date): { ok: boolean; reason: DispatchReason; quota: QuotaSnapshot } {
  if (snapshot.status !== 'available') return { ok: false, reason: 'quota', quota: snapshot }
  const expiry = snapshot.expires_at ? Date.parse(snapshot.expires_at) : NaN
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) return { ok: false, reason: 'quota', quota: { ...snapshot, status: 'stale' } }
  if (!snapshot.account_scope || !snapshot.provider || snapshot.windows.length === 0) return { ok: false, reason: 'quota', quota: { ...snapshot, status: 'unavailable', last_error: snapshot.last_error ?? 'authoritative account windows are missing' } }
  const valid = snapshot.windows.every(window => Number.isFinite(window.used_percent) && window.used_percent >= 0 && window.used_percent <= 100)
  if (!valid) return { ok: false, reason: 'quota', quota: { ...snapshot, status: 'unavailable', last_error: 'provider returned an invalid quota window' } }
  const exhausted = snapshot.provider_reached === true || snapshot.spend_control_reached === true || snapshot.windows.some(window => window.used_percent >= 100 || window.exhausted === true)
  return exhausted ? { ok: false, reason: 'quota', quota: { ...snapshot, status: 'exhausted' } } : { ok: true, reason: 'quota', quota: snapshot }
}

function openEvents(req: IncomingMessage, res: ServerResponse, store: TownStore, after: number): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' })
  let cursor = after
  let closed = false
  const stop = () => { closed = true; clearInterval(timer) }
  const flush = () => {
    if (closed) return
    try {
      const page = store.events(cursor)
      if (page.resync) {
        const snapshot = store.snapshot(true)
        res.write(`id: ${snapshot.cursor}\nevent: resync\ndata: ${JSON.stringify(snapshot)}\n\n`)
        cursor = snapshot.cursor
      } else {
        for (const event of page.events) {
          res.write(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          cursor = event.cursor
        }
      }
    } catch {
      res.write('event: unavailable\ndata: {"error":"Town event stream unavailable"}\n\n')
    }
  }
  const timer = setInterval(flush, 1000)
  timer.unref()
  req.on('close', stop)
  res.on('close', stop)
  flush()
}

/** Additive REST/SSE surface for Town. Returned handler says false for routes it does not own. */
export function createTownHttpHandler(deps: TownHttpDeps): TownHttpHandler {
  const stores = new Map<string, TownStore>()
  const answerRuns = new Map<string, Promise<NonNullable<TownMessage['answer_outcome']>>>()
  const storeFor = (user: string) => {
    const safe = user
    let store = stores.get(safe)
    if (!store) {
      store = new TownStore(safe, {
        baseDirectory: deps.baseDirectory,
        ...(deps.runtime?.canRecoverContinuation ? { canRecoverContinuation: (task, question) => deps.runtime!.canRecoverContinuation!({ user: safe, task, question }) } : {}),
      })
      stores.set(safe, store)
    }
    return store
  }
  const now = deps.now ?? (() => new Date())
  const quotaFor = async (store: TownStore, user: string, profile: Profile): Promise<QuotaSnapshot> => {
    // Admission always probes the selected credential now; auth type alone is
    // not an account identity, so an earlier snapshot cannot authorize a run.
    const provider = profile.model?.auth ?? 'api_key'
    try {
      const measured = deps.quotaProvider
        ? await deps.quotaProvider.read({ user, profile })
        : { provider, account_scope: '', status: 'unsupported' as const, windows: [], source: 'no provider-authoritative quota adapter', last_error: 'quota source is not available for this profile' }
      const quota = { ...measured, fetched_at: measured.fetched_at ?? now().toISOString(), expires_at: measured.expires_at ?? new Date(now().getTime() + QUOTA_MAX_AGE_MS).toISOString() }
      return store.setQuota(quota)
    } catch (error) {
      return store.setQuota({ provider, account_scope: '', status: 'unavailable', fetched_at: now().toISOString(), expires_at: new Date(now().getTime() + QUOTA_MAX_AGE_MS).toISOString(), windows: [], source: 'provider quota probe', last_error: error instanceof Error ? error.message : 'provider quota probe failed' })
    }
  }
  const queueTask = (store: TownStore, task: TownTask, reason: DispatchReason): TownTask => {
    const target: TownTaskState = reason === 'quota' ? 'queued_quota' : reason === 'dependency' ? 'queued_dependency' : reason === 'workspace' ? 'queued_workspace' : 'queued_concurrency'
    let current = task
    if (current.state === 'draft') current = store.transitionTask(current.id, current.revision, 'ready')
    if (current.state === target) return current
    if (current.state !== 'ready') current = store.transitionTask(current.id, current.revision, 'ready')
    return store.transitionTask(current.id, current.revision, target, { block_reason: reason })
  }
  const dispatch = async (store: TownStore, user: string, taskId: string, expectedRevision: number, profile: Profile, orchestrator = false, manualAuthorization?: ManualQuotaAuthorization) => {
    const foundTask = store.getTask(taskId)
    if (!foundTask) throw Object.assign(new Error('task not found'), { status: 404 })
    let task: TownTask = foundTask
    if (task.revision !== expectedRevision) throw new RevisionConflictError(`town task ${taskId}`, expectedRevision, task.revision)
    if (task.state === 'queued_quota' && store.snapshot().messages.some(message => message.kind === 'answer' && message.task_id === task.id && message.answer_outcome?.state === 'queued_quota')) {
      return { decision: 'queued' as const, task, reason: 'quota' as const, quota: store.snapshot().quota }
    }
    if (task.state === 'draft') task = store.transitionTask(task.id, task.revision, 'ready')
    if (task.state !== 'ready' && !task.state.startsWith('queued_')) throw Object.assign(new Error(`task is already ${task.state}`), { status: 409 })
    const snapshot = store.snapshot()
    if (task.depends_on.some(id => snapshot.tasks.find(other => other.id === id)?.state !== 'completed')) {
      const queued = queueTask(store, task, 'dependency')
      return { decision: 'queued' as const, task: queued, reason: 'dependency' as const, quota: snapshot.quota }
    }
    const quota = await quotaFor(store, user, profile)
    const capacity = ensureFreshQuota(quota, now())
    if (capacity.quota !== quota) store.setQuota(capacity.quota)
    if (manualAuthorization) {
      const currentAgent = task.agent_id ? store.snapshot().agents.find(agent => agent.id === task.agent_id) : undefined
      const isAuthorizedRoot = !manualAuthorization.parentTaskId
        && task.id === manualAuthorization.authorityTaskId
        && !task.created_by_task_id
        && task.workspace_mode === 'read_only'
        && currentAgent?.role === 'orchestrator'
        && orchestrator
      const root = manualAuthorization.parentTaskId ? store.getTask(manualAuthorization.authorityTaskId) : null
      const rootAgent = root?.agent_id ? store.snapshot().agents.find(agent => agent.id === root.agent_id) : undefined
      const isAuthorizedChild = manualAuthorization.parentTaskId === manualAuthorization.authorityTaskId
        && task.created_by_task_id === manualAuthorization.authorityTaskId
        && Boolean(root && ['dispatching', 'running'].includes(root.state))
        && root?.workspace_mode === 'read_only'
        && root?.manual_quota_override?.authority_task_id === root.id
        && rootAgent?.role === 'orchestrator'
      if (!isAuthorizedRoot && !isAuthorizedChild) throw Object.assign(new Error('manual quota override is not authorized for this task'), { status: 403 })
      task = store.recordManualQuotaOverride(task.id, task.revision, {
        requested_at: now().toISOString(),
        authorized_at: manualAuthorization.authorizedAt,
        authorized_by: manualAuthorization.authorizedBy,
        authority_task_id: manualAuthorization.authorityTaskId,
        authorization_scope: manualAuthorization.scope,
        quota_provider: capacity.quota.provider,
        quota_status: capacity.quota.status,
        quota_source: capacity.quota.source,
      })
    }
    if (!capacity.ok && !manualAuthorization) {
      const queued = queueTask(store, task, 'quota')
      return { decision: 'queued' as const, task: queued, reason: 'quota' as const, quota: capacity.quota }
    }
    if (!deps.runtime) {
      const queued = queueTask(store, task, 'concurrency')
      return { decision: 'queued' as const, task: queued, reason: 'concurrency' as const, quota: capacity.quota }
    }
    const project = store.getProject(task.project_id)
    if (!project) throw Object.assign(new Error('project not found'), { status: 404 })
    const lease = store.acquireLease(task.id, capacity.quota.provider, capacity.quota.account_scope)
    if (!lease.lease) {
      const queued = queueTask(store, task, lease.reason ?? 'workspace')
      return { decision: 'queued' as const, task: queued, reason: lease.reason ?? 'workspace', quota: capacity.quota }
    }
    const dispatchingTask = store.transitionTask(task.id, task.revision, 'dispatching')
    try {
      let manualAuthorizationActive = true
      const dispatchWorker: TownDispatchWorker = async (workerTaskId: string) => {
        const worker = store.getTask(workerTaskId)
        if (!worker) throw new Error('worker task not found')
        const assignedProfile = worker.agent_id ? store.snapshot().agents.find(agent => agent.id === worker.agent_id)?.profile : profile.name
        const workerProfile = assignedProfile === profile.name ? profile : deps.profiles?.get(assignedProfile ?? '')
        if (!workerProfile) throw new Error('assigned worker profile is unavailable')
        const currentParent = store.getTask(dispatchingTask.id)
        const inherited = manualAuthorizationActive && manualAuthorization
          && manualAuthorization.authorityTaskId === dispatchingTask.id
          && worker.created_by_task_id === dispatchingTask.id
          && currentParent
          && ['dispatching', 'running'].includes(currentParent.state)
          && currentParent.manual_quota_override?.authority_task_id === currentParent.id
          ? { ...manualAuthorization, parentTaskId: dispatchingTask.id }
          : undefined
        return dispatch(store, user, worker.id, worker.revision, workerProfile, false, inherited)
      }
      dispatchWorker.revokeManualQuotaOverride = () => { manualAuthorizationActive = false }
      dispatchWorker.isManualQuotaOverrideActive = () => manualAuthorizationActive
      const started = await deps.runtime.start({ user, profile, task: dispatchingTask, project, workingDirectory: project.path, orchestrator, store, dispatchWorker })
      const runningTask = store.markRunning(dispatchingTask.id, dispatchingTask.revision, started.session_id, started.run_id)
      if (runningTask.agent_id) {
        const agent = store.snapshot().agents.find(item => item.id === runningTask.agent_id)
        if (agent) store.putAgent({ ...agent, state: 'working', task_id: runningTask.id, session_id: started.session_id, run_id: started.run_id })
      }
      return { decision: 'started' as const, task: runningTask, session_id: started.session_id, run_id: started.run_id, quota: capacity.quota }
    } catch (error) {
      store.releaseLease(dispatchingTask.id, 'runtime start failed')
      const failed = store.transitionTask(dispatchingTask.id, dispatchingTask.revision, 'failed', { terminal_evidence: error instanceof Error ? error.message : 'runtime start failed' })
      throw Object.assign(new Error(`worker start failed; task ${failed.id} is failed: ${error instanceof Error ? error.message : 'runtime start failed'}`), { status: 502 })
    }
  }

  const profileForTask = (store: TownStore, task: TownTask, fallback: Profile): Profile | undefined => {
    const assignedName = task.agent_id ? store.snapshot().agents.find(agent => agent.id === task.agent_id)?.profile : fallback.name
    return assignedName === fallback.name ? fallback : deps.profiles?.get(assignedName ?? '')
  }

  const manualAnswerAuthorization = (store: TownStore, user: string, question: TownMessage): ManualQuotaAuthorization => {
    const snapshot = store.snapshot()
    const task = question.task_id ? snapshot.tasks.find(item => item.id === question.task_id) : undefined
    const parent = task?.created_by_task_id ? snapshot.tasks.find(item => item.id === task.created_by_task_id) : undefined
    const agent = task?.agent_id ? snapshot.agents.find(item => item.id === task.agent_id) : undefined
    const parentAgent = parent?.agent_id ? snapshot.agents.find(item => item.id === parent.agent_id) : undefined
    const existingAnswer = snapshot.messages.find(item => item.kind === 'answer' && item.reply_to === question.id)
    const answerStillQueued = !existingAnswer || (existingAnswer.answer_outcome?.state?.startsWith('queued_') === true)
    const eligible = Boolean(
      task && parent && task.created_by_task_id === parent.id && !parent.created_by_task_id
      && question.task_id === task.id && question.project_id === task.project_id
      && question.continuation_id && (!question.thread_id || question.thread_id === task.session_id)
      && ['waiting_user', 'queued_quota', 'queued_workspace', 'queued_concurrency', 'queued_dependency'].includes(task.state)
      && task.workspace_mode === 'shared_checkout' && agent?.role === 'worker'
      && task.session_id && task.run_id && answerStillQueued
      && ['running', 'waiting_user', 'completed'].includes(parent.state)
      && parent.workspace_mode === 'read_only' && parentAgent?.role === 'orchestrator'
      && parent.manual_quota_override?.authority_task_id === parent.id
      && parent.manual_quota_override.authorized_by === user
      && task.manual_quota_override?.authority_task_id === parent.id
      && task.manual_quota_override.authorized_by === user
    )
    if (!eligible || !task || !parent) throw Object.assign(new Error('manual quota answer override is limited to the exact waiting direct-child worker continuation previously authorized by this user'), { status: 403 })
    return { authorityTaskId: parent.id, parentTaskId: parent.id, authorizedBy: user, authorizedAt: now().toISOString(), scope: 'answer_resume' }
  }

  const resumeDispatchWorker = (store: TownStore, user: string, fallback: Profile): TownDispatchWorker => async workerTaskId => {
    const worker = store.getTask(workerTaskId)
    if (!worker) throw new Error('worker task not found')
    const assignedName = worker.agent_id ? store.snapshot().agents.find(agent => agent.id === worker.agent_id)?.profile : fallback.name
    const workerProfile = assignedName === fallback.name ? fallback : deps.profiles?.get(assignedName ?? '')
    if (!workerProfile) throw new Error('assigned worker profile is unavailable')
    // Answer resumption restores only ordinary dispatch. The prior manual grant
    // is bound to this answer and cannot authorize descendants or later calls.
    return dispatch(store, user, worker.id, worker.revision, workerProfile, false)
  }

  const resumeAcceptedAnswer = async (store: TownStore, user: string, question: TownMessage, answer: TownMessage, fallback: Profile, manualAuthorization?: ManualQuotaAuthorization, retryQueuedReceipt = false): Promise<NonNullable<TownMessage['answer_outcome']>> => {
    const task = question.task_id ? store.getTask(question.task_id) : null
    if (!question.continuation_id || !task || !['waiting_user', 'queued_quota', 'queued_workspace', 'queued_concurrency', 'queued_dependency'].includes(task.state)) {
      return { resumed: false, ...(task?.state ? { state: task.state } : {}), error: 'question continuation is no longer resumable' }
    }
    const selected = profileForTask(store, task, fallback)
    if (!selected) {
      if (task.state !== 'queued_quota') queueTask(store, task, 'quota')
      const queued = { resumed: false, state: 'queued_quota', error: 'assigned profile is unavailable for quota verification' }
      if (retryQueuedReceipt) store.recordAnswerResumeOutcome(answer.id, queued)
      else store.recordAnswerOutcome(answer.id, queued)
      return queued
    }
    const measured = await quotaFor(store, user, selected)
    const capacity = ensureFreshQuota(measured, now())
    if (capacity.quota !== measured) store.setQuota(capacity.quota)
    let authorizedTask = task
    if (manualAuthorization) {
      const currentQuestion = store.snapshot().messages.find(item => item.id === question.id && item.kind === 'question')
      const freshAuthorization = currentQuestion ? manualAnswerAuthorization(store, user, currentQuestion) : undefined
      if (!freshAuthorization || freshAuthorization.authorityTaskId !== manualAuthorization.authorityTaskId) throw Object.assign(new Error('manual quota answer authorization changed before resume'), { status: 409 })
      const latest = store.getTask(task.id)
      if (!latest || !['waiting_user', 'queued_quota', 'queued_workspace', 'queued_concurrency', 'queued_dependency'].includes(latest.state)) throw Object.assign(new Error('manual quota answer target changed before resume'), { status: 409 })
      authorizedTask = store.recordManualQuotaOverride(latest.id, latest.revision, {
        requested_at: now().toISOString(), authorized_at: manualAuthorization.authorizedAt, authorized_by: user,
        authority_task_id: manualAuthorization.authorityTaskId, authorization_scope: 'answer_resume',
        quota_provider: capacity.quota.provider, quota_status: capacity.quota.status, quota_source: capacity.quota.source,
      })
    }
    if (!capacity.ok && !manualAuthorization) {
      const current = store.getTask(task.id)!
      if (current.state === 'waiting_user') store.transitionTask(current.id, current.revision, 'queued_quota', { block_reason: 'quota' })
      const queued = { resumed: false, state: 'queued_quota', error: `answer saved; resume held because Codex capacity is ${capacity.quota.status}` }
      if (retryQueuedReceipt) store.recordAnswerResumeOutcome(answer.id, queued)
      else store.recordAnswerOutcome(answer.id, queued)
      return queued
    }
    if (authorizedTask.depends_on.some(id => store.getTask(id)?.state !== 'completed')) {
      const queuedTask = queueTask(store, authorizedTask, 'dependency')
      const queued = { resumed: false, state: queuedTask.state, error: 'answer saved; resume held because a task dependency is incomplete' }
      if (retryQueuedReceipt) store.recordAnswerResumeOutcome(answer.id, queued)
      else store.recordAnswerOutcome(answer.id, queued)
      return queued
    }
    const leases = store.activeLeases().filter(lease => lease.task_id === authorizedTask.id)
    const dispatchLease = leases.find(lease => lease.kind === 'dispatch')
    const hasWorkspaceLease = authorizedTask.workspace_mode !== 'shared_checkout' || leases.some(lease => lease.kind === 'workspace')
    let leaseReady = Boolean(dispatchLease && dispatchLease.provider === capacity.quota.provider && dispatchLease.account_scope === capacity.quota.account_scope && hasWorkspaceLease && store.renewLeases(authorizedTask.id))
    if (!leaseReady) {
      if (leases.length) store.releaseLease(authorizedTask.id, 'reacquire parked continuation lease')
      const acquired = store.acquireLease(authorizedTask.id, capacity.quota.provider, capacity.quota.account_scope)
      if (!acquired.lease) {
        const queuedTask = queueTask(store, store.getTask(authorizedTask.id)!, acquired.reason ?? 'concurrency')
        const queued = { resumed: false, state: queuedTask.state, error: `answer saved; resume held by the ${acquired.reason ?? 'concurrency'} gate` }
        if (retryQueuedReceipt) store.recordAnswerResumeOutcome(answer.id, queued)
        else store.recordAnswerOutcome(answer.id, queued)
        return queued
      }
      leaseReady = true
    }
    const latest = store.getTask(task.id)
    if (!leaseReady || !latest || !['waiting_user', 'queued_quota', 'queued_workspace', 'queued_concurrency', 'queued_dependency'].includes(latest.state) || !store.snapshot().messages.some(item => item.id === question.id && item.continuation_id === question.continuation_id)) {
      return { resumed: false, ...(latest?.state ? { state: latest.state } : {}), error: 'question continuation closed before resume' }
    }
    if (!deps.runtime?.answer) {
      const current = store.getTask(task.id)
      if (current && ['waiting_user', 'queued_quota', 'queued_workspace', 'queued_concurrency', 'queued_dependency'].includes(current.state)) store.transitionTask(current.id, current.revision, 'failed', { terminal_evidence: 'question continuation runtime is unavailable' })
      store.closeContinuation(question.id)
      const failed = { resumed: false, state: 'failed', error: 'question continuation runtime is unavailable' }
      if (retryQueuedReceipt) store.recordAnswerResumeOutcome(answer.id, failed)
      else store.recordAnswerOutcome(answer.id, failed)
      return failed
    }
    let outcome: NonNullable<TownMessage['answer_outcome']>
    try { outcome = await deps.runtime.answer({ user, profile: selected, store, question, answer: answer.body, dispatchWorker: resumeDispatchWorker(store, user, selected) }) }
    catch (error) { outcome = { resumed: false, error: error instanceof Error ? error.message : 'worker resume failed' } }
    if (outcome.resumed) store.closeContinuation(question.id)
    else {
      const current = store.getTask(task.id)
      if (current && ['waiting_user', 'queued_quota', 'queued_workspace', 'queued_concurrency', 'queued_dependency', 'running'].includes(current.state)) store.transitionTask(current.id, current.revision, 'failed', { terminal_evidence: `answer could not resume worker: ${outcome.error ?? 'resume rejected'}` })
      store.closeContinuation(question.id)
      outcome = { ...outcome, state: 'failed' }
    }
    if (retryQueuedReceipt) store.recordAnswerResumeOutcome(answer.id, outcome)
    else store.recordAnswerOutcome(answer.id, outcome)
    return outcome
  }

  const processAcceptedAnswer = (store: TownStore, user: string, question: TownMessage, answer: TownMessage, fallback: Profile, manualAuthorization?: ManualQuotaAuthorization, retryQueuedReceipt = false) => {
    const key = `${user}:${question.id}`
    const active = answerRuns.get(key)
    if (active) return active
    let run: Promise<NonNullable<TownMessage['answer_outcome']>>
    run = resumeAcceptedAnswer(store, user, question, answer, fallback, manualAuthorization, retryQueuedReceipt).finally(() => {
      if (answerRuns.get(key) === run) answerRuns.delete(key)
    })
    answerRuns.set(key, run)
    return run
  }

  let scheduling = false
  let stopped = false
  let schedulerRun: Promise<void> | undefined
  const queueTimer = setInterval(() => {
    if (stopped || scheduling) return
    scheduling = true
    schedulerRun = (async () => {
      for (const [user, store] of stores) {
        const snapshot = store.snapshot()
        const queuedAnswer = snapshot.messages.find(message => {
          if (message.kind !== 'answer' || message.answer_outcome?.state !== 'queued_quota' || !message.task_id) return false
          const question = snapshot.messages.find(item => item.id === message.reply_to && item.kind === 'question')
          const task = snapshot.tasks.find(item => item.id === message.task_id)
          return Boolean(question?.continuation_id && task?.state === 'queued_quota')
        })
        if (queuedAnswer) {
          const question = snapshot.messages.find(message => message.id === queuedAnswer.reply_to && message.kind === 'question')
          const task = queuedAnswer.task_id ? store.getTask(queuedAnswer.task_id) : null
          if (!question?.continuation_id || !task) continue
          await processAcceptedAnswer(store, user, question, queuedAnswer, deps.defaultProfile)
          return
        }
        const answeredTaskIds = new Set(snapshot.messages.filter(message => message.kind === 'answer' && message.answer_outcome?.state === 'queued_quota').map(message => message.task_id))
        const queued = snapshot.tasks.find(task => task.state.startsWith('queued_') && !answeredTaskIds.has(task.id))
        if (!queued) continue
        const assignedName = queued.agent_id ? snapshot.agents.find(agent => agent.id === queued.agent_id)?.profile : deps.defaultProfile.name
        const selected = assignedName === deps.defaultProfile.name ? deps.defaultProfile : deps.profiles?.get(assignedName ?? '')
        if (!selected) continue
        try { await dispatch(store, user, queued.id, queued.revision, selected, snapshot.agents.find(agent => agent.id === queued.agent_id)?.role === 'orchestrator') }
        catch { /* durable state and explicit Retry remain available; the next bounded tick rechecks */ }
        return
      }
    })().catch(() => { /* durable state remains visible; next bounded tick rechecks */ }).finally(() => { scheduling = false })
  }, Math.max(1000, deps.queuePollMs ?? 30_000))
  queueTimer.unref?.()

  const handler: TownHttpHandler = Object.assign(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    if (!path.startsWith('/town/')) return false
    const method = req.method ?? 'GET'
    try {
      let user: string
      try { user = normalizeUserScope(url.searchParams.get('user') ?? undefined, process.env.HARNESS_USER ?? 'anonymous') }
      catch (error) { const scope = error as ScopeError; throw Object.assign(new Error(scope.message), { status: scope.status }) }
      const store = storeFor(user)
      const profile = profileFor(req, deps)
      if (!profile) throw Object.assign(new Error('unknown profile'), { status: 404 })

      if (method === 'GET' && path === '/town/snapshot') {
        const afterText = url.searchParams.get('after')
        const snapshot = store.snapshot()
        if (afterText === null) { send(res, 200, snapshot); return true }
        const after = Number(afterText)
        const page = store.events(after)
        send(res, 200, page.resync ? { ...store.snapshot(true), events: [] } : { ...snapshot, events: page.events, next_cursor: page.cursor })
        return true
      }
      if (method === 'GET' && path === '/town/events') {
        const after = Number(url.searchParams.get('after') ?? 0)
        if (!Number.isSafeInteger(after) || after < 0) throw new Error('invalid town cursor')
        openEvents(req, res, store, after)
        return true
      }
      if (method === 'GET' && path === '/town/quota') { send(res, 200, await quotaFor(store, user, profile)); return true }
      if (method === 'PATCH' && path === '/town/settings') {
        const input = await body(req)
        const expected = revision(input.revision)
        const patch: Record<string, unknown> = {}
        if (input.root !== undefined) {
          const requested = string(input.root, 'root', 2048)
          if (!isAbsolute(requested)) throw new Error('root must be absolute')
          const candidate = await realpath(resolve(requested))
          const policy = await realpath(deps.rootPolicy ?? defaultTownRoot()).catch(() => resolve(deps.rootPolicy ?? defaultTownRoot()))
          if (!isWithin(policy, candidate)) throw new Error('root is outside the configured discovery policy')
          patch.discovery_root = candidate
        }
        if (input.saved_viewpoints !== undefined) {
          if (!Array.isArray(input.saved_viewpoints) || input.saved_viewpoints.length > 32) throw new Error('saved_viewpoints must be a bounded list')
          patch.saved_viewpoints = input.saved_viewpoints
        }
        if (input.pinned_project_ids !== undefined) {
          if (!Array.isArray(input.pinned_project_ids) || !input.pinned_project_ids.every(item => typeof item === 'string')) throw new Error('pinned_project_ids must be a list of IDs')
          patch.pinned_project_ids = input.pinned_project_ids
        }
        send(res, 200, { settings: store.updateSettings(expected, patch) }); return true
      }
      if (method === 'POST' && path === '/town/discovery/refresh') {
        const input = await body(req)
        const settings = store.settings()
        const requested = input.root === undefined ? settings.discovery_root : string(input.root, 'root', 2048)
        if (!isAbsolute(requested)) throw new Error('discovery root must be absolute')
        const root = await realpath(resolve(requested))
        const configured = await realpath(settings.discovery_root)
        if (!isWithin(configured, root)) throw new Error('scan root is outside the configured root')
        const result = await discoverTownProjects(root, { existing: store.snapshot().projects })
        const projects = store.putProjects(result.projects)
        const discovery = store.recordDiscovery({ status: result.status, root: result.root, scanned_at: result.scanned_at, project_count: projects.length, skipped_count: result.skipped.length, error_count: result.errors.length, warnings: result.warnings })
        send(res, result.status === 'error' ? 400 : 202, { ...result, projects, discovery }); return true
      }
      const projectMatch = /^\/town\/projects\/([^/]+)$/.exec(path)
      if (method === 'GET' && projectMatch) {
        const project = store.getProject(decodeURIComponent(projectMatch[1]))
        if (!project) throw Object.assign(new Error('project not found'), { status: 404 })
        const snapshot = store.snapshot()
        send(res, 200, { project, tasks: snapshot.tasks.filter(task => task.project_id === project.id), agents: snapshot.agents.filter(agent => agent.home_project_id === project.id || snapshot.tasks.some(task => task.project_id === project.id && task.agent_id === agent.id)), messages: snapshot.messages.filter(message => message.project_id === project.id) })
        return true
      }
      if (method === 'POST' && path === '/town/tasks') {
        const input = await body(req)
        const expected = revision(input.revision)
        const task = store.createTask({
          project_id: string(input.project_id, 'project_id', 128), title: string(input.title, 'title', 200), prompt: string(input.prompt, 'prompt'),
          ...(input.agent_id === undefined ? {} : { agent_id: string(input.agent_id, 'agent_id', 128) }),
          workspace_mode: string(input.workspace_mode, 'workspace_mode', 32) as TownTask['workspace_mode'],
          ...(input.depends_on === undefined ? {} : { depends_on: input.depends_on as string[] }),
        }, expected)
        send(res, 201, { task }); return true
      }
      const transitionMatch = /^\/town\/tasks\/([^/]+)\/transition$/.exec(path)
      if (method === 'POST' && transitionMatch) {
        const input = await body(req)
        const task = store.transitionTask(decodeURIComponent(transitionMatch[1]), revision(input.revision), string(input.to, 'to', 32) as TownTaskState, { ...(typeof input.reason === 'string' ? { block_reason: input.reason } : {}) })
        send(res, 200, { task }); return true
      }
      const dispatchMatch = /^\/town\/tasks\/([^/]+)\/dispatch$/.exec(path)
      if (method === 'POST' && dispatchMatch) {
        const input = await body(req)
        const task = store.getTask(decodeURIComponent(dispatchMatch[1]))
        if (!task) throw Object.assign(new Error('task not found'), { status: 404 })
        if (input.manual_quota_override !== undefined && typeof input.manual_quota_override !== 'boolean') throw Object.assign(new Error('manual_quota_override must be a boolean'), { status: 400 })
        const agent = task.agent_id ? store.snapshot().agents.find(item => item.id === task.agent_id) : undefined
        const manualRequested = input.manual_quota_override === true
        if (manualRequested && (agent?.role !== 'orchestrator' || task.workspace_mode !== 'read_only' || task.created_by_task_id)) {
          throw Object.assign(new Error('manual quota override is limited to a root read-only orchestrator task'), { status: 403 })
        }
        const taskProfile = agent?.profile ?? profile.name
        const selected = taskProfile === profile.name ? profile : deps.profiles?.get(taskProfile ?? '')
        if (!selected) throw Object.assign(new Error('assigned profile is not available'), { status: 409 })
        const authorization = manualRequested ? { authorityTaskId: task.id, authorizedBy: user, authorizedAt: now().toISOString(), scope: 'dispatch' as const } : undefined
        const result = await dispatch(store, user, task.id, revision(input.revision), selected, agent?.role === 'orchestrator', authorization)
        send(res, 200, result); return true
      }
      if (method === 'POST' && path === '/town/messages') {
        const input = await body(req)
        const message = store.createMessage({
          project_id: string(input.project_id, 'project_id', 128), ...(input.task_id === undefined ? {} : { task_id: string(input.task_id, 'task_id', 128) }),
          from: string(input.from, 'from', 128), to: string(input.to, 'to', 128), kind: string(input.kind, 'kind', 16) as NewTownMessage['kind'],
          body: string(input.body, 'body'), options: Array.isArray(input.options) ? input.options.filter((item): item is string => typeof item === 'string').slice(0, 20) : undefined,
          artifact_ids: Array.isArray(input.artifact_ids) ? input.artifact_ids as string[] : [],
          ...(input.reply_to === undefined ? {} : { reply_to: string(input.reply_to, 'reply_to', 128) }),
          ...(input.continuation_id === undefined ? {} : { continuation_id: string(input.continuation_id, 'continuation_id', 256) }),
        }, revision(input.revision))
        send(res, 201, { message }); return true
      }
      const ackMatch = /^\/town\/messages\/([^/]+)\/ack$/.exec(path)
      if (method === 'POST' && ackMatch) {
        const input = await body(req)
        send(res, 200, { message: store.acknowledgeMessage(decodeURIComponent(ackMatch[1]), revision(input.revision)) }); return true
      }
      const answerMatch = /^\/town\/messages\/([^/]+)\/answer$/.exec(path)
      if (method === 'POST' && answerMatch) {
        const input = await body(req)
        const questionId = decodeURIComponent(answerMatch[1])
        const question = store.snapshot().messages.find(message => message.id === questionId && message.kind === 'question')
        if (!question) throw Object.assign(new Error('question not found'), { status: 404 })
        if (question.continuation_id && !deps.runtime?.answer) throw Object.assign(new Error('question continuation runtime is unavailable'), { status: 503 })
        const expectedRevision = revision(input.revision)
        if (input.manual_quota_override !== undefined && typeof input.manual_quota_override !== 'boolean') throw Object.assign(new Error('manual_quota_override must be a boolean'), { status: 400 })
        const manualRequested = input.manual_quota_override === true
        const answerBody = string(input.body, 'body')
        const priorAnswer = store.snapshot().messages.find(message => message.kind === 'answer' && message.reply_to === questionId)
        const receiptKey = `${user}:${questionId}`
        if (manualRequested) {
          if (question.revision !== expectedRevision) throw new RevisionConflictError(`town message ${questionId}`, expectedRevision, question.revision)
        } else {
          const answer = store.recordAnswer(questionId, expectedRevision, answerBody, string(input.answer_key, 'answer_key', 256))
          const present = answer.message.answer_outcome
          if (!answer.created && present) {
            send(res, 200, answerResponse(answer.message, present)); return true
          }
          const active = answerRuns.get(receiptKey)
          if (!active && !answer.created) {
            const currentTask = question.task_id ? store.getTask(question.task_id) : null
            const recovered: NonNullable<TownMessage['answer_outcome']> = currentTask?.state === 'completed'
              ? { resumed: true, state: 'completed' }
              : { resumed: false, ...(currentTask?.state ? { state: currentTask.state } : {}) }
            store.recordAnswerOutcome(answer.message.id, recovered)
            send(res, 200, answerResponse(answer.message, recovered)); return true
          }
          try {
            const pending = active ?? processAcceptedAnswer(store, user, question, answer.message, profile)
            const outcome = await pending
            const currentAnswer = store.snapshot().messages.find(message => message.id === answer.message.id && message.kind === 'answer') ?? answer.message
            const currentTask = question.task_id ? store.getTask(question.task_id) : null
            send(res, 200, answerResponse(currentAnswer, outcome, currentTask?.manual_quota_override, store.snapshot().quota)); return true
          } catch (error) { throw error }
        }
        if (priorAnswer?.answer_outcome) {
          const retryable = priorAnswer.answer_outcome.state?.startsWith('queued_') === true
          if (!retryable) throw Object.assign(new Error('manual quota answer retry requires a queued receipt'), { status: 409 })
          if (priorAnswer.body !== answerBody) throw Object.assign(new Error('manual quota answer retry must match the saved answer body'), { status: 409 })
          if (!question.continuation_id) throw Object.assign(new Error('question continuation is no longer resumable'), { status: 409 })
          const authorization = manualAnswerAuthorization(store, user, question)
          const pending = answerRuns.get(receiptKey) ?? processAcceptedAnswer(store, user, question, priorAnswer, profile, authorization, true)
          const outcome = await pending
          const currentAnswer = store.snapshot().messages.find(message => message.id === priorAnswer.id && message.kind === 'answer') ?? priorAnswer
          const currentTask = question.task_id ? store.getTask(question.task_id) : null
          send(res, 200, answerResponse(currentAnswer, outcome, currentTask?.manual_quota_override, store.snapshot().quota)); return true
        }
        const authorization = manualRequested ? manualAnswerAuthorization(store, user, question) : undefined
        const answer = store.recordAnswer(questionId, expectedRevision, answerBody, string(input.answer_key, 'answer_key', 256))
        try {
          const pending = answerRuns.get(receiptKey) ?? processAcceptedAnswer(store, user, question, answer.message, profile, authorization)
          const outcome = await pending
          const currentAnswer = store.snapshot().messages.find(message => message.id === answer.message.id && message.kind === 'answer') ?? answer.message
          const currentTask = question.task_id ? store.getTask(question.task_id) : null
          send(res, 200, answerResponse(currentAnswer, outcome, currentTask?.manual_quota_override, store.snapshot().quota)); return true
        } catch (error) { throw error }
      }
      const cancelMatch = /^\/town\/tasks\/([^/]+)\/cancel$/.exec(path)
      if (method === 'POST' && cancelMatch) {
        const input = await body(req)
        const task = store.getTask(decodeURIComponent(cancelMatch[1]))
        if (!task) throw Object.assign(new Error('task not found'), { status: 404 })
        if (task.revision !== revision(input.revision)) throw new RevisionConflictError(`town task ${task.id}`, revision(input.revision), task.revision)
        await deps.runtime?.cancel?.({ user, task, store })
        const cancelled = store.transitionTask(task.id, task.revision, 'cancelled', { terminal_evidence: 'cancelled by user' })
        for (const question of store.snapshot().messages.filter(message => message.kind === 'question' && message.task_id === task.id && message.continuation_id)) store.closeContinuation(question.id)
        send(res, 200, { task: cancelled }); return true
      }
      if (method === 'POST' && path === '/town/orchestrate') {
        const input = await body(req)
        const expected = revision(input.revision)
        if (store.cursor() !== expected) throw new RevisionConflictError('town snapshot', expected, store.cursor())
        const projectIds = Array.isArray(input.project_ids) ? input.project_ids.filter((id): id is string => typeof id === 'string') : store.snapshot().projects.map(project => project.id)
        const project = projectIds.map(id => store.getProject(id)).find(Boolean)
        if (!project) throw Object.assign(new Error('select or discover a project first'), { status: 409 })
        const instruction = string(input.instruction, 'instruction')
        const agentId = randomUUID()
        const agent = store.putAgent({ id: agentId, profile: profile.name, role: 'orchestrator', display_name: profile.name, lifecycle: 'task_bound', home_project_id: project.id, state: 'idle' })
        const task = store.createTask({ project_id: project.id, title: instruction.slice(0, 200), prompt: instruction, agent_id: agent.id, workspace_mode: 'read_only' })
        const ready = store.transitionTask(task.id, task.revision, 'ready')
        const result = await dispatch(store, user, task.id, ready.revision, profile, true)
        if (result.decision === 'started') send(res, 202, { decision: 'started', orchestrator_task: result.task, session_id: result.session_id, run_id: result.run_id })
        else send(res, 200, { decision: 'queued', orchestrator_task: result.task, reason: result.reason, quota: result.quota })
        return true
      }
      throw Object.assign(new Error('not found'), { status: 404 })
    } catch (error) {
      const result = safeError(error)
      send(res, result.status, { error: result.error, code: result.code })
      return true
    }
  }, {
    async close() {
      stopped = true
      clearInterval(queueTimer)
      await schedulerRun
    },
  })
  return handler
}
