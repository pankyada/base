import { randomUUID } from 'node:crypto'
import type { Profile } from '../profiles/schema.js'
import { createSession, loadSession, saveSession } from '../session/store.js'
import { runProfileOnce } from '../server/run-profile.js'
import type { RunStore } from '../runs/store.js'
import type { PendingInput, PendingStore } from '../runs/pending.js'
import { isParkSignal, ParkSignal } from '../runs/park.js'
import { resumePendingInput } from '../runs/resume.js'
import type { AgentLoopEvents, ToolDefinition } from '../tools/types.js'
import type { ProviderClient } from '../provider/types.js'
import type { TownDispatchWorker, TownRuntimeStart } from './http.js'
import type { TownMessage, TownProject, TownTask } from './types.js'
import type { TownStore } from './store.js'

const TOWN_TOOLS = ['TownRead', 'TownCreateTask', 'TownAssign', 'TownPost', 'TownAsk', 'TownDispatch'] as const
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'TownRead', 'TownPost', 'TownAsk'] as const
const ORCHESTRATOR_PROMPT = `\n\nYou are coordinating real work through the Orchestrator Town. First call TownRead to inspect the selected project and current work. Break the user's instruction into concrete tasks only when needed. Create each task with TownCreateTask, assign it to an agent with TownAssign, and start it only with TownDispatch. Dispatch performs authoritative quota, dependency, concurrency, and workspace checks; a queued result is not a started worker. Use TownPost for durable progress and TownAsk when a human decision blocks the plan. Report only evidence returned by real tools. Do not invent work, pretend a queued task started, or claim success before worker evidence arrives.`
const MANUAL_ORCHESTRATOR_PROMPT = `${ORCHESTRATOR_PROMPT}\n\nThe user explicitly authorized this root task to make one manual attempt despite the provider quota status shown by TownRead. Keep the quota status and source truthful; do not describe it as available or reserved. For the requested code work, create a direct child task with TownCreateTask, assign a coding worker, then call TownDispatch. Core applies this task-scoped authorization only to that direct child and continues enforcing the other gates. Do not claim quota is why you cannot start this authorized attempt. If TownDispatch returns queued for another gate, report that result accurately.`

function workerContextPrompt(projectPath: string): string {
  return `\n\nTown worker environment: host platform is ${process.platform}; the exact project root is ${JSON.stringify(projectPath)}. Resolve project files from that root and use available tools to verify any requested path before claiming it exists.`
}

export interface TownRuntimeOptions {
  profiles?: Map<string, Profile>
  runStore: RunStore
  pendingStore: PendingStore
  abortRegistry: Map<string, AbortController>
  channelsForProfile?: (profile: Profile) => import('../channels/runtime.js').ChannelRuntime | undefined
  /** Optional per-profile provider injection for deterministic runtime tests. */
  providerForProfile?: (profile: Profile) => ProviderClient
}

function scopedProfile(profile: Profile, workingDirectory: string, restricted = false): Profile {
  return {
    ...profile,
    working_dir: workingDirectory,
    tools: {
      ...profile.tools,
      builtin: { ...profile.tools.builtin, ...Object.fromEntries(TOWN_TOOLS.map(name => [name, 'allow'])) },
      // Restricted orchestration/read-only runs never load ambient MCP clients.
      mcp_servers: restricted ? [] : profile.tools.mcp_servers,
    },
    ...(restricted ? { hooks: { ...profile.hooks, pre_tool: [], post_tool: [], on_stop: [] }, agents: [], workflow: undefined } : {}),
  }
}

function objectInput(input: Record<string, unknown>, field: string): string {
  const value = input[field]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function serialize(value: unknown): string { return JSON.stringify(value, null, 2) }

function makeTownTools(input: {
  user: string; task: TownTask; project: TownProject; store: TownStore; pendingStore: PendingStore;
  profile: Profile; runId: string; sessionId: string; dispatchWorker: TownDispatchWorker
  configuredProfiles: Set<string>
}): ToolDefinition[] {
  const { user, task, project, store, pendingStore, profile, runId, sessionId, dispatchWorker, configuredProfiles } = input
  const identity = () => {
    const current = store.getTask(task.id)
    return current?.agent_id ? store.snapshot().agents.find(agent => agent.id === current.agent_id)?.display_name ?? profile.name : profile.name
  }
  const createQuestion = (prompt: string, kind: 'text' | 'select' | 'multi_select', options: string[] | undefined, toolCallId: string, purpose: 'ask' | 'approval' = 'ask', toolName?: string, toolInput?: Record<string, unknown>) => {
    const created = new Date()
    const pending = pendingStore.create({
      id: randomUUID().replace(/-/g, '').slice(0, 12), run_id: runId, session_id: sessionId, user,
      profile: profile.name, prompt, kind, options, tool_call_id: toolCallId, purpose,
      ...(toolName ? { tool_name: toolName } : {}), ...(toolInput ? { tool_input: toolInput } : {}),
      created_at: created.toISOString(), expires_at: new Date(created.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    })
    store.createMessage({ project_id: project.id, task_id: task.id, thread_id: sessionId, from: identity(), to: 'user', kind: 'question', body: prompt, options, artifact_ids: [], continuation_id: pending.id })
    throw new ParkSignal(pending.id)
  }
  const read: ToolDefinition = {
    name: 'TownRead', description: 'Read current discovered projects, your task, queued work, agent states, and open questions.',
    parameters: { type: 'object', properties: { project_id: { type: 'string' } } },
    async execute(args) {
      const snapshot = store.snapshot()
      const currentTask = store.getTask(task.id)
      const inbox = store.readWorkerInbox(task.id, currentTask?.agent_id ?? '__unassigned__')
      const selectedProject = typeof args.project_id === 'string' ? store.getProject(args.project_id) : project
      return serialize({
        selected_project: selectedProject,
        projects: snapshot.projects.map(item => ({ id: item.id, name: item.display.name, path: item.path, git: item.git })),
        tasks: snapshot.tasks.map(item => ({ id: item.id, project_id: item.project_id, title: item.title, state: item.state, workspace_mode: item.workspace_mode, depends_on: item.depends_on, agent_id: item.agent_id, run_id: item.run_id, block_reason: item.block_reason })),
        agents: snapshot.agents,
        open_questions: snapshot.messages.filter(item => item.kind === 'question' && item.state === 'delivered').map(({ id, project_id, task_id, body, from }) => ({ id, project_id, task_id, body, from })),
        incoming_messages: inbox.map(({ id, from, body, kind, created_at }) => ({ id, from, body, kind, created_at })),
        quota: snapshot.quota,
      })
    },
  }
  const post: ToolDefinition = {
    name: 'TownPost', description: 'Post a durable status update or handoff to a project or worker.',
    parameters: { type: 'object', properties: { body: { type: 'string' }, kind: { type: 'string', enum: ['status', 'handoff'] }, to: { type: 'string' }, task_id: { type: 'string' } }, required: ['body'] },
    async execute(args) {
      const body = objectInput(args, 'body')
      const kind = args.kind === 'handoff' ? 'handoff' : 'status'
      const message = store.createMessage({ project_id: project.id, task_id: typeof args.task_id === 'string' ? args.task_id : task.id, thread_id: sessionId, from: identity(), to: typeof args.to === 'string' ? args.to : 'user', kind, body, artifact_ids: [] })
      return serialize({ posted: true, message_id: message.id, kind: message.kind })
    },
  }
  const ask: ToolDefinition = {
    name: 'TownAsk', description: 'Ask the user a blocking question; this pauses the worker and resumes the same run after an answer.',
    parameters: { type: 'object', properties: { prompt: { type: 'string' }, kind: { type: 'string', enum: ['text', 'select', 'multi_select'] }, options: { type: 'array', items: { type: 'string' } } }, required: ['prompt'] },
    async execute(args, context) {
      const prompt = objectInput(args, 'prompt')
      const kind = args.kind === 'select' || args.kind === 'multi_select' ? args.kind : 'text'
      const options = Array.isArray(args.options) ? args.options.filter((item): item is string => typeof item === 'string').slice(0, 20) : undefined
      createQuestion(prompt, kind, options, context.currentToolCallId ?? randomUUID().slice(0, 8))
      return '[question accepted]'
    },
  }
  const create: ToolDefinition = {
    name: 'TownCreateTask', description: 'Create a durable work order for a discovered project.',
    parameters: { type: 'object', properties: { project_id: { type: 'string' }, title: { type: 'string' }, prompt: { type: 'string' }, workspace_mode: { type: 'string', enum: ['read_only', 'shared_checkout', 'isolated_worktree'] }, depends_on: { type: 'array', items: { type: 'string' } } }, required: ['title', 'prompt'] },
    async execute(args) {
      const targetProject = typeof args.project_id === 'string' ? args.project_id : project.id
      const created = store.createTask({
        project_id: targetProject, title: objectInput(args, 'title').slice(0, 200), prompt: objectInput(args, 'prompt'),
        created_by_task_id: task.id,
        workspace_mode: args.workspace_mode === 'read_only' || args.workspace_mode === 'isolated_worktree' ? args.workspace_mode : 'shared_checkout',
        depends_on: Array.isArray(args.depends_on) ? args.depends_on.filter((item): item is string => typeof item === 'string') : [],
      })
      return serialize({ task_id: created.id, state: created.state, revision: created.revision })
    },
  }
  const assign: ToolDefinition = {
    name: 'TownAssign', description: 'Assign a durable task to a configured Base profile as a task-bound agent.',
    parameters: { type: 'object', properties: { task_id: { type: 'string' }, profile: { type: 'string' }, display_name: { type: 'string' } }, required: ['task_id'] },
    async execute(args) {
      const taskId = objectInput(args, 'task_id'), target = store.getTask(taskId)
      if (!target) throw new Error('task not found')
      const agentProfile = typeof args.profile === 'string' ? args.profile : profile.name
      if (agentProfile !== profile.name && !configuredProfiles.has(agentProfile)) throw new Error('agent profile is not configured')
      const agent = store.putAgent({ id: randomUUID(), profile: agentProfile, role: 'worker', display_name: typeof args.display_name === 'string' ? args.display_name.slice(0, 80) : agentProfile, lifecycle: 'task_bound', home_project_id: target.project_id, state: 'idle', task_id: target.id })
      const assigned = store.assignTask(target.id, target.revision, agent.id)
      return serialize({ task_id: assigned.id, agent_id: agent.id, profile: agent.profile, state: assigned.state })
    },
  }
  const dispatch: ToolDefinition = {
    name: 'TownDispatch', description: 'Request a real worker start. The Core enforces fresh quota, dependency, concurrency, and workspace gates.',
    parameters: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    async execute(args) { return serialize(await dispatchWorker(objectInput(args, 'task_id'))) },
  }
  // The configured profile list is read at definition time, not from global tools.
  return [read, create, assign, post, ask, dispatch]
}

export function createTownRuntime(options: TownRuntimeOptions): TownRuntimeStart {
  const configuredProfiles = new Set(options.profiles?.keys() ?? [])
  const dispatchers = new Map<string, TownDispatchWorker>()
  const leaseRenewers = new Map<string, ReturnType<typeof setInterval>>()
  const channels = (profile: Profile) => options.channelsForProfile?.(profile)
  const eventsFor = (user: string, task: TownTask, store: TownStore, profile: Profile, runId: string, sessionId: string): AgentLoopEvents => ({
    onToken() {}, onToolStart() {}, onToolEnd() {}, onSessionEnd() {}, onStats() {},
    onToolPrompt: async (toolCallId, name, toolInput, risk, reason) => {
      const detail = `${JSON.stringify(toolInput).slice(0, 500)}${risk ? `\nRisk: ${risk}.` : ''}${reason ? ` ${reason}` : ''}`
      const question = `${name} needs approval for task “${task.title}”.\n${detail}\nReply “allow” or “deny”.`
      const created = new Date()
      const pending = options.pendingStore.create({ id: randomUUID().replace(/-/g, '').slice(0, 12), run_id: runId, session_id: sessionId, user, profile: profile.name, prompt: question, kind: 'select', options: ['allow', 'deny'], tool_call_id: toolCallId, purpose: 'approval', tool_name: name, tool_input: toolInput, is_mcp: name.includes('__'), created_at: created.toISOString(), expires_at: new Date(created.getTime() + 24 * 60 * 60 * 1000).toISOString() })
      const agent = task.agent_id ? store.snapshot().agents.find(item => item.id === task.agent_id)?.display_name : profile.name
      store.createMessage({ project_id: task.project_id, task_id: task.id, thread_id: sessionId, from: agent ?? profile.name, to: 'user', kind: 'question', body: question, options: ['allow', 'deny'], artifact_ids: [], continuation_id: pending.id })
      throw new ParkSignal(pending.id)
    },
  })
  const runProfileOptions = (input: { user: string; task: TownTask; project: TownProject; store: TownStore; profile: Profile; runId: string; sessionId: string; dispatchWorker: TownDispatchWorker; manualQuotaOverrideAuthorized?: boolean }) => {
    const agent = input.task.agent_id ? input.store.snapshot().agents.find(item => item.id === input.task.agent_id) : undefined
    const orchestrator = agent?.role === 'orchestrator'
    const profile = scopedProfile(input.profile, input.project.path, orchestrator || input.task.workspace_mode === 'read_only')
    return {
      profile,
      ...(options.providerForProfile ? { provider: options.providerForProfile(profile) } : {}),
      userId: input.user,
      userMessage: input.task.prompt,
      runId: input.runId,
      onSessionCreated: (sessionId: string) => options.runStore.update(input.runId, { session_id: sessionId }),
      events: eventsFor(input.user, input.task, input.store, profile, input.runId, input.sessionId),
      channels: channels(profile),
      pendingInputs: options.pendingStore,
      unattended: true,
      runtimeTools: makeTownTools({ ...input, profile, pendingStore: options.pendingStore, configuredProfiles }),
      ...(orchestrator ? { runtimeToolAllowlist: TOWN_TOOLS, systemPromptAppend: input.manualQuotaOverrideAuthorized ? MANUAL_ORCHESTRATOR_PROMPT : ORCHESTRATOR_PROMPT } : { systemPromptAppend: workerContextPrompt(input.project.path), stageSystemPromptAppend: workerContextPrompt(input.project.path) }),
      ...(!orchestrator && input.task.workspace_mode === 'read_only' ? { runtimeToolAllowlist: READ_ONLY_TOOLS } : {}),
      denyMutatingTools: !orchestrator && input.task.workspace_mode === 'read_only',
    }
  }
  const settleTask = (store: TownStore, taskId: string, state: 'completed' | 'failed' | 'cancelled', evidence?: string) => {
    const current = store.getTask(taskId)
    if (!current || ['completed', 'failed', 'cancelled', 'interrupted'].includes(current.state)) return
    if (!['running', 'dispatching'].includes(current.state)) return
    store.transitionTask(current.id, current.revision, state, { ...(evidence ? { terminal_evidence: evidence } : {}) })
    if (current.agent_id) {
      const agent = store.snapshot().agents.find(item => item.id === current.agent_id)
      if (agent) store.putAgent({ ...agent, state: state === 'failed' ? 'failed' : 'idle' })
    }
  }
  const markWaiting = (store: TownStore, taskId: string) => {
    const current = store.getTask(taskId)
    if (current?.state === 'running') store.transitionTask(current.id, current.revision, 'waiting_user')
    const updated = store.getTask(taskId)
    if (updated?.agent_id) {
      const agent = store.snapshot().agents.find(item => item.id === updated.agent_id)
      if (agent) store.putAgent({ ...agent, state: 'waiting_user' })
    }
  }

  const keepLeaseAlive = (runId: string, taskId: string, store: TownStore) => {
    if (leaseRenewers.has(runId)) return
    const renewer = setInterval(() => {
      try {
        if (store.renewLeases(taskId)) return
      } catch { /* a missing or corrupt durable lease is lost authority */ }
      options.abortRegistry.get(runId)?.abort(new Error('Town workspace lease was lost'))
      clearInterval(renewer)
      leaseRenewers.delete(runId)
    }, 30_000)
    renewer.unref?.()
    leaseRenewers.set(runId, renewer)
  }

  const canRecoverContinuation = (input: { user: string; task: TownTask; question: TownMessage }): boolean => {
    const { user, task, question } = input
    if (!task.state.startsWith('queued_') && task.state !== 'waiting_user') return false
    if (!task.run_id || !task.session_id || question.kind !== 'question' || question.task_id !== task.id) return false
    if (question.project_id !== task.project_id || question.thread_id !== task.session_id || !question.continuation_id) return false
    if (!['delivered', 'acknowledged'].includes(question.state)) return false
    const pending = options.pendingStore.get(question.continuation_id)
    const run = options.runStore.get(task.run_id)
    if (!pending || pending.state !== 'open' || !pending.tool_call_id || Date.parse(pending.expires_at) <= Date.now()) return false
    if (pending.user !== user || pending.run_id !== task.run_id || pending.session_id !== task.session_id) return false
    if (!run || run.status !== 'waiting_input' || run.id !== task.run_id || run.user !== user || run.profile !== pending.profile || run.session_id !== task.session_id) return false
    const profile = options.profiles?.get(run.profile)
    if (!profile || profile.name !== pending.profile) return false
    const session = loadSession(user, task.session_id)
    if (!session || session.id !== task.session_id || session.user !== user || session.profile !== run.profile) return false
    return session.messages.some((message: any) => message?.role === 'assistant'
      && Array.isArray(message.tool_calls)
      && message.tool_calls.some((call: any) => call?.id === pending.tool_call_id))
  }

  return {
    canRecoverContinuation,
    async start(input) {
      const runId = randomUUID(), session = createSession(input.profile.name, input.user)
      session.project = input.task.project_id
      session.working_dir = input.workingDirectory
      const runStoreRecord = { id: runId, profile: input.profile.name, user: input.user, trigger: 'rest' as const, input: input.task.prompt, status: 'running' as const, session_id: session.id, started_at: new Date().toISOString() }
      options.runStore.create(runStoreRecord)
      const abort = new AbortController(); options.abortRegistry.set(runId, abort)
      dispatchers.set(runId, input.dispatchWorker)
      keepLeaseAlive(runId, input.task.id, input.store)
      const manualQuotaOverrideAuthorized = input.orchestrator
        && input.task.manual_quota_override?.authority_task_id === input.task.id
        && input.dispatchWorker.isManualQuotaOverrideActive?.() === true
      const runOptions = runProfileOptions({ user: input.user, task: input.task, project: input.project, store: input.store, profile: input.profile, runId, sessionId: session.id, dispatchWorker: input.dispatchWorker, manualQuotaOverrideAuthorized })
      const pendingRun = runProfileOnce({ ...runOptions, session, signal: abort.signal })
      let parked = false
      void pendingRun.then(result => {
        saveSession(result.session)
        const current = options.runStore.get(runId)
        if (current?.status !== 'cancelled') {
          options.runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
          settleTask(input.store, input.task.id, 'completed', result.finalText.slice(0, 4000) || 'worker run completed')
        }
      }).catch(error => {
        if (isParkSignal(error)) {
          parked = true
          input.dispatchWorker.revokeManualQuotaOverride?.()
          const current = options.runStore.get(runId)
          if (current?.status !== 'cancelled') {
            options.runStore.update(runId, { status: 'waiting_input', session_id: error.sessionId ?? session.id })
            markWaiting(input.store, input.task.id)
          }
        } else {
          const current = options.runStore.get(runId)
          if (current?.status !== 'cancelled') {
            options.runStore.update(runId, { status: 'failed', error: error instanceof Error ? error.message : 'worker failed', finished_at: new Date().toISOString() })
            settleTask(input.store, input.task.id, 'failed', error instanceof Error ? error.message : 'worker failed')
          }
        }
      }).finally(() => {
        options.abortRegistry.delete(runId)
        if (!parked) {
          dispatchers.delete(runId)
          clearInterval(leaseRenewers.get(runId))
          leaseRenewers.delete(runId)
        }
      })
      // runProfileOnce starts synchronously up to its first asynchronous provider setup;
      // stable session/run identifiers are recorded before reporting the start.
      return { session_id: session.id, run_id: runId }
    },
    async answer({ user, profile: _selectedProfile, store, question, answer, dispatchWorker: recoveredDispatchWorker }) {
      const profile = _selectedProfile
      const pendingId = question.continuation_id
      const task = question.task_id ? store.getTask(question.task_id) : null
      if (!pendingId || !task) return { resumed: false, error: 'question continuation target is unavailable' }
      const runId = task.run_id
      const dispatchWorker = recoveredDispatchWorker ?? (runId ? dispatchers.get(runId) : undefined)
      if (!runId || !dispatchWorker) return { resumed: false, error: 'orchestrator continuation is no longer live' }
      const current = store.getTask(task.id)
      const durableQuestion = store.snapshot().messages.find(item => item.id === question.id && item.kind === 'question')
      if (!current || (!current.state.startsWith('queued_') && current.state !== 'waiting_user') || current.run_id !== runId || !current.session_id) return { resumed: false, error: 'task is no longer waiting for this answer' }
      if (!durableQuestion || durableQuestion.task_id !== current.id || durableQuestion.continuation_id !== pendingId || durableQuestion.thread_id !== current.session_id || !canRecoverContinuation({ user, task: current, question: durableQuestion }) || store.user !== user) return { resumed: false, error: 'question continuation no longer matches its durable run' }
      if (!store.renewLeases(current.id)) return { resumed: false, error: 'workspace lease is unavailable for continuation' }
      try {
        store.transitionTask(current.id, current.revision, 'running', { session_id: current.session_id, run_id: current.run_id })
      } catch (error) {
        store.releaseLease(current.id, 'continuation task changed before resume')
        return { resumed: false, error: error instanceof Error ? error.message : 'task changed before continuation resume' }
      }
      dispatchers.set(runId, dispatchWorker)
      keepLeaseAlive(runId, current.id, store)
      const channel = channels(profile)
      let result: Awaited<ReturnType<typeof resumePendingInput>>
      try { result = await resumePendingInput(pendingId, answer, 'rest', {
        pendingStore: options.pendingStore, runStore: options.runStore, abortRegistry: options.abortRegistry,
        resolveProfile: name => options.profiles?.get(name) ?? (name === profile.name ? profile : null),
        channels: channel,
        events: eventsFor(user, current, store, profile, runId, current.session_id),
        runProfileOptions: (_pending: PendingInput, resumedProfile: Profile) => {
          const project = store.getProject(current.project_id)
          if (!project) throw new Error('project no longer exists')
          return runProfileOptions({ user, task: current, project, store, profile: resumedProfile, runId, sessionId: current.session_id!, dispatchWorker, manualQuotaOverrideAuthorized: current.manual_quota_override?.authority_task_id === current.id && dispatchWorker.isManualQuotaOverrideActive?.() === true })
        },
      }) } catch (error) {
        const reason = error instanceof Error ? error.message : 'worker resume failed'
        const latest = store.getTask(current.id)
        if (latest && ['waiting_user', 'running'].includes(latest.state)) store.transitionTask(latest.id, latest.revision, 'failed', { terminal_evidence: `answer could not resume worker: ${reason}` })
        const run = options.runStore.get(runId)
        if (run && run.status !== 'cancelled') options.runStore.update(runId, { status: 'failed', error: reason, finished_at: new Date().toISOString() })
        dispatchers.delete(runId); clearInterval(leaseRenewers.get(runId)); leaseRenewers.delete(runId); store.releaseLease(current.id, 'continuation resume failed'); store.closeContinuation(question.id)
        return { resumed: false, state: 'failed', error: reason }
      }
      if (result.status === 'completed') {
        settleTask(store, current.id, 'completed', result.finalText.slice(0, 4000) || 'worker run completed')
        dispatchers.delete(runId)
        clearInterval(leaseRenewers.get(runId)); leaseRenewers.delete(runId)
        store.releaseLease(current.id, 'continuation completed')
        store.closeContinuation(question.id)
        return { resumed: true, state: 'completed' }
      }
      if (result.status === 'waiting_input') { markWaiting(store, current.id); store.closeContinuation(question.id); return { resumed: true, state: 'waiting_user' } }
      if (result.status === 'failed') { settleTask(store, current.id, 'failed', result.error); dispatchers.delete(runId); clearInterval(leaseRenewers.get(runId)); leaseRenewers.delete(runId); store.releaseLease(current.id, 'continuation failed'); store.closeContinuation(question.id); return { resumed: true, state: 'failed', error: result.error } }
      const reason = result.reason
      const latest = store.getTask(current.id)
      if (latest && ['waiting_user', 'running'].includes(latest.state)) store.transitionTask(latest.id, latest.revision, 'failed', { terminal_evidence: `answer could not resume worker: ${reason}` })
      const run = options.runStore.get(runId)
      if (run && run.status !== 'cancelled') options.runStore.update(runId, { status: 'failed', error: reason, finished_at: new Date().toISOString() })
      dispatchers.delete(runId); clearInterval(leaseRenewers.get(runId)); leaseRenewers.delete(runId); store.releaseLease(current.id, 'continuation resume failed'); store.closeContinuation(question.id)
      return { resumed: false, state: 'failed', error: reason }
    },
    async cancel({ task, store }) {
      if (task.run_id) {
        options.abortRegistry.get(task.run_id)?.abort()
        clearInterval(leaseRenewers.get(task.run_id)); leaseRenewers.delete(task.run_id)
        const run = options.runStore.get(task.run_id)
        if (run && (run.status === 'running' || run.status === 'waiting_input')) options.runStore.update(task.run_id, { status: 'cancelled', finished_at: new Date().toISOString() })
        dispatchers.delete(task.run_id)
      }
      for (const message of store.snapshot().messages.filter(item => item.task_id === task.id && item.kind === 'question' && item.continuation_id)) {
        options.pendingStore.cancel(message.continuation_id!)
        store.closeContinuation(message.id)
      }
    },
  }
}
