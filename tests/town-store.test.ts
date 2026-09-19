import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { TownStore } from '../src/town/store.js'

const roots: string[] = []
function createStore(user = 'town-test'): TownStore {
  const root = mkdtempSync(join(tmpdir(), 'harness-town-'))
  roots.push(root)
  return new TownStore(user, { baseDirectory: root })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const projectInput = (path: string) => ({
  path,
  git: { status: 'known' as const, head: 'abc123', dirty: false, last_commit_at: '2026-09-12T00:00:00.000Z' },
  scanned_at: '2026-09-13T00:00:00.000Z',
  display: { name: 'Base', description: 'Harness source' },
})

describe('TownStore', () => {
  it('persists optional size evidence in project snapshots and tolerates old projects without it', () => {
    const store = createStore('size-evidence')
    const project = store.putProject({
      ...projectInput('/work/sized'),
      size: { source: 'git_tracked_regular_files', status: 'complete', tracked_regular_files: 123, measured_at: '2026-09-13T00:00:00.000Z', max_entries: 10_000 },
    })
    expect(store.snapshot().projects[0].size).toEqual(project.size)
    expect(store.events(0).events.find(event => event.type === 'project.discovered')?.data).toMatchObject({ size: project.size })

    const legacy = store.putProject(projectInput('/work/legacy'))
    expect(legacy.size).toBeUndefined()
    const reopened = new TownStore('size-evidence', { baseDirectory: roots[0], recovery: 'none' })
    expect(reopened.snapshot().projects.find(item => item.id === legacy.id)).toMatchObject({ id: legacy.id, display: { name: 'Base' } })
    expect(reopened.snapshot().projects.find(item => item.id === legacy.id)?.size).toBeUndefined()
  })

  it('keeps records per user and preserves a discovered project identity across refreshes', () => {
    const alice = createStore('alice')
    const bob = new TownStore('bob', { baseDirectory: roots[0] })
    const original = alice.putProject(projectInput('/work/base'))
    const refreshed = alice.putProject({ ...projectInput('/work/base'), scanned_at: '2026-09-14T00:00:00.000Z' })

    expect(refreshed.id).toBe(original.id)
    expect(alice.snapshot().projects).toHaveLength(1)
    expect(bob.snapshot().projects).toHaveLength(0)
  })

  it('persists project tasks and enforces optimistic revisions and valid transitions', () => {
    const store = createStore()
    const project = store.putProject(projectInput('/work/base'))
    const draft = store.createTask({ project_id: project.id, title: 'Inspect tests', prompt: 'Inspect the test suite.', workspace_mode: 'read_only' })

    const ready = store.transitionTask(draft.id, draft.revision, 'ready')
    expect(ready.state).toBe('ready')
    expect(ready.revision).toBe(draft.revision + 1)
    expect(() => store.transitionTask(draft.id, draft.revision, 'dispatching')).toThrow(/revision conflict/i)
    expect(() => store.transitionTask(draft.id, ready.revision, 'completed')).toThrow(/invalid.*transition/i)

    const reopened = new TownStore('town-test', { baseDirectory: roots[0] })
    expect(reopened.getTask(draft.id)).toEqual(ready)
  })

  it('recovers interrupted runtime work without restoring executable authority', () => {
    const store = createStore()
    const project = store.putProject(projectInput('/work/base'))
    const draft = store.createTask({ project_id: project.id, title: 'Run checks', prompt: 'Run the checks.', workspace_mode: 'read_only' })
    const ready = store.transitionTask(draft.id, draft.revision, 'ready')
    const dispatching = store.transitionTask(draft.id, ready.revision, 'dispatching')
    const running = store.transitionTask(draft.id, dispatching.revision, 'running', { session_id: 'session-1', run_id: 'run-1' })
    const question = store.createMessage({ project_id: project.id, task_id: draft.id, from: 'worker-1', to: 'user', kind: 'question', body: 'Confirm?', continuation_id: 'continuation-1' })

    const recovered = new TownStore('town-test', { baseDirectory: roots[0], recovery: 'force' }).getTask(draft.id)
    expect(recovered).toMatchObject({ state: 'interrupted', session_id: 'session-1', run_id: 'run-1' })
    expect(recovered!.revision).toBeGreaterThan(running.revision)
    const afterRestart = new TownStore('town-test', { baseDirectory: roots[0], recovery: 'none' }).snapshot().messages.find(message => message.id === question.id)
    expect(afterRestart?.continuation_id).toBeUndefined()
    expect(() => new TownStore('town-test', { baseDirectory: roots[0], recovery: 'none' }).recordAnswer(question.id, afterRestart!.revision, 'Too late', 'key-1')).toThrow(/continuation is closed|no live continuation/i)
  })

  it('closes waiting-user continuations on restart and refuses late answers', () => {
    const store = createStore()
    const project = store.putProject(projectInput('/work/base'))
    const task = store.createTask({ project_id: project.id, title: 'Ask', prompt: 'ask', workspace_mode: 'read_only' })
    const ready = store.transitionTask(task.id, task.revision, 'ready')
    const dispatching = store.transitionTask(task.id, ready.revision, 'dispatching')
    const running = store.transitionTask(task.id, dispatching.revision, 'running', { session_id: 'session-1', run_id: 'run-1' })
    const waiting = store.transitionTask(task.id, running.revision, 'waiting_user')
    const question = store.createMessage({ project_id: project.id, task_id: task.id, from: 'worker', to: 'user', kind: 'question', body: 'Choose?', continuation_id: 'pending-1' })
    const recovered = new TownStore('town-test', { baseDirectory: roots[0], recovery: 'force' })
    expect(recovered.getTask(task.id)?.state).toBe('interrupted')
    const closed = recovered.snapshot().messages.find(item => item.id === question.id)
    expect(closed?.state).toBe('acknowledged')
    expect(closed?.continuation_id).toBeUndefined()
    expect(() => recovered.recordAnswer(question.id, question.revision + 1, 'late', 'key')).toThrow(/no live continuation|closed/i)
    expect(waiting.state).toBe('waiting_user')
  })

  it('preserves only a parked continuation explicitly validated during restart recovery', () => {
    const store = createStore()
    const project = store.putProject(projectInput('/work/base'))
    const agent = store.putAgent({ id: 'recovery-worker', profile: 'fixture', role: 'worker', display_name: 'Recovery worker', lifecycle: 'task_bound', home_project_id: project.id })
    const task = store.createTask({ project_id: project.id, title: 'Resume work', prompt: 'continue', workspace_mode: 'read_only', agent_id: agent.id })
    const ready = store.transitionTask(task.id, task.revision, 'ready')
    expect(store.acquireLease(ready.id, 'codex_oauth', 'fixture-account').lease).toBeDefined()
    const dispatching = store.transitionTask(ready.id, ready.revision, 'dispatching')
    const running = store.markRunning(dispatching.id, dispatching.revision, 'session-1', 'run-1')
    const waiting = store.transitionTask(running.id, running.revision, 'waiting_user')
    const question = store.createMessage({ project_id: project.id, task_id: task.id, thread_id: 'session-1', from: 'Recovery worker', to: 'user', kind: 'question', body: 'Continue?', artifact_ids: [], continuation_id: 'pending-1' })
    const accepted = store.recordAnswer(question.id, question.revision, 'allow', 'answer-key')
    store.transitionTask(waiting.id, waiting.revision, 'queued_quota', { block_reason: 'quota' })
    store.recordAnswerOutcome(accepted.message.id, { resumed: false, state: 'queued_quota', error: 'held by quota' })

    const recovered = new TownStore('town-test', {
      baseDirectory: roots[0],
      recovery: 'force',
      canRecoverContinuation: (candidate, candidateQuestion) => candidate.id === task.id && candidateQuestion.id === question.id,
    })
    expect(recovered.getTask(task.id)).toMatchObject({ state: 'queued_quota', session_id: 'session-1', run_id: 'run-1' })
    expect(recovered.snapshot().messages.find(item => item.id === question.id)).toMatchObject({ continuation_id: 'pending-1', state: 'acknowledged' })
    expect(recovered.snapshot().messages.find(item => item.id === accepted.message.id)).toMatchObject({ body: 'allow', reply_to: question.id, answer_outcome: { state: 'queued_quota' } })
    expect(recovered.activeLeases()).toEqual([])

    const rejected = new TownStore('town-test', { baseDirectory: roots[0], recovery: 'force', canRecoverContinuation: () => false })
    expect(rejected.getTask(task.id)?.state).toBe('interrupted')
    expect(rejected.snapshot().messages.find(item => item.id === question.id)?.continuation_id).toBeUndefined()
  })

  it('updates only queued answer receipts when an explicit retry resumes them', () => {
    const store = createStore()
    const project = store.putProject(projectInput('/work/base'))
    const question = store.createMessage({ project_id: project.id, from: 'worker', to: 'user', kind: 'question', body: 'Allow?', continuation_id: 'pending-1' })
    const accepted = store.recordAnswer(question.id, question.revision, 'allow', 'same-key')
    store.recordAnswerOutcome(accepted.message.id, { resumed: false, state: 'queued_concurrency', error: 'held by concurrency' })
    const before = store.snapshot().messages.find(item => item.id === accepted.message.id)!
    const cursor = store.cursor()

    const resumed = store.recordAnswerResumeOutcome(accepted.message.id, { resumed: true, state: 'completed' })

    expect(resumed).toMatchObject({ id: before.id, body: 'allow', reply_to: question.id, answer_outcome: { resumed: true, state: 'completed' } })
    expect(resumed.revision).toBe(before.revision + 1)
    expect(store.events(cursor).events.map(item => item.type)).toEqual(['message.answer_resume_outcome'])
    expect(() => store.recordAnswerResumeOutcome(accepted.message.id, { resumed: true, state: 'completed' })).toThrow(/not queued/i)
    expect(store.snapshot().messages.find(item => item.id === accepted.message.id)?.body).toBe('allow')

    const terminalQuestion = store.createMessage({ project_id: project.id, from: 'worker', to: 'user', kind: 'question', body: 'Another approval?', continuation_id: 'pending-2' })
    const terminalAnswer = store.recordAnswer(terminalQuestion.id, terminalQuestion.revision, 'allow', 'terminal-key')
    store.recordAnswerOutcome(terminalAnswer.message.id, { resumed: false, state: 'failed', error: 'worker failed' })
    expect(() => store.recordAnswerResumeOutcome(terminalAnswer.message.id, { resumed: true, state: 'completed' })).toThrow(/not queued/i)
  })

  it('does not treat a second store handle in the same process as a server restart', () => {
    const store = createStore()
    const project = store.putProject(projectInput('/work/base'))
    const draft = store.createTask({ project_id: project.id, title: 'Run checks', prompt: 'Run the checks.', workspace_mode: 'read_only' })
    const ready = store.transitionTask(draft.id, draft.revision, 'ready')
    const dispatching = store.transitionTask(draft.id, ready.revision, 'dispatching')
    store.transitionTask(draft.id, dispatching.revision, 'running', { session_id: 'session-1', run_id: 'run-1' })

    expect(new TownStore('town-test', { baseDirectory: roots[0] }).getTask(draft.id)?.state).toBe('running')
  })

  it('recovers running work and rejects a late answer across an actual process restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'town-process-restart-'))
    roots.push(root)
    const user = `town-restart-${randomUUID()}`
    const fixture = join(root, 'fixture')
    const source = `
      import { randomUUID } from 'node:crypto'
      import { TownStore } from './src/town/store.ts'
      const [user, baseDirectory, fixture, mode, questionId] = process.argv.slice(1)
      const store = new TownStore(user, { baseDirectory, ...(mode === 'prepare' ? { recovery: 'none' } : {}) })
      if (mode === 'prepare') {
        const project = store.putProject({ path: fixture, git: { status: 'known', dirty: false }, scanned_at: new Date().toISOString(), display: { name: 'restart fixture' } })
        const agent = store.putAgent({ id: randomUUID(), profile: 'fixture', role: 'worker', display_name: 'Fixture worker', lifecycle: 'task_bound', home_project_id: project.id, state: 'idle' })
        const draft = store.createTask({ project_id: project.id, title: 'waiting work', prompt: 'read only', workspace_mode: 'shared_checkout', agent_id: agent.id })
        const ready = store.transitionTask(draft.id, draft.revision, 'ready')
        if (!store.acquireLease(ready.id, 'codex_oauth', 'fixture-account').lease) throw new Error('fixture lease unavailable')
        const dispatching = store.transitionTask(ready.id, ready.revision, 'dispatching')
        const running = store.markRunning(dispatching.id, dispatching.revision, 'session-fixture', 'run-fixture')
        const question = store.createMessage({ project_id: project.id, task_id: running.id, thread_id: 'session-fixture', from: 'Fixture worker', to: 'user', kind: 'question', body: 'Continue?', artifact_ids: [], continuation_id: 'pending-fixture' })
        console.log(JSON.stringify({ pid: process.pid, question_id: question.id, task_state: running.state }))
      } else {
        const snapshot = store.snapshot()
        const task = snapshot.tasks[0]
        const question = snapshot.messages.find(item => item.id === questionId)
        let lateAnswerError = ''
        try { store.recordAnswer(questionId, question.revision, 'late answer', 'late-key') }
        catch (error) { lateAnswerError = error instanceof Error ? error.message : String(error) }
        console.log(JSON.stringify({ pid: process.pid, task_state: task?.state, question_state: question?.state, continuation_live: Boolean(question?.continuation_id), late_answer_error: lateAnswerError, answer_count: store.snapshot().messages.filter(item => item.kind === 'answer').length }))
      }
    `
    const child = (...args: string[]) => JSON.parse(execFileSync('pnpm', ['exec', 'tsx', '-e', source, '--', user, root, fixture, ...args], { encoding: 'utf8', timeout: 30_000 }).trim())
    const prepared = child('prepare')
    const recovered = child('recover', prepared.question_id)

    expect(prepared.task_state).toBe('running')
    expect(recovered.pid).not.toBe(prepared.pid)
    expect(recovered).toMatchObject({ task_state: 'interrupted', question_state: 'acknowledged', continuation_live: false, answer_count: 0 })
    expect(recovered.late_answer_error).toMatch(/no live continuation|continuation is closed/i)
  })

  it('fails closed on corrupt state instead of replacing it with an empty Town', () => {
    const store = createStore()
    writeFileSync(store.file, '{broken', 'utf8')
    expect(() => new TownStore('town-test', { baseDirectory: roots[0], recovery: 'force' })).toThrow(/corrupt JSON record/i)
    expect(() => JSON.parse(readFileSync(store.file, 'utf8'))).toThrow()
  })

  it('stores questions and explicit answers as separate, durable messages', () => {
    const store = createStore()
    const project = store.putProject(projectInput('/work/base'))
    const question = store.createMessage({ project_id: project.id, from: 'worker-1', to: 'user', kind: 'question', body: 'May I edit the config?' })
    const answer = store.createMessage({ project_id: project.id, from: 'user', to: 'worker-1', kind: 'answer', body: 'Yes.', reply_to: question.id })

    expect(answer.reply_to).toBe(question.id)
    expect(store.snapshot().messages.map(message => message.id)).toEqual([question.id, answer.id])
  })

  it('keeps a continuation available until resume finishes and makes answers idempotent by key', () => {
    const store = createStore()
    const project = store.putProject(projectInput('/work/base'))
    const question = store.createMessage({ project_id: project.id, from: 'worker', to: 'user', kind: 'question', body: 'Choose?', continuation_id: 'pending-1' })
    const accepted = store.recordAnswer(question.id, question.revision, 'yes', 'one-key')
    expect(store.snapshot().messages.find(message => message.id === question.id)?.continuation_id).toBe('pending-1')
    expect(store.recordAnswer(question.id, question.revision, 'yes', 'one-key')).toMatchObject({ created: false, message: { id: accepted.message.id } })
    expect(() => store.recordAnswer(question.id, question.revision, 'no', 'different-key')).toThrow(/already answered/i)
    store.closeContinuation(question.id)
    expect(store.snapshot().messages.find(message => message.id === question.id)?.continuation_id).toBeUndefined()
  })

  it('serializes shared checkout leases across nested repositories and provider accounts', () => {
    const store = createStore()
    const root = store.putProject(projectInput('/work/mono'))
    const nested = store.putProject(projectInput('/work/mono/packages/app'))
    const first = store.createTask({ project_id: root.id, title: 'Root write', prompt: 'write', workspace_mode: 'shared_checkout' })
    const second = store.createTask({ project_id: nested.id, title: 'Nested write', prompt: 'write', workspace_mode: 'shared_checkout' })
    expect(store.acquireLease(first.id, 'codex', 'account-a').lease).toBeDefined()
    expect(store.acquireLease(second.id, 'codex', 'account-b').reason).toBe('workspace')
  })

  it('lets a running orchestrator start one worker while serializing worker starts', () => {
    const store = createStore()
    const project = store.putProject(projectInput('/work/town-runtime'))
    const coordinator = store.putAgent({ id: 'coord', profile: 'fixture', role: 'orchestrator', display_name: 'Coordinator', lifecycle: 'task_bound', home_project_id: project.id })
    const workerA = store.putAgent({ id: 'worker-a', profile: 'fixture', role: 'worker', display_name: 'Worker A', lifecycle: 'task_bound', home_project_id: project.id })
    const workerB = store.putAgent({ id: 'worker-b', profile: 'fixture', role: 'worker', display_name: 'Worker B', lifecycle: 'task_bound', home_project_id: project.id })
    const orchestratorTask = store.createTask({ project_id: project.id, title: 'Coordinate', prompt: 'coordinate', agent_id: coordinator.id, workspace_mode: 'read_only' })
    const firstWorker = store.createTask({ project_id: project.id, title: 'A', prompt: 'work', agent_id: workerA.id, workspace_mode: 'read_only' })
    const secondWorker = store.createTask({ project_id: project.id, title: 'B', prompt: 'work', agent_id: workerB.id, workspace_mode: 'read_only' })
    expect(store.acquireLease(orchestratorTask.id, 'codex', 'account-a').lease).toBeDefined()
    expect(store.acquireLease(firstWorker.id, 'codex', 'account-a').lease).toBeDefined()
    expect(store.acquireLease(secondWorker.id, 'codex', 'account-a').reason).toBe('concurrency')
  })

  it('serializes the same checkout path across separate user stores', () => {
    const store = createStore('alice')
    const otherUser = new TownStore('bob', { baseDirectory: roots[0], recovery: 'none' })
    const project = store.putProject(projectInput('/work/shared-repo'))
    const samePath = otherUser.putProject(projectInput('/work/shared-repo'))
    const first = store.createTask({ project_id: project.id, title: 'Alice write', prompt: 'write', workspace_mode: 'shared_checkout' })
    const second = otherUser.createTask({ project_id: samePath.id, title: 'Bob write', prompt: 'write', workspace_mode: 'shared_checkout' })
    expect(store.acquireLease(first.id, 'codex', 'account-a').lease).toBeDefined()
    expect(otherUser.acquireLease(second.id, 'openai', 'account-b').reason).toBe('workspace')
  })

  it('keeps a workspace lease alive through a running task and renews its expiry', () => {
    let nowMs = Date.parse('2026-09-13T00:00:00Z')
    const root = mkdtempSync(join(tmpdir(), 'harness-town-clock-'))
    roots.push(root)
    const store = new TownStore('lease-test', { baseDirectory: root, recovery: 'none', now: () => new Date(nowMs) })
    const project = store.putProject(projectInput('/work/mono'))
    const first = store.createTask({ project_id: project.id, title: 'Writer', prompt: 'write', workspace_mode: 'shared_checkout' })
    const queued = store.createTask({ project_id: project.id, title: 'Second writer', prompt: 'write', workspace_mode: 'shared_checkout' })
    const lease = store.acquireLease(first.id, 'codex', 'account-a', 10_000).lease!
    const dispatching = store.transitionTask(first.id, first.revision, 'ready')
    const launching = store.transitionTask(first.id, dispatching.revision, 'dispatching')
    store.markRunning(first.id, launching.revision, 'session', 'run')
    nowMs += 8_000
    expect(store.renewLeases(first.id, 10_000)).toBe(true)
    expect(Date.parse(store.activeLeases().find(item => item.id === lease.id)!.expires_at)).toBe(nowMs + 10_000)
    nowMs += 5_000
    expect(store.acquireLease(queued.id, 'codex', 'account-b').reason).toBe('workspace')
  })

  it('delivers user steering into the worker inbox on the next TownRead', () => {
    const store = createStore()
    const project = store.putProject(projectInput('/work/base'))
    const task = store.createTask({ project_id: project.id, title: 'Worker', prompt: 'work', workspace_mode: 'read_only' })
    const agent = store.putAgent({ id: 'agent-1', profile: 'fixture', role: 'worker', display_name: 'Worker', lifecycle: 'task_bound', home_project_id: project.id, state: 'working', task_id: task.id })
    const message = store.createMessage({ project_id: project.id, task_id: task.id, from: 'user-1', to: agent.id, kind: 'status', body: 'Please check the edge case.' })
    const inbox = store.readWorkerInbox(task.id, agent.id)
    expect(inbox).toMatchObject([{ id: message.id, body: 'Please check the edge case.', state: 'acknowledged' }])
    expect(store.readWorkerInbox(task.id, agent.id)).toEqual([])
  })
})
