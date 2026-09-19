import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { TownStore } from '../src/town/store.js'
import { createTownRuntime } from '../src/town/runtime.js'
import { RunStore } from '../src/runs/store.js'
import { PendingStore } from '../src/runs/pending.js'
import { loadSession, saveSession } from '../src/session/store.js'
import { clearRegistry, registerAll } from '../src/tools/builtin/index.js'
import type { ProviderClient, ProviderRequest, ProviderResult } from '../src/provider/types.js'
import type { Profile } from '../src/profiles/schema.js'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function toolResult(request: ProviderRequest, name: string): Record<string, unknown> | undefined {
  for (let index = 0; index < request.messages.length; index++) {
    const message = request.messages[index]
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls) {
      const callName = 'function' in call ? call.function.name : call.name
      if (callName !== name) continue
      const callId = 'function' in call ? call.id : call.id
      const result = request.messages.slice(index + 1).find(item => item.role === 'tool' && item.tool_call_id === callId)
      if (typeof result?.content !== 'string') continue
      try { return JSON.parse(result.content) as Record<string, unknown> } catch { return undefined }
    }
  }
  return undefined
}

function callResult(id: string, name: string, args: Record<string, unknown>): ProviderResult {
  return { text: '', toolCalls: [{ id, name, arguments: JSON.stringify(args) }], finishReason: 'tool_calls' }
}

describe('Town real runtime', () => {
  it('runs an orchestrator through a real worker, parks TownAsk, and resumes the same read-only runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'town-runtime-'))
    roots.push(root)
    vi.stubEnv('HARNESS_STATE_DIR', join(root, 'harness-state'))
    const townDirectory = join(root, 'town-state')
    const projectPath = join(root, 'fixture-project')
    mkdirSync(projectPath, { recursive: true })
    const store = new TownStore(`town-runtime-${randomUUID()}`, { baseDirectory: townDirectory })
    const project = store.putProject({
      path: projectPath,
      git: { status: 'known', head: 'fixture', dirty: false },
      scanned_at: new Date().toISOString(),
      display: { name: 'Runtime fixture' },
    })
    const profile = {
      name: 'fixture',
      model: { auth: 'codex_oauth', id: 'gpt-5.4-mini', codex: { max_model_calls_per_run: 24, request_timeout_ms: 30_000 } },
      system_prompt: join(process.cwd(), 'profiles', 'assistant.md'),
      working_dir: projectPath,
      artifact_dir: join(root, 'artifacts'),
      memory: { provider: 'fs' },
      tools: { builtin: {}, custom: {}, mcp_servers: [] },
      hooks: { pre_tool: [], post_tool: [], on_stop: [] },
      safety: { enabled: false, timeout_ms: 1000, cache_ttl_hours: 1, gate_untrusted_actions: false, gate_writes: false },
      max_depth: 1,
      agents: [],
      lists: {},
      approval_mode: 'danger',
    } as unknown as Profile

    const observedTools: Array<{ taskPrompt: string; names: string[]; systemPrompt: string }> = []
    clearRegistry()
    registerAll(undefined, profile)
    const rawProvider: ProviderClient = {
      kind: 'codex_oauth',
      model: profile.model.id,
      async generate() { throw new Error('the runtime must use the stream adapter') },
      async *stream(request, context) {
        context?.beforeAttempt?.()
        await new Promise(resolve => setTimeout(resolve, 5))
        const taskPrompt = request.messages.filter(message => message.role === 'user').map(message => String(message.content)).join('\n')
        observedTools.push({ taskPrompt, names: (request.tools ?? []).map(tool => tool.name), systemPrompt: request.messages.filter(message => message.role === 'system').map(message => String(message.content)).join('\n') })
        const worker = taskPrompt.includes('worker question task')
        if (worker) {
          const answered = request.messages.some(message => message.role === 'tool' && message.content === 'Amber')
          yield { type: 'done', result: answered
            ? { text: 'The operator selected Amber; inspection is complete.', toolCalls: [], finishReason: 'stop' }
            : callResult('worker-ask', 'TownAsk', { prompt: 'Which label should the fixture use?' }) }
          return
        }
        if (!toolResult(request, 'TownRead')) {
          yield { type: 'done', result: callResult('orchestrator-read', 'TownRead', { project_id: project.id }) }
        } else if (!toolResult(request, 'TownCreateTask')) {
          yield { type: 'done', result: callResult('orchestrator-create', 'TownCreateTask', {
            project_id: project.id,
            title: 'Inspect fixture with a question',
            prompt: 'worker question task',
            workspace_mode: 'read_only',
          }) }
        } else if (!toolResult(request, 'TownAssign')) {
          const task = toolResult(request, 'TownCreateTask')!
          yield { type: 'done', result: callResult('orchestrator-assign', 'TownAssign', { task_id: task.task_id, profile: 'fixture' }) }
        } else if (!toolResult(request, 'TownDispatch')) {
          const task = toolResult(request, 'TownCreateTask')!
          yield { type: 'done', result: callResult('orchestrator-dispatch', 'TownDispatch', { task_id: task.task_id }) }
        } else {
          yield { type: 'done', result: { text: 'Created and dispatched one read-only worker.', toolCalls: [], finishReason: 'stop' } }
        }
      },
    }
    const runStore = new RunStore()
    const pendingStore = new PendingStore(join(root, 'pending'))
    const abortRegistry = new Map<string, AbortController>()
    const runtime = createTownRuntime({ runStore, pendingStore, abortRegistry, profiles: new Map([[profile.name, profile]]), providerForProfile: () => rawProvider })

    const orchestratorAgent = store.putAgent({ id: randomUUID(), profile: profile.name, role: 'orchestrator', display_name: 'Town steward', lifecycle: 'task_bound', home_project_id: project.id, state: 'idle' })
    const orchestratorDraft = store.createTask({ project_id: project.id, title: 'Coordinate fixture inspection', prompt: 'delegate one read-only worker to ask a question', agent_id: orchestratorAgent.id, workspace_mode: 'read_only' })
    const orchestratorReady = store.transitionTask(orchestratorDraft.id, orchestratorDraft.revision, 'ready')
    const authorizedPlanner = store.recordManualQuotaOverride(orchestratorReady.id, orchestratorReady.revision, {
      requested_at: new Date().toISOString(), authorized_at: new Date().toISOString(), authorized_by: store.user,
      authority_task_id: orchestratorReady.id, quota_provider: 'codex_oauth', quota_status: 'unsupported', quota_source: 'fixture unsupported',
    })
    const orchestratorLease = store.acquireLease(authorizedPlanner.id, 'codex_oauth', 'fixture-account')
    expect(orchestratorLease.lease).toBeTruthy()
    const orchestratorDispatching = store.transitionTask(authorizedPlanner.id, authorizedPlanner.revision, 'dispatching')

    const revokeManualQuotaOverride = vi.fn()
    let manualAuthorityActive = true
    const dispatchWorker = Object.assign(async (workerId: string) => {
      const worker = store.getTask(workerId)!
      const agent = store.snapshot().agents.find(item => item.id === worker.agent_id)!
      const ready = worker.state === 'draft' ? store.transitionTask(worker.id, worker.revision, 'ready') : worker
      const lease = store.acquireLease(ready.id, 'codex_oauth', 'fixture-account')
      if (!lease.lease) throw new Error(`fixture worker lease unavailable: ${lease.reason}`)
      const dispatching = store.transitionTask(ready.id, ready.revision, 'dispatching')
      const started = await runtime.start({ user: store.user, profile, task: dispatching, project, workingDirectory: projectPath, orchestrator: false, store, dispatchWorker })
      const running = store.markRunning(dispatching.id, dispatching.revision, started.session_id, started.run_id)
      store.putAgent({ ...agent, state: 'working', task_id: running.id, session_id: started.session_id, run_id: started.run_id })
      return { decision: 'started', task: running, ...started }
    }, { revokeManualQuotaOverride: () => { manualAuthorityActive = false; revokeManualQuotaOverride() }, isManualQuotaOverrideActive: () => manualAuthorityActive })
    const orchestratorStarted = await runtime.start({ user: store.user, profile, task: orchestratorDispatching, project, workingDirectory: projectPath, orchestrator: true, store, dispatchWorker })
    store.markRunning(orchestratorDispatching.id, orchestratorDispatching.revision, orchestratorStarted.session_id, orchestratorStarted.run_id)

    await vi.waitFor(() => expect(store.getTask(orchestratorDraft.id)?.state).toBe('completed'), { timeout: 10_000, interval: 10 })
    expect(observedTools.find(entry => entry.taskPrompt.includes('delegate one read-only worker'))?.systemPrompt).toContain('explicitly authorized this root task')
    const worker = store.snapshot().tasks.find(task => task.id !== orchestratorDraft.id)
    expect(worker).toMatchObject({ state: 'waiting_user', workspace_mode: 'read_only', session_id: expect.any(String), run_id: expect.any(String) })
    expect(revokeManualQuotaOverride).toHaveBeenCalledOnce()
    const question = store.snapshot().messages.find(message => message.kind === 'question' && message.task_id === worker?.id)!
    expect(question.continuation_id).toBeTruthy()
    expect(runtime.canRecoverContinuation?.({ user: store.user, task: worker!, question })).toBe(true)
    const durableSession = loadSession(store.user, worker!.session_id!)!
    const assistantCall = durableSession.messages.find((message: any) => message.role === 'assistant' && message.tool_calls?.some((call: any) => call.id === pendingStore.get(question.continuation_id!)?.tool_call_id)) as any
    const originalCalls = assistantCall.tool_calls
    assistantCall.tool_calls = originalCalls.filter((call: any) => call.id !== pendingStore.get(question.continuation_id!)?.tool_call_id)
    saveSession(durableSession)
    expect(runtime.canRecoverContinuation?.({ user: store.user, task: worker!, question })).toBe(false)
    assistantCall.tool_calls = originalCalls
    saveSession(durableSession)
    expect(observedTools.some(entry => entry.taskPrompt.includes('delegate one read-only worker') && entry.names.includes('TownDispatch'))).toBe(true)

    const initialWorkerTools = observedTools.find(entry => entry.taskPrompt.includes('worker question task'))?.names ?? []
    expect(initialWorkerTools).toContain('TownRead')
    expect(initialWorkerTools).toContain('TownAsk')
    expect(initialWorkerTools).toContain('Read')
    expect(initialWorkerTools).toContain('Grep')
    expect(initialWorkerTools).toContain('Glob')
    const workerSystemPrompt = observedTools.find(entry => entry.taskPrompt.includes('worker question task'))?.systemPrompt ?? ''
    expect(workerSystemPrompt).toContain(`host platform is ${process.platform}`)
    expect(workerSystemPrompt).toContain(JSON.stringify(projectPath))
    for (const denied of ['Bash', 'Write', 'Edit', 'ExecuteCode', 'Delegate', 'Skill', 'MemoryRead', 'WebFetch', 'TownCreateTask', 'TownAssign', 'TownDispatch']) expect(initialWorkerTools).not.toContain(denied)

    const accepted = store.recordAnswer(question.id, question.revision, 'Amber', 'resume-answer-key')
    const queued = store.transitionTask(worker!.id, worker!.revision, 'queued_quota', { block_reason: 'test fixture queued approval continuation' })
    store.recordAnswerOutcome(accepted.message.id, { resumed: false, state: 'queued_quota', error: 'held pending explicit retry' })
    const childSource = `
      import { TownStore } from './src/town/store.ts'
      import { createTownRuntime } from './src/town/runtime.ts'
      import { RunStore } from './src/runs/store.ts'
      import { PendingStore } from './src/runs/pending.ts'
      import { clearRegistry, registerAll } from './src/tools/builtin/index.ts'
      const [user, townDirectory, pendingDirectory, taskId, questionId, account, profileJson] = process.argv.slice(1)
      const profile = JSON.parse(profileJson)
      clearRegistry()
      registerAll(undefined, profile)
      const runStore = new RunStore()
      const pendingStore = new PendingStore(pendingDirectory)
      const observed = []
      const provider = {
        kind: 'codex_oauth', model: profile.model.id,
        async generate() { throw new Error('fixture uses stream only') },
        async *stream(request, context) {
          context?.beforeAttempt?.()
          observed.push({ names: (request.tools ?? []).map(tool => tool.name), system: request.messages.filter(message => message.role === 'system').map(message => String(message.content)).join('\\n') })
          yield { type: 'done', result: { text: 'Restarted worker completed.', toolCalls: [], finishReason: 'stop' } }
        },
      }
      const abortRegistry = new Map()
      const runtime = createTownRuntime({ runStore, pendingStore, abortRegistry, profiles: new Map([[profile.name, profile]]), providerForProfile: () => provider })
      const store = new TownStore(user, { baseDirectory: townDirectory, canRecoverContinuation: (task, question) => runtime.canRecoverContinuation({ user, task, question }) })
      const task = store.getTask(taskId)
      const question = store.snapshot().messages.find(message => message.id === questionId)
      if (!task || !question || task.state !== 'queued_quota' || !runtime.canRecoverContinuation({ user, task, question })) throw new Error('fresh runtime rejected the exact durable continuation')
      if (!store.acquireLease(task.id, 'codex_oauth', account).lease) throw new Error('fresh process could not reacquire continuation lease')
      const noManualInheritanceDispatch = async () => { throw new Error('nested dispatch was not expected in this worker fixture') }
      const outcome = await runtime.answer({ user, profile, store, question, answer: 'Amber', dispatchWorker: noManualInheritanceDispatch })
      const receipt = store.snapshot().messages.find(message => message.kind === 'answer' && message.reply_to === question.id)
      if (!receipt) throw new Error('saved answer receipt missing')
      store.recordAnswerResumeOutcome(receipt.id, { resumed: outcome.resumed, state: outcome.state ?? 'failed', ...(outcome.error ? { error: outcome.error } : {}) })
      process.stdout.write(JSON.stringify({ outcome, task: store.getTask(task.id), run: runStore.get(task.run_id), question: store.snapshot().messages.find(message => message.id === question.id), receipt: store.snapshot().messages.find(message => message.id === receipt.id), leases: store.activeLeases(), observed }))
    `
    const childOutput = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childSource, store.user, townDirectory, join(root, 'pending'), worker!.id, question.id, 'fixture-account', JSON.stringify(profile)], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HARNESS_STATE_DIR: join(root, 'harness-state') },
      timeout: 30_000,
    })
    const restarted = JSON.parse(childOutput.trim().split('\n').at(-1)!)
    expect(queued.state).toBe('queued_quota')
    expect(restarted.outcome).toMatchObject({ resumed: true, state: 'completed' })
    expect(restarted.task).toMatchObject({ id: worker!.id, state: 'completed', session_id: worker!.session_id, run_id: worker!.run_id })
    expect(restarted.run).toMatchObject({ id: worker!.run_id, status: 'completed', session_id: worker!.session_id, user: store.user, profile: profile.name })
    expect(restarted.receipt).toMatchObject({ id: accepted.message.id, body: 'Amber', answer_outcome: { resumed: true, state: 'completed' } })
    expect(restarted.question.continuation_id).toBeUndefined()
    expect(restarted.leases).toEqual([])
    expect(restarted.observed).toHaveLength(1)
    expect(restarted.observed[0].names).toEqual(initialWorkerTools)
    expect(restarted.observed[0].system).toContain(`host platform is ${process.platform}`)
    expect(restarted.observed[0].system).toContain(JSON.stringify(projectPath))
    expect(restarted.observed[0].names).not.toContain('Bash')
    await runtime.cancel?.({ user: store.user, task: store.getTask(worker!.id)!, store })
    expect(pendingStore.list({ user: store.user })).toHaveLength(1)
  })
})
