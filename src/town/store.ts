import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { atomicWriteJson, readJson, RevisionConflictError, type VersionedRecord } from '../shared/atomic-json.js'
import { sanitizeUserId } from '../session/user-paths.js'
import { harnessStatePath } from '../config/state-paths.js'
import type {
  DispatchLease,
  QuotaSnapshot,
  TownAgent,
  TownEvent,
  TownEventPage,
  TownDiscoverySummary,
  TownMessage,
  TownProject,
  TownSettings,
  TownSnapshot,
  TownTask,
  TownTaskState,
  TownWorkspaceMode,
} from './types.js'

const DEFAULT_ROOT = resolve(homedir(), 'Desktop', 'development')
const MAX_EVENTS = 4000
const RECOVERED_FILES = new Set<string>()
const PROCESS_LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4))
const DEFAULT_LEASE_TTL_MS = 5 * 60_000

interface TownState extends VersionedRecord {
  version: 1
  settings: TownSettings
  discovery: TownDiscoverySummary | null
  projects: TownProject[]
  agents: TownAgent[]
  tasks: TownTask[]
  messages: TownMessage[]
  quota: QuotaSnapshot
  leases: DispatchLease[]
  cursor: number
  events: TownEvent[]
}

interface GlobalWorkspaceLease {
  lease_id: string
  task_id: string
  store_file: string
  project_path: string
  expires_at: string
}
interface GlobalWorkspaceState { version: 1; leases: GlobalWorkspaceLease[] }

export interface TownStoreOptions {
  /** Base directory that contains per-user Town stores. Defaults to ~/.harness/orchestrator. */
  baseDirectory?: string
  maxEvents?: number
  now?: () => Date
  /** Force restart recovery in tests or a new server process simulation. Default: once per file per process. */
  recovery?: 'once' | 'force' | 'none'
  /** Preserve a parked Town continuation only when its separate runtime records still validate. */
  canRecoverContinuation?: (task: TownTask, question: TownMessage) => boolean
}

export interface NewTownProject extends Omit<TownProject, 'id' | 'path'> { path: string; id?: string }
export interface NewTownTask extends Omit<TownTask, 'id' | 'state' | 'revision' | 'created_at' | 'updated_at' | 'depends_on'> {
  depends_on?: string[]
}
export type NewTownMessage = Omit<TownMessage, 'id' | 'state' | 'revision' | 'created_at' | 'acknowledged_at' | 'answer_key_hash' | 'artifact_ids'> & {
  artifact_ids?: string[]
}

const TRANSITIONS: Record<TownTaskState, readonly TownTaskState[]> = {
  draft: ['ready', 'cancelled'],
  ready: ['queued_quota', 'queued_dependency', 'queued_workspace', 'queued_concurrency', 'dispatching', 'cancelled'],
  queued_quota: ['ready', 'dispatching', 'running', 'failed', 'cancelled', 'interrupted'],
  queued_dependency: ['ready', 'dispatching', 'running', 'cancelled', 'interrupted'],
  queued_workspace: ['ready', 'dispatching', 'running', 'cancelled', 'interrupted'],
  queued_concurrency: ['ready', 'dispatching', 'running', 'cancelled', 'interrupted'],
  dispatching: ['running', 'failed', 'cancelled', 'interrupted'],
  running: ['waiting_user', 'blocked', 'completed', 'failed', 'cancelled', 'interrupted'],
  waiting_user: ['ready', 'running', 'queued_quota', 'blocked', 'failed', 'cancelled', 'interrupted'],
  blocked: ['ready', 'failed', 'cancelled'],
  failed: ['ready'],
  interrupted: ['ready', 'cancelled'],
  completed: [],
  cancelled: [],
}

function initialState(root = DEFAULT_ROOT): TownState {
  const now = new Date().toISOString()
  return {
    version: 1,
    revision: 0,
    updated_at: now,
    settings: { revision: 1, discovery_root: root, ignore_policy_version: 1, saved_viewpoints: [], pinned_project_ids: [] },
    discovery: null,
    projects: [],
    agents: [],
    tasks: [],
    messages: [],
    quota: { provider: 'unknown', account_scope: '', status: 'unavailable', windows: [], source: 'not checked', last_error: 'capacity has not been checked' },
    leases: [],
    cursor: 0,
    events: [],
  }
}

function clone<T>(value: T): T { return structuredClone(value) }
function messageHash(value: string): string { return createHash('sha256').update(value).digest('hex') }
function pathsOverlap(left: string, right: string): boolean {
  const a = resolve(left), b = resolve(right)
  const ab = relative(a, b), ba = relative(b, a)
  const within = (value: string) => value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value))
  return within(ab) || within(ba)
}

function withoutSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecretFields)
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) if (key !== 'answer_key_hash') output[key] = withoutSecretFields(nested)
  return output
}

function withFileLock<T>(file: string, fn: () => T): T {
  const lockPath = `${file}.lock`
  mkdirSync(dirname(file), { recursive: true })
  const started = Date.now()
  let fd: number | undefined
  let token = ''
  while (fd === undefined) {
    try {
      fd = openSync(lockPath, 'wx', 0o600)
      token = `${process.pid}:${randomUUID()}`
      writeFileSync(fd, `${token}\n${Date.now()}\n`, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const [owner] = readFileSync(lockPath, 'utf8').split('\n')
        const pid = Number(owner?.split(':')[0])
        const age = Date.now() - statSync(lockPath).mtimeMs
        let alive = false
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); alive = true } catch (probe) { alive = (probe as NodeJS.ErrnoException).code === 'EPERM' }
        }
        if (!alive || age > 60_000) { unlinkSync(lockPath); continue }
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw readError
      }
      if (Date.now() - started > 3000) throw new Error('Town store is busy; retry shortly')
      Atomics.wait(PROCESS_LOCK_WAIT, 0, 0, 10)
    }
  }
  const heldFd = fd
  try { return fn() }
  finally {
    try { closeSync(heldFd) } catch { /* retain operation outcome */ }
    try {
      const [owner] = readFileSync(lockPath, 'utf8').split('\n')
      if (owner === token) unlinkSync(lockPath)
    } catch { /* a stale-lock repair may already have removed it */ }
  }
}

/** Per-user durable state for the Orchestrator Town. Mutations replace one atomic JSON snapshot. */
export class TownStore {
  readonly user: string
  readonly file: string
  private readonly globalLeaseFile: string
  private readonly maxEvents: number
  private readonly now: () => Date
  private readonly canRecoverContinuation?: TownStoreOptions['canRecoverContinuation']

  constructor(user: string, options: TownStoreOptions = {}) {
    this.user = sanitizeUserId(user)
    this.maxEvents = Math.max(10, Math.floor(options.maxEvents ?? MAX_EVENTS))
    this.now = options.now ?? (() => new Date())
    this.canRecoverContinuation = options.canRecoverContinuation
    const base = options.baseDirectory ?? harnessStatePath('orchestrator')
    this.file = join(base, this.user, 'state.json')
    this.globalLeaseFile = join(base, '.workspace-leases.json')
    withFileLock(this.file, () => {
      if (!existsSync(this.file)) atomicWriteJson(this.file, initialState())
      if (options.recovery === 'none' || (options.recovery !== 'force' && RECOVERED_FILES.has(this.file))) return
      this.recoverInterruptedWorkLocked()
      RECOVERED_FILES.add(this.file)
    })
  }

  private read(): TownState { return readJson<TownState>(this.file) }

  private readGlobalLeases(): GlobalWorkspaceLease[] {
    if (!existsSync(this.globalLeaseFile)) return []
    const state = readJson<GlobalWorkspaceState>(this.globalLeaseFile)
    if (state.version !== 1 || !Array.isArray(state.leases)) throw new Error(`invalid Town workspace lease registry: ${this.globalLeaseFile}`)
    return state.leases
  }

  private globalLeaseIsActive(lease: GlobalWorkspaceLease, now: number): boolean {
    if (!Number.isFinite(Date.parse(lease.expires_at)) || Date.parse(lease.expires_at) <= now) return false
    if (!existsSync(lease.store_file)) return false
    const owner = readJson<TownState>(lease.store_file)
    return owner.leases.some(item => item.id === lease.lease_id && Date.parse(item.expires_at) > now)
  }

  private writeGlobalLeases(leases: GlobalWorkspaceLease[]): void {
    atomicWriteJson(this.globalLeaseFile, { version: 1, leases } satisfies GlobalWorkspaceState, { mode: 0o600 })
  }

  private mutate<T>(change: (state: TownState) => T): T {
    return withFileLock(this.file, () => {
      const state = this.read()
      const result = change(state)
      state.revision += 1
      state.updated_at = this.now().toISOString()
      atomicWriteJson(this.file, state, { mode: 0o600 })
      return clone(result)
    })
  }

  private event(state: TownState, type: string, data: unknown): TownEvent {
    const item = { cursor: state.cursor + 1, type, occurred_at: this.now().toISOString(), data: clone(withoutSecretFields(data)) }
    state.cursor = item.cursor
    state.events.push(item)
    if (state.events.length > this.maxEvents) state.events.splice(0, state.events.length - this.maxEvents)
    return item
  }

  private recoverInterruptedWorkLocked(): void {
    const state = this.read()
    const queuedContinuations = new Set(state.messages.filter(message => message.kind === 'answer' && message.answer_outcome?.state?.startsWith('queued_')).map(message => message.task_id).filter((id): id is string => Boolean(id)))
    const parked = state.tasks.filter(task => task.state === 'waiting_user' || (task.state.startsWith('queued_') && queuedContinuations.has(task.id)))
    const recoverable = new Set<string>()
    for (const task of parked) {
      const questions = state.messages.filter(message => message.task_id === task.id && message.kind === 'question' && message.continuation_id && message.thread_id === task.session_id)
      if (questions.length !== 1 || !this.canRecoverContinuation) continue
      const question = questions[0]
      if (task.state.startsWith('queued_') && !state.messages.some(message => message.kind === 'answer' && message.task_id === task.id && message.reply_to === question.id && message.answer_outcome?.state?.startsWith('queued_'))) continue
      try {
        if (this.canRecoverContinuation(task, question)) recoverable.add(task.id)
      } catch {
        // Separate run, pending-input, and session stores are untrusted at recovery.
        // A failed or throwing validator must never restore continuation authority.
      }
    }
    const interrupted = state.tasks.filter(task => task.state === 'dispatching' || task.state === 'running' || ((task.state === 'waiting_user' || (task.state.startsWith('queued_') && queuedContinuations.has(task.id))) && !recoverable.has(task.id)))
    if (!interrupted.length && state.leases.length === 0) return
    for (const task of interrupted) {
      task.state = 'interrupted'
      task.revision += 1
      task.updated_at = this.now().toISOString()
      task.terminal_evidence = 'server restarted; execution authority was discarded'
      for (const question of state.messages) {
        if (question.task_id !== task.id || question.kind !== 'question' || !question.continuation_id) continue
        question.continuation_id = undefined
        question.state = 'acknowledged'
        question.revision += 1
        question.acknowledged_at ??= this.now().toISOString()
        this.event(state, 'continuation.closed', { question_id: question.id, reason: 'server restarted' })
      }
    this.event(state, 'task.interrupted', { task_id: task.id, revision: task.revision, reason: task.terminal_evidence })
    }
    for (const taskId of recoverable) this.event(state, 'continuation.recovered', { task_id: taskId, reason: 'durable parked continuation validated; explicit answer required' })
    state.leases = []
    state.revision += 1
    state.updated_at = this.now().toISOString()
    atomicWriteJson(this.file, state, { mode: 0o600 })
  }

  revision(): number { return this.read().revision }
  cursor(): number { return this.read().cursor }

  settings(): TownSettings { return clone(this.read().settings) }

  recordDiscovery(summary: TownDiscoverySummary): TownDiscoverySummary {
    return this.mutate(state => {
      state.discovery = clone(summary)
      this.event(state, 'discovery.completed', summary)
      return summary
    })
  }

  updateSettings(expectedRevision: number, patch: Partial<Pick<TownSettings, 'discovery_root' | 'saved_viewpoints' | 'pinned_project_ids'>>): TownSettings {
    return this.mutate(state => {
      if (state.settings.revision !== expectedRevision) throw new RevisionConflictError(`${this.file}:settings`, expectedRevision, state.settings.revision)
      const next = { ...state.settings, ...clone(patch), revision: state.settings.revision + 1 }
      if (patch.discovery_root !== undefined && !isAbsolute(patch.discovery_root)) throw new Error('discovery root must be an absolute path')
      if (patch.pinned_project_ids) {
        const known = new Set(state.projects.map(project => project.id))
        if (patch.pinned_project_ids.some(id => !known.has(id))) throw new Error('pinned project not found')
      }
      state.settings = next
      this.event(state, 'settings.updated', next)
      return next
    })
  }

  putProject(input: NewTownProject): TownProject {
    const path = resolve(input.path)
    return this.mutate(state => {
      const existing = state.projects.find(project => project.path === path)
      const project: TownProject = { ...clone(input), id: existing?.id ?? input.id ?? randomUUID(), path }
      const index = existing ? state.projects.indexOf(existing) : -1
      if (index >= 0) state.projects[index] = project
      else state.projects.push(project)
      this.event(state, existing ? 'project.updated' : 'project.discovered', project)
      return project
    })
  }

  putProjects(inputs: NewTownProject[]): TownProject[] {
    const output: TownProject[] = []
    for (const project of inputs) output.push(this.putProject(project))
    return output
  }

  getProject(id: string): TownProject | null {
    const project = this.read().projects.find(item => item.id === id)
    return project ? clone(project) : null
  }

  putAgent(input: TownAgent): TownAgent {
    return this.mutate(state => {
      const index = state.agents.findIndex(agent => agent.id === input.id)
      if (index < 0) state.agents.push(clone(input))
      else state.agents[index] = clone(input)
      this.event(state, 'agent.updated', input)
      return input
    })
  }

  /** Throttled live-activity marker; never changes agent state or task ownership. */
  recordAgentActivity(id: string, tool: string): void {
    this.mutate(state => {
      const agent = state.agents.find(item => item.id === id)
      if (!agent) return
      agent.last_activity_at = this.now().toISOString()
      agent.last_tool = tool.slice(0, 80)
      this.event(state, 'agent.activity', { agent_id: id, last_activity_at: agent.last_activity_at, last_tool: agent.last_tool })
    })
  }

  createTask(input: NewTownTask, expectedCursor?: number): TownTask {
    return this.mutate(state => {
      if (expectedCursor !== undefined && expectedCursor !== state.cursor) throw new RevisionConflictError(`${this.file}:cursor`, expectedCursor, state.cursor)
      if (!state.projects.some(project => project.id === input.project_id)) throw new Error('project not found')
      if (input.agent_id && !state.agents.some(agent => agent.id === input.agent_id)) throw new Error('agent not found')
      const dependencies = input.depends_on ?? []
      if (dependencies.some(id => !state.tasks.some(task => task.id === id))) throw new Error('task dependency not found')
      const now = this.now().toISOString()
      const task: TownTask = { ...clone(input), id: randomUUID(), state: 'draft', revision: 1, depends_on: [...dependencies], created_at: now, updated_at: now }
      state.tasks.push(task)
      this.event(state, 'task.created', task)
      return task
    })
  }

  getTask(id: string): TownTask | null {
    const task = this.read().tasks.find(item => item.id === id)
    return task ? clone(task) : null
  }

  recordManualQuotaOverride(id: string, expectedRevision: number, audit: TownTask['manual_quota_override']): TownTask {
    if (!audit) throw new Error('manual quota override audit is required')
    return this.mutate(state => {
      const task = state.tasks.find(item => item.id === id)
      if (!task) throw new Error('task not found')
      if (task.revision !== expectedRevision) throw new RevisionConflictError(`${this.file}:task:${id}`, expectedRevision, task.revision)
      task.manual_quota_override = clone(audit)
      task.revision += 1
      task.updated_at = this.now().toISOString()
      this.event(state, 'task.manual_quota_override', { task_id: task.id, revision: task.revision, audit: task.manual_quota_override })
      return task
    })
  }

  assignTask(id: string, expectedRevision: number, agentId: string): TownTask {
    return this.mutate(state => {
      const task = state.tasks.find(item => item.id === id)
      if (!task) throw new Error('task not found')
      if (task.revision !== expectedRevision) throw new RevisionConflictError(`${this.file}:task:${id}`, expectedRevision, task.revision)
      if (!state.agents.some(agent => agent.id === agentId)) throw new Error('agent not found')
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(task.state)) throw new Error('cannot assign a terminal task')
      task.agent_id = agentId
      task.revision += 1
      task.updated_at = this.now().toISOString()
      this.event(state, 'task.assigned', task)
      return task
    })
  }

  transitionTask(id: string, expectedRevision: number, to: TownTaskState, patch: Partial<Pick<TownTask, 'agent_id' | 'session_id' | 'run_id' | 'block_reason' | 'terminal_evidence'>> = {}): TownTask {
    return withFileLock(this.globalLeaseFile, () => {
      const result = this.mutate(state => {
      const task = state.tasks.find(item => item.id === id)
      if (!task) throw new Error('task not found')
      if (task.revision !== expectedRevision) throw new RevisionConflictError(`${this.file}:task:${id}`, expectedRevision, task.revision)
      if (!TRANSITIONS[task.state].includes(to)) throw new Error(`invalid task transition: ${task.state} -> ${to}`)
      if (to === 'running' && (!patch.session_id || !patch.run_id)) throw new Error('running task requires session_id and run_id')
      task.state = to
      task.revision += 1
      task.updated_at = this.now().toISOString()
      if (to === 'dispatching' || to === 'running') task.block_reason = undefined
      Object.assign(task, clone(patch))
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(to)) task.terminal_evidence ??= patch.terminal_evidence ?? `explicit transition to ${to}`
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(to)) state.leases = state.leases.filter(lease => lease.task_id !== id)
      this.event(state, 'task.transitioned', task)
        return task
      })
      const now = this.now().getTime()
      this.writeGlobalLeases(this.readGlobalLeases().filter(lease => this.globalLeaseIsActive(lease, now) && lease.task_id !== id))
      return result
    })
  }

  markRunning(id: string, expectedRevision: number, sessionId: string, runId: string): TownTask {
    return this.mutate(state => {
      const task = state.tasks.find(item => item.id === id)
      if (!task) throw new Error('task not found')
      if (task.revision !== expectedRevision) throw new RevisionConflictError(`${this.file}:task:${id}`, expectedRevision, task.revision)
      if (task.state !== 'dispatching') throw new Error(`invalid task transition: ${task.state} -> running`)
      task.state = 'running'
      task.session_id = sessionId
      task.run_id = runId
      task.revision += 1
      task.updated_at = this.now().toISOString()
      const providerLease = state.leases.find(item => item.task_id === task.id && item.kind === 'dispatch')
      if (!providerLease) throw new Error('dispatch lease expired before runtime became active')
      if (task.workspace_mode === 'shared_checkout' && !state.leases.some(item => item.task_id === task.id && item.kind === 'workspace')) {
        state.leases.push({ ...providerLease, id: randomUUID(), kind: 'workspace', acquired_at: this.now().toISOString() })
      }
      this.event(state, 'task.transitioned', task)
      return task
    })
  }

  createMessage(input: NewTownMessage, expectedCursor?: number): TownMessage {
    return this.mutate(state => {
      if (expectedCursor !== undefined && expectedCursor !== state.cursor) throw new RevisionConflictError(`${this.file}:cursor`, expectedCursor, state.cursor)
      if (!state.projects.some(project => project.id === input.project_id)) throw new Error('project not found')
      if (input.task_id && !state.tasks.some(task => task.id === input.task_id && task.project_id === input.project_id)) throw new Error('task not found')
      if (input.reply_to && !state.messages.some(message => message.id === input.reply_to && message.project_id === input.project_id)) throw new Error('reply target not found')
      if (input.kind === 'answer' && !input.reply_to) throw new Error('answer requires reply_to')
      const message: TownMessage = { ...clone(input), id: randomUUID(), artifact_ids: [...(input.artifact_ids ?? [])], state: 'delivered', revision: 1, created_at: this.now().toISOString() }
      state.messages.push(message)
      this.event(state, 'message.created', message)
      return message
    })
  }

  acknowledgeMessage(id: string, expectedRevision: number): TownMessage {
    return this.mutate(state => {
      const message = state.messages.find(item => item.id === id)
      if (!message) throw new Error('message not found')
      if (message.revision !== expectedRevision) throw new RevisionConflictError(`${this.file}:message:${id}`, expectedRevision, message.revision)
      if (message.state !== 'acknowledged') {
        message.state = 'acknowledged'
        message.acknowledged_at = this.now().toISOString()
        message.revision += 1
        this.event(state, 'message.acknowledged', message)
      }
      return message
    })
  }

  readWorkerInbox(taskId: string, agentId: string): TownMessage[] {
    return this.mutate(state => {
      const now = this.now().toISOString()
      const inbox = state.messages.filter(message => message.task_id === taskId && message.state === 'delivered' && (message.kind === 'status' || message.kind === 'handoff') && (message.to === agentId || message.to === 'worker'))
      for (const message of inbox) {
        message.state = 'acknowledged'
        message.acknowledged_at = now
        message.revision += 1
        this.event(state, 'message.acknowledged', message)
      }
      return inbox
    })
  }

  recordAnswer(questionId: string, expectedRevision: number, body: string, answerKey: string): { message: TownMessage; created: boolean } {
    return this.mutate(state => {
      const question = state.messages.find(item => item.id === questionId)
      if (!question || question.kind !== 'question') throw new Error('question not found')
      const keyHash = messageHash(answerKey)
      const prior = state.messages.find(item => item.kind === 'answer' && item.reply_to === questionId)
      if (prior) {
        if (question.answer_key_hash !== keyHash) throw new Error('question already answered')
        return { message: prior, created: false }
      }
      if (question.revision !== expectedRevision) throw new RevisionConflictError(`${this.file}:message:${questionId}`, expectedRevision, question.revision)
      if (!question.continuation_id) throw new Error('question has no live continuation')
      if (question.state !== 'delivered') throw new Error('question continuation is closed')
      const now = this.now().toISOString()
      question.answer_key_hash = keyHash
      question.state = 'acknowledged'
      question.acknowledged_at = now
      question.revision += 1
      const answer: TownMessage = {
        id: randomUUID(), project_id: question.project_id, task_id: question.task_id, thread_id: question.thread_id,
        from: 'user', to: question.from, kind: 'answer', body, artifact_ids: [], reply_to: question.id,
        state: 'delivered', revision: 1, created_at: now,
      }
      state.messages.push(answer)
      this.event(state, 'message.answered', { question, answer })
      return { message: answer, created: true }
    })
  }

  recordAnswerOutcome(answerId: string, outcome: NonNullable<TownMessage['answer_outcome']>): TownMessage {
    return this.mutate(state => {
      const answer = state.messages.find(item => item.id === answerId && item.kind === 'answer')
      if (!answer) throw new Error('answer message not found')
      if (answer.answer_outcome) return answer
      answer.answer_outcome = clone(outcome)
      answer.revision += 1
      this.event(state, 'message.answer_outcome', answer)
      return answer
    })
  }

  /** Replace a queued answer receipt after an explicit retry of its original answer. */
  recordAnswerResumeOutcome(answerId: string, outcome: NonNullable<TownMessage['answer_outcome']>): TownMessage {
    return this.mutate(state => {
      const answer = state.messages.find(item => item.id === answerId && item.kind === 'answer')
      if (!answer) throw new Error('answer message not found')
      if (!answer.answer_outcome?.state?.startsWith('queued_')) throw new Error('answer receipt is not queued for retry')
      answer.answer_outcome = clone(outcome)
      answer.revision += 1
      this.event(state, 'message.answer_resume_outcome', answer)
      return answer
    })
  }

  closeContinuation(questionId: string): void {
    this.mutate(state => {
      const question = state.messages.find(item => item.id === questionId && item.kind === 'question')
      if (!question?.continuation_id) return
      question.continuation_id = undefined
      question.revision += 1
      question.state = 'acknowledged'
      question.acknowledged_at ??= this.now().toISOString()
      this.event(state, 'continuation.closed', { question_id: questionId })
    })
  }

  setQuota(snapshot: QuotaSnapshot): QuotaSnapshot {
    const next = this.mutate(state => {
      state.quota = clone(snapshot)
      this.event(state, 'quota.updated', snapshot)
      return state.quota
    })
    return next
  }

  activeLeases(): DispatchLease[] { return clone(this.read().leases.filter(lease => Date.parse(lease.expires_at) > this.now().getTime())) }

  acquireLease(taskId: string, provider: string, accountScope: string, ttlMs = DEFAULT_LEASE_TTL_MS): { lease?: DispatchLease; reason?: 'workspace' | 'concurrency' } {
    return withFileLock(this.globalLeaseFile, () => {
      const nowMs = this.now().getTime()
      let global = this.readGlobalLeases().filter(lease => this.globalLeaseIsActive(lease, nowMs))
      const taskBefore = this.getTask(taskId)
      if (!taskBefore) throw new Error('task not found')
      const projectBefore = this.getProject(taskBefore.project_id)
      if (!projectBefore) throw new Error('project not found')
      if (taskBefore.workspace_mode === 'shared_checkout' && global.some(lease => lease.task_id !== taskId && pathsOverlap(projectBefore.path, lease.project_path))) {
        this.writeGlobalLeases(global)
        return { reason: 'workspace' as const }
      }
      const result = this.mutate(state => {
      const task = state.tasks.find(item => item.id === taskId)
      if (!task) throw new Error('task not found')
      const now = this.now()
      state.leases = state.leases.filter(lease => Date.parse(lease.expires_at) > now.getTime())
      const requestedRole = state.agents.find(agent => agent.id === task.agent_id)?.role
      const conflictingDispatch = state.leases.some(lease => {
        if (lease.kind !== 'dispatch' || lease.provider !== provider || lease.account_scope !== accountScope) return false
        const owner = state.tasks.find(item => item.id === lease.task_id)
        const ownerRole = state.agents.find(agent => agent.id === owner?.agent_id)?.role
        // A coordinator must be able to start one worker while it remains live;
        // other workers still serialize against each other on the same account.
        return !(requestedRole === 'worker' && ownerRole === 'orchestrator')
      })
      if (conflictingDispatch) return { reason: 'concurrency' as const }
      if (task.workspace_mode === 'isolated_worktree') return { reason: 'workspace' as const }
      if (task.workspace_mode === 'shared_checkout') {
        const project = state.projects.find(item => item.id === task.project_id)
        if (!project) throw new Error('project not found')
        const conflict = state.leases.some(lease => lease.task_id !== task.id && lease.workspace_mode === 'shared_checkout' && state.projects.some(item => item.id === lease.project_id && pathsOverlap(project.path, item.path)))
        if (conflict) return { reason: 'workspace' as const }
      }
      const lease: DispatchLease = {
        id: randomUUID(), kind: 'dispatch', task_id: task.id, project_id: task.project_id, provider, account_scope: accountScope,
        workspace_mode: task.workspace_mode, acquired_at: now.toISOString(), expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      }
      state.leases.push(lease)
      this.event(state, 'dispatch.lease_acquired', lease)
      return { lease }
      })
      if (result.lease && taskBefore.workspace_mode === 'shared_checkout') {
        global.push({ lease_id: result.lease.id, task_id: result.lease.task_id, store_file: this.file, project_path: projectBefore.path, expires_at: result.lease.expires_at })
      }
      this.writeGlobalLeases(global)
      return result
    })
  }

  renewLeases(taskId: string, ttlMs = DEFAULT_LEASE_TTL_MS): boolean {
    return withFileLock(this.globalLeaseFile, () => {
      const now = this.now()
      const current = this.read().leases.filter(lease => lease.task_id === taskId)
      if (current.length === 0 || current.some(lease => Date.parse(lease.expires_at) <= now.getTime())) return false
      const updated = this.mutate(state => {
        const leases = state.leases.filter(lease => lease.task_id === taskId)
        if (leases.length === 0) return false
        for (const lease of leases) lease.expires_at = new Date(now.getTime() + ttlMs).toISOString()
        this.event(state, 'dispatch.lease_renewed', { task_id: taskId, expires_at: leases[0].expires_at })
        return true
      })
      if (updated) {
        const nowMs = now.getTime()
        const global = this.readGlobalLeases().filter(lease => this.globalLeaseIsActive(lease, nowMs))
        const dispatch = this.read().leases.find(lease => lease.task_id === taskId && lease.kind === 'dispatch')
        if (dispatch) for (const lease of global) if (lease.lease_id === dispatch.id) lease.expires_at = dispatch.expires_at
        this.writeGlobalLeases(global)
      }
      return updated
    })
  }

  releaseLease(taskId: string, reason: string): void {
    withFileLock(this.globalLeaseFile, () => {
    this.mutate(state => {
      const leases = state.leases.filter(lease => lease.task_id === taskId)
      state.leases = state.leases.filter(lease => lease.task_id !== taskId)
      for (const lease of leases) this.event(state, 'dispatch.lease_released', { ...lease, release_reason: reason })
    })
      const now = this.now().getTime()
      this.writeGlobalLeases(this.readGlobalLeases().filter(lease => this.globalLeaseIsActive(lease, now) && lease.task_id !== taskId))
    })
  }

  events(after = 0): TownEventPage {
    const state = this.read()
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('invalid town cursor')
    const oldest = state.events[0]?.cursor ?? state.cursor + 1
    if (after > state.cursor || after < oldest - 1) return { cursor: state.cursor, events: [], resync: true }
    return { cursor: state.cursor, events: clone(state.events.filter(event => event.cursor > after)) }
  }

  snapshot(resync = false): TownSnapshot {
    const state = this.read()
    return {
      cursor: state.cursor,
      generated_at: this.now().toISOString(),
      ...(resync ? { resync: true } : {}),
      settings: clone(state.settings), projects: clone(state.projects), agents: clone(state.agents),
      discovery: state.discovery ?? null,
      tasks: clone(state.tasks), messages: clone(withoutSecretFields(state.messages) as TownMessage[]), quota: clone(state.quota),
    }
  }
}

export function defaultTownRoot(): string { return DEFAULT_ROOT }

export function townStoreDirectory(user: string, baseDirectory = harnessStatePath('orchestrator')): string {
  return join(baseDirectory, sanitizeUserId(user))
}
