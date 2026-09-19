import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createRestHandler } from '../src/server/rest.js'
import { TownStore } from '../src/town/store.js'

const owned: string[] = []
const servers: Array<{ server: Server; dispose: () => Promise<void> }> = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async ({ server, dispose }) => {
    await dispose()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }))
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
})

async function start(options: { baseDirectory: string; rootPolicy: string; quotaProvider?: any; runtime?: any; queuePollMs?: number }) {
  const handler = createRestHandler({
    defaultProfile: { name: 'fixture', model: { auth: 'codex' } } as any,
    town: options,
  } as any)
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push({ server, dispose: handler.close })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function call<T = any>(base: string, user: string, path: string, method = 'GET', payload?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}${path.includes('?') ? '&' : '?'}user=${encodeURIComponent(user)}`, {
    method,
    ...(payload === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
  })
  return { status: response.status, body: await response.json() as T }
}

function fixtureProject(store: TownStore) {
  const path = mkdtempSync(join(tmpdir(), 'town-http-project-'))
  owned.push(path)
  return store.putProject({
    path,
    git: { status: 'known', head: 'abc123', dirty: false },
    scanned_at: new Date().toISOString(),
    display: { name: 'Fixture project' },
  })
}

function quota(windows: Array<{ used_percent: number; exhausted?: boolean }>) {
  return {
    read: vi.fn(async () => ({ provider: 'codex', account_scope: 'scope-hash', status: 'available', fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), windows, source: 'test authoritative fixture' })),
  }
}

describe('Town REST surface', () => {
  it('mounts Town snapshot, persists settings, and refreshes only configured discovery root', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-http-'))
    const root = mkdtempSync(join(tmpdir(), 'town-root-http-'))
    const repo = join(root, 'repo')
    mkdirSync(repo)
    execFileSync('git', ['init', '-q', repo])
    writeFileSync(join(repo, 'README.md'), 'Town size fixture\n')
    execFileSync('git', ['-C', repo, '-c', 'user.name=Town Test', '-c', 'user.email=town@example.invalid', 'add', 'README.md'])
    execFileSync('git', ['-C', repo, '-c', 'user.name=Town Test', '-c', 'user.email=town@example.invalid', 'commit', '-qm', 'initial'])
    owned.push(baseDirectory, root)
    const user = `town-http-${randomUUID()}`
    const base = await start({ baseDirectory, rootPolicy: root })

    const initial = await call<any>(base, user, '/town/snapshot')
    expect(initial.status).toBe(200)
    expect(initial.body.settings.discovery_root).toBeTruthy()
    const saved = await call<any>(base, user, '/town/settings', 'PATCH', {
      revision: initial.body.settings.revision,
      root,
      saved_viewpoints: [{ id: 'square', name: 'Square', position: [1, 2, 3], target: [0, 0, 0] }],
    })
    expect(saved.status).toBe(200)
    expect(saved.body.settings.discovery_root).toBe(realpathSync(root))
    const refreshed = await call<any>(base, user, '/town/discovery/refresh', 'POST', { root })
    expect(refreshed.status).toBe(202)
    expect(refreshed.body.projects).toHaveLength(1)
    expect(refreshed.body.projects[0].display.name).toBe('repo')
    expect(refreshed.body.projects[0].size).toMatchObject({ source: 'git_tracked_regular_files', status: 'complete', tracked_regular_files: 1, max_entries: 10_000 })

    const snapshot = await call<any>(base, user, '/town/snapshot')
    expect(snapshot.body.projects[0].size).toEqual(refreshed.body.projects[0].size)
    const page = await call<any>(base, user, '/town/snapshot?after=0')
    expect(page.body.events.find((event: any) => event.type === 'project.discovered')?.data.size).toEqual(refreshed.body.projects[0].size)

    const stream = await fetch(`${base}/town/events?after=0&user=${encodeURIComponent(user)}`)
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    const reader = stream.body!.getReader()
    let streamText = ''
    const streamDeadline = setTimeout(() => { void reader.cancel() }, 2_000)
    try {
      while (!streamText.includes('event: project.discovered')) {
        const { value, done } = await reader.read()
        if (done) break
        streamText += new TextDecoder().decode(value)
      }
    } finally { clearTimeout(streamDeadline); await reader.cancel() }
    const eventLine = /event: project\.discovered\ndata: ([^\n]+)/.exec(streamText)
    expect(eventLine).toBeTruthy()
    expect(JSON.parse(eventLine![1]).data.size).toEqual(refreshed.body.projects[0].size)
  })

  it('queues worker and orchestrator calls when any applicable quota window is exhausted', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-quota-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-quota-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-quota-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory })
    const project = fixtureProject(store)
    const task = store.createTask({ project_id: project.id, title: 'Worker', prompt: 'do work', workspace_mode: 'shared_checkout' }, store.cursor())
    const runtime = { start: vi.fn(async () => ({ session_id: 'session-real', run_id: 'run-real' })) }
    const base = await start({ baseDirectory, rootPolicy, quotaProvider: quota([{ used_percent: 10 }, { used_percent: 100 }]), runtime })
    const response = await call<any>(base, user, `/town/tasks/${task.id}/dispatch`, 'POST', { revision: task.revision })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.decision, JSON.stringify(response)).toBe('queued')
    expect(response.body.reason).toBe('quota')
    expect(response.body.task.state).toBe('queued_quota')
    expect(runtime.start).not.toHaveBeenCalled()

    const snapshot = await call<any>(base, user, '/town/snapshot')
    const orchestrated = await call<any>(base, user, '/town/orchestrate', 'POST', { revision: snapshot.body.cursor, instruction: 'coordinate work', project_ids: [project.id] })
    expect(orchestrated.status).toBe(200)
    expect(orchestrated.body.decision).toBe('queued')
    expect(orchestrated.body.reason).toBe('quota')
    expect(runtime.start).not.toHaveBeenCalled()
  })

  it('starts only when every quota window is fresh and has remaining capacity', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-start-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-start-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-start-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory, recovery: 'none' })
    const project = fixtureProject(store)
    const task = store.createTask({ project_id: project.id, title: 'Worker', prompt: 'inspect', workspace_mode: 'read_only' }, store.cursor())
    const runtime = { start: vi.fn(async () => ({ session_id: 'session-real', run_id: 'run-real' })) }
    const base = await start({ baseDirectory, rootPolicy, quotaProvider: quota([{ used_percent: 20 }, { used_percent: 75 }]), runtime })
    const response = await call<any>(base, user, `/town/tasks/${task.id}/dispatch`, 'POST', { revision: task.revision })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.decision).toBe('started')
    expect(response.body.task).toMatchObject({ state: 'running', session_id: 'session-real', run_id: 'run-real' })
    expect(runtime.start).toHaveBeenCalledOnce()
  })

  it('keeps unsupported capacity fail-closed and returns 409 for stale revisions', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-unsupported-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-unsupported-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-unsupported-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory, recovery: 'none' })
    const project = fixtureProject(store)
    const task = store.createTask({ project_id: project.id, title: 'Worker', prompt: 'work', workspace_mode: 'read_only' }, store.cursor())
    const runtime = { start: vi.fn() }
    const base = await start({ baseDirectory, rootPolicy, runtime })
    const stale = await call<any>(base, user, `/town/tasks/${task.id}/dispatch`, 'POST', { revision: task.revision + 1 })
    expect(stale.status).toBe(409)
    const response = await call<any>(base, user, `/town/tasks/${task.id}/dispatch`, 'POST', { revision: task.revision })
    expect(response.body.decision, JSON.stringify(response)).toBe('queued')
    expect(response.body.reason).toBe('quota')
    expect(response.body.quota.status).toBe('unsupported')
    expect(runtime.start).not.toHaveBeenCalled()
  })

  it('starts only the explicitly authorized read-only orchestrator under unsupported quota and preserves the audit', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-manual-quota-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-manual-quota-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-manual-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory, recovery: 'none' })
    const project = fixtureProject(store)
    const agent = store.putAgent({ id: randomUUID(), profile: 'fixture', role: 'orchestrator', display_name: 'fixture', lifecycle: 'task_bound', home_project_id: project.id, state: 'idle' })
    const draft = store.createTask({ project_id: project.id, title: 'Approved planner', prompt: 'plan work', agent_id: agent.id, workspace_mode: 'read_only' })
    const ready = store.transitionTask(draft.id, draft.revision, 'ready')
    const task = store.transitionTask(ready.id, ready.revision, 'queued_quota', { block_reason: 'quota' })
    const runtime = { start: vi.fn(async (input: any) => {
      expect(input.orchestrator).toBe(true)
      expect(input.task.workspace_mode).toBe('read_only')
      expect(input.task.block_reason).toBeUndefined()
      return { session_id: 'authorized-session', run_id: 'authorized-run' }
    }) }
    const base = await start({ baseDirectory, rootPolicy, runtime })

    const response = await call<any>(base, user, `/town/tasks/${task.id}/dispatch`, 'POST', { revision: task.revision, manual_quota_override: true })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body).toMatchObject({ decision: 'started', quota: { status: 'unsupported' }, task: { state: 'running', session_id: 'authorized-session', run_id: 'authorized-run', workspace_mode: 'read_only' } })
    expect(response.body.quota.status).toBe('unsupported')
    expect(response.body.task.manual_quota_override).toMatchObject({
      authorized_by: user,
      authority_task_id: task.id,
      quota_provider: 'codex',
      quota_status: 'unsupported',
    })
    expect(response.body.task.manual_quota_override.quota_source).toBeTruthy()
    expect(runtime.start).toHaveBeenCalledOnce()
    const snapshot = await call<any>(base, user, '/town/snapshot')
    expect(snapshot.body.tasks.find((item: any) => item.id === task.id).manual_quota_override).toEqual(response.body.task.manual_quota_override)
  })

  it('rejects manual quota override for a non-orchestrator task', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-manual-worker-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-manual-worker-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-manual-worker-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory, recovery: 'none' })
    const project = fixtureProject(store)
    const draft = store.createTask({ project_id: project.id, title: 'Worker', prompt: 'work', workspace_mode: 'shared_checkout' })
    const task = store.transitionTask(draft.id, draft.revision, 'ready')
    const runtime = { start: vi.fn() }
    const base = await start({ baseDirectory, rootPolicy, runtime })
    const response = await call<any>(base, user, `/town/tasks/${task.id}/dispatch`, 'POST', { revision: task.revision, manual_quota_override: true })
    expect(response.status).toBe(403)
    expect(runtime.start).not.toHaveBeenCalled()
    expect(store.getTask(task.id)?.manual_quota_override).toBeUndefined()
  })

  it('passes a manual authorization only to direct children created by the live planner', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-manual-child-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-manual-child-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-manual-child-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory, recovery: 'none' })
    const project = fixtureProject(store)
    const agent = store.putAgent({ id: randomUUID(), profile: 'fixture', role: 'orchestrator', display_name: 'fixture', lifecycle: 'task_bound', home_project_id: project.id, state: 'idle' })
    const draft = store.createTask({ project_id: project.id, title: 'Approved planner', prompt: 'plan work', agent_id: agent.id, workspace_mode: 'read_only' })
    const task = store.transitionTask(draft.id, draft.revision, 'ready')
    const started: string[] = []
    const runtime = { start: vi.fn(async (input: any) => {
      started.push(input.task.id)
      if (input.task.id === task.id) {
        expect(input.orchestrator).toBe(true)
        const childDraft = store.createTask({ project_id: project.id, title: 'Direct child', prompt: 'add assets', workspace_mode: 'shared_checkout', created_by_task_id: input.task.id })
        const worker = store.putAgent({ id: randomUUID(), profile: 'fixture', role: 'worker', display_name: 'worker', lifecycle: 'task_bound', home_project_id: project.id, state: 'idle' })
        const childAssigned = store.assignTask(childDraft.id, childDraft.revision, worker.id)
        const childReady = store.transitionTask(childAssigned.id, childAssigned.revision, 'ready')
        const childResult = await input.dispatchWorker(childReady.id)
        expect((childResult as any).decision).toBe('started')
        const currentChild = store.getTask(childReady.id)!
        const grandchildDraft = store.createTask({ project_id: project.id, title: 'Grandchild', prompt: 'more work', workspace_mode: 'shared_checkout', created_by_task_id: currentChild.id })
        const grandchildReady = store.transitionTask(grandchildDraft.id, grandchildDraft.revision, 'ready')
        const grandchildResult = await input.dispatchWorker(grandchildReady.id)
        expect(grandchildResult).toMatchObject({ decision: 'queued', reason: 'quota' })
      }
      return { session_id: `session-${input.task.title}`, run_id: `run-${input.task.title}` }
    }) }
    const base = await start({ baseDirectory, rootPolicy, runtime })
    const response = await call<any>(base, user, `/town/tasks/${task.id}/dispatch`, 'POST', { revision: task.revision, manual_quota_override: true })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const snapshot = await call<any>(base, user, '/town/snapshot')
    const child = snapshot.body.tasks.find((item: any) => item.title === 'Direct child')
    const grandchild = snapshot.body.tasks.find((item: any) => item.title === 'Grandchild')
    expect(response.body.decision).toBe('started')
    expect(started).toEqual([task.id, child.id])
    expect(child).toMatchObject({ state: 'running', workspace_mode: 'shared_checkout', created_by_task_id: task.id, manual_quota_override: { authority_task_id: task.id, authorized_by: user, quota_status: 'unsupported' } })
    expect(grandchild).toMatchObject({ state: 'queued_quota', created_by_task_id: child.id })
    expect(grandchild.manual_quota_override).toBeUndefined()
  })

  it('closes and fails a question task when an accepted answer cannot resume its run', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-answer-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-answer-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-answer-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory })
    const project = fixtureProject(store)
    const draft = store.createTask({ project_id: project.id, title: 'Question', prompt: 'ask', workspace_mode: 'read_only' })
    const ready = store.transitionTask(draft.id, draft.revision, 'ready')
    const dispatching = store.transitionTask(draft.id, ready.revision, 'dispatching')
    const running = store.transitionTask(draft.id, dispatching.revision, 'running', { session_id: 'session-1', run_id: 'run-1' })
    store.transitionTask(draft.id, running.revision, 'waiting_user')
    const question = store.createMessage({ project_id: project.id, task_id: draft.id, from: 'worker', to: 'user', kind: 'question', body: 'Choose?', continuation_id: 'pending-1' })
    const runtime = { answer: vi.fn(async () => { throw new Error('resume unavailable') }) }
    const base = await start({ baseDirectory, rootPolicy, runtime, quotaProvider: quota([{ used_percent: 30 }]) })
    const payload = { revision: question.revision, body: 'yes', answer_key: 'stable-key' }
    const response = await call<any>(base, user, `/town/messages/${question.id}/answer`, 'POST', payload)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body).toMatchObject({ resumed: false, state: 'failed', resume_error: 'resume unavailable' })
    expect(store.getTask(draft.id)?.state).toBe('failed')
    expect(store.snapshot().messages.find(item => item.id === question.id)?.continuation_id).toBeUndefined()
    const retry = await call<any>(base, user, `/town/messages/${question.id}/answer`, 'POST', payload)
    expect(retry.body).toMatchObject({ resumed: false, state: 'failed', resume_error: 'resume unavailable' })
    expect(runtime.answer).toHaveBeenCalledOnce()
  })

  it('returns the durable original answer receipt after the worker later completes', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-answer-success-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-answer-success-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-answer-success-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory })
    const project = fixtureProject(store)
    const draft = store.createTask({ project_id: project.id, title: 'Question', prompt: 'ask', workspace_mode: 'read_only' })
    const ready = store.transitionTask(draft.id, draft.revision, 'ready')
    const dispatching = store.transitionTask(draft.id, ready.revision, 'dispatching')
    const running = store.transitionTask(draft.id, dispatching.revision, 'running', { session_id: 'session-1', run_id: 'run-1' })
    store.transitionTask(draft.id, running.revision, 'waiting_user')
    const question = store.createMessage({ project_id: project.id, task_id: draft.id, from: 'worker', to: 'user', kind: 'question', body: 'Choose?', continuation_id: 'pending-1' })
    const runtime = { answer: vi.fn(async () => ({ resumed: true, state: 'running' })) }
    const base = await start({ baseDirectory, rootPolicy, runtime, quotaProvider: quota([{ used_percent: 30 }]) })
    const payload = { revision: question.revision, body: 'yes', answer_key: 'stable-key' }
    const first = await call<any>(base, user, `/town/messages/${question.id}/answer`, 'POST', payload)
    expect(first.body).toMatchObject({ resumed: true, state: 'running' })
    const current = store.getTask(draft.id)!
    const resumedTask = store.transitionTask(current.id, current.revision, 'running', { session_id: 'session-1', run_id: 'run-1' })
    store.transitionTask(resumedTask.id, resumedTask.revision, 'completed')
    const retry = await call<any>(base, user, `/town/messages/${question.id}/answer`, 'POST', payload)
    expect(retry.body).toMatchObject({ resumed: true, state: 'running' })
    expect(runtime.answer).toHaveBeenCalledOnce()
  })

  it('keeps an accepted answer queued until fresh quota returns, then resumes the saved continuation once', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-answer-queue-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-answer-queue-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-answer-queue-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory })
    const project = fixtureProject(store)
    const draft = store.createTask({ project_id: project.id, title: 'Question', prompt: 'ask', workspace_mode: 'read_only' })
    const ready = store.transitionTask(draft.id, draft.revision, 'ready')
    const dispatching = store.transitionTask(draft.id, ready.revision, 'dispatching')
    const running = store.transitionTask(draft.id, dispatching.revision, 'running', { session_id: 'session-1', run_id: 'run-1' })
    store.transitionTask(draft.id, running.revision, 'waiting_user')
    const question = store.createMessage({ project_id: project.id, task_id: draft.id, from: 'worker', to: 'user', kind: 'question', body: 'Choose?', continuation_id: 'pending-queue' })
    let capacity = false
    const quotaProvider = { read: vi.fn(async () => capacity
      ? { provider: 'codex', account_scope: 'scope-hash', status: 'available', expires_at: new Date(Date.now() + 30_000).toISOString(), windows: [{ used_percent: 12 }], source: 'fixture' }
      : { provider: 'codex', account_scope: 'scope-hash', status: 'unavailable', windows: [], source: 'fixture', last_error: 'probe unavailable' }) }
    const runtime = { answer: vi.fn(async ({ store: targetStore, question: targetQuestion }: any) => {
      const task = targetStore.getTask(targetQuestion.task_id)!
      const resumed = targetStore.transitionTask(task.id, task.revision, 'running', { session_id: task.session_id, run_id: task.run_id })
      targetStore.transitionTask(resumed.id, resumed.revision, 'completed')
      return { resumed: true, state: 'completed' }
    }) }
    const base = await start({ baseDirectory, rootPolicy, runtime, quotaProvider, queuePollMs: 1000 })
    const payload = { revision: question.revision, body: 'yes', answer_key: 'stable-queue-key' }
    const first = await call<any>(base, user, `/town/messages/${question.id}/answer`, 'POST', payload)
    expect(first.body).toMatchObject({ resumed: false, state: 'queued_quota' })
    expect(runtime.answer).not.toHaveBeenCalled()
    expect(store.getTask(draft.id)?.state).toBe('queued_quota')
    expect(store.snapshot().messages.find(item => item.id === question.id)?.continuation_id).toBe('pending-queue')
    capacity = true
    await vi.waitFor(() => expect(runtime.answer).toHaveBeenCalledOnce(), { timeout: 3000, interval: 20 })
    expect(store.getTask(draft.id)?.state).toBe('completed')
    const retry = await call<any>(base, user, `/town/messages/${question.id}/answer`, 'POST', payload)
    expect(retry.body).toMatchObject({ resumed: false, state: 'queued_quota' })
    expect(runtime.answer).toHaveBeenCalledOnce()
  })

  it('requires a fresh exact-question override to resume a saved answer under unsupported quota', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-answer-manual-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-answer-manual-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-answer-manual-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory })
    const project = fixtureProject(store)
    const plannerAgent = store.putAgent({ id: randomUUID(), profile: 'fixture', role: 'orchestrator', display_name: 'planner', lifecycle: 'task_bound', home_project_id: project.id })
    const plannerDraft = store.createTask({ project_id: project.id, title: 'Authorized planner', prompt: 'start worker', agent_id: plannerAgent.id, workspace_mode: 'read_only' })
    const plannerReady = store.transitionTask(plannerDraft.id, plannerDraft.revision, 'ready')
    const plannerDispatching = store.transitionTask(plannerReady.id, plannerReady.revision, 'dispatching')
    const plannerRunning = store.transitionTask(plannerDispatching.id, plannerDispatching.revision, 'running', { session_id: 'planner-session', run_id: 'planner-run' })
    const plannerAudit = store.recordManualQuotaOverride(plannerRunning.id, plannerRunning.revision, {
      requested_at: new Date().toISOString(), authorized_at: new Date().toISOString(), authorized_by: user,
      authority_task_id: plannerRunning.id, authorization_scope: 'dispatch', quota_provider: 'api_key', quota_status: 'unsupported', quota_source: 'fixture unsupported',
    })
    const planner = store.transitionTask(plannerAudit.id, plannerAudit.revision, 'completed')

    const workerAgent = store.putAgent({ id: randomUUID(), profile: 'fixture', role: 'worker', display_name: 'worker', lifecycle: 'task_bound', home_project_id: project.id })
    const childDraft = store.createTask({ project_id: project.id, title: 'Authorized direct child', prompt: 'edit town assets', agent_id: workerAgent.id, workspace_mode: 'shared_checkout', created_by_task_id: planner.id })
    const childReady = store.transitionTask(childDraft.id, childDraft.revision, 'ready')
    const childAudit = store.recordManualQuotaOverride(childReady.id, childReady.revision, {
      requested_at: new Date().toISOString(), authorized_at: planner.manual_quota_override!.authorized_at, authorized_by: user,
      authority_task_id: planner.id, authorization_scope: 'dispatch', quota_provider: 'api_key', quota_status: 'unsupported', quota_source: 'fixture unsupported',
    })
    store.acquireLease(childAudit.id, 'api_key', '')
    const childDispatching = store.transitionTask(childAudit.id, childAudit.revision, 'dispatching')
    const childRunning = store.markRunning(childDispatching.id, childDispatching.revision, 'worker-session', 'worker-run')
    const childWaiting = store.transitionTask(childRunning.id, childRunning.revision, 'waiting_user')
    const childQueued = store.transitionTask(childWaiting.id, childWaiting.revision, 'queued_quota', { block_reason: 'quota' })
    const question = store.createMessage({ project_id: project.id, task_id: childQueued.id, from: 'worker', to: 'user', kind: 'question', body: 'Read tool needs approval', continuation_id: 'pending-manual-answer' })
    const accepted = store.recordAnswer(question.id, question.revision, 'allow', 'initial-answer-key')
    store.recordAnswerOutcome(accepted.message.id, { resumed: false, state: 'queued_quota', error: 'answer saved; resume held because Codex capacity is unsupported' })
    store.releaseLease(childQueued.id, 'simulate parked lease expiry')
    const blockerAgent = store.putAgent({ id: randomUUID(), profile: 'fixture', role: 'worker', display_name: 'workspace blocker', lifecycle: 'task_bound', home_project_id: project.id })
    const blockerDraft = store.createTask({ project_id: project.id, title: 'Existing checkout holder', prompt: 'hold the checkout', agent_id: blockerAgent.id, workspace_mode: 'shared_checkout' })
    const blockerReady = store.transitionTask(blockerDraft.id, blockerDraft.revision, 'ready')
    store.acquireLease(blockerReady.id, 'api_key', '')
    const blockerDispatching = store.transitionTask(blockerReady.id, blockerReady.revision, 'dispatching')
    store.markRunning(blockerDispatching.id, blockerDispatching.revision, 'blocker-session', 'blocker-run')
    const quotaProvider = { read: vi.fn(async () => ({ provider: 'api_key', account_scope: '', status: 'unsupported' as const, windows: [], source: 'fixture unsupported' })) }
    const runtime = { answer: vi.fn(async ({ store: targetStore, question: targetQuestion, answer: answerBody, dispatchWorker }: any) => {
      expect(answerBody).toBe('allow')
      expect(typeof dispatchWorker).toBe('function')
      const current = targetStore.getTask(targetQuestion.task_id)!
      targetStore.transitionTask(current.id, current.revision, 'running', { session_id: current.session_id, run_id: current.run_id })
      return { resumed: true, state: 'running' }
    }) }
    const base = await start({ baseDirectory, rootPolicy, runtime, quotaProvider })

    const currentQuestion = store.snapshot().messages.find(item => item.id === question.id)!
    const stale = await call<any>(base, user, `/town/messages/${question.id}/answer`, 'POST', { revision: currentQuestion.revision - 1, body: 'allow', manual_quota_override: true })
    expect(stale.status).toBe(409)
    const altered = await call<any>(base, user, `/town/messages/${question.id}/answer`, 'POST', { revision: currentQuestion.revision, body: 'deny', manual_quota_override: true })
    expect(altered.status).toBe(409)
    expect(store.snapshot().messages.find(item => item.id === accepted.message.id)).toMatchObject({ body: 'allow', answer_outcome: { state: 'queued_quota' } })

    const held = await call<any>(base, user, `/town/messages/${question.id}/answer`, 'POST', { revision: currentQuestion.revision, body: 'allow', manual_quota_override: true })
    expect(held.status, JSON.stringify(held.body)).toBe(200)
    expect(held.body).toMatchObject({ resumed: false, state: 'queued_concurrency', quota: { status: 'unsupported' }, message: { id: accepted.message.id, body: 'allow', answer_outcome: { state: 'queued_concurrency' } } })
    expect(runtime.answer).not.toHaveBeenCalled()
    expect(store.getTask(childQueued.id)?.state).toBe('queued_concurrency')
    store.releaseLease(blockerDraft.id, 'free checkout for explicit retry')

    const resumed = await call<any>(base, user, `/town/messages/${question.id}/answer`, 'POST', { revision: currentQuestion.revision, body: 'allow', manual_quota_override: true })
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200)
    expect(resumed.body).toMatchObject({ resumed: true, state: 'running', quota: { provider: 'api_key', status: 'unsupported' }, manual_quota_override: { authorization_scope: 'answer_resume', quota_status: 'unsupported', authority_task_id: planner.id, authorized_by: user }, message: { body: 'allow', answer_outcome: { resumed: true, state: 'running' } } })
    expect(runtime.answer).toHaveBeenCalledOnce()
    expect(quotaProvider.read).toHaveBeenCalledTimes(2)
    expect(store.getTask(childQueued.id)).toMatchObject({ state: 'running', manual_quota_override: { authorization_scope: 'answer_resume', quota_status: 'unsupported', authority_task_id: planner.id } })
    expect(store.snapshot().messages.filter(item => item.reply_to === question.id)).toHaveLength(1)
    expect(store.snapshot().messages.find(item => item.id === question.id)?.continuation_id).toBeUndefined()

    const unrelatedDraft = store.createTask({ project_id: project.id, title: 'Unrelated', prompt: 'other work', workspace_mode: 'read_only' })
    const unrelatedReady = store.transitionTask(unrelatedDraft.id, unrelatedDraft.revision, 'ready')
    store.acquireLease(unrelatedDraft.id, 'other-provider', 'other-account')
    const unrelatedDispatching = store.transitionTask(unrelatedReady.id, unrelatedReady.revision, 'dispatching')
    const unrelatedRunning = store.markRunning(unrelatedDispatching.id, unrelatedDispatching.revision, 'other-session', 'other-run')
    const unrelatedWaiting = store.transitionTask(unrelatedRunning.id, unrelatedRunning.revision, 'waiting_user')
    const unrelatedQuestion = store.createMessage({ project_id: project.id, task_id: unrelatedWaiting.id, from: 'worker', to: 'user', kind: 'question', body: 'Other approval', continuation_id: 'pending-unrelated' })
    const denied = await call<any>(base, user, `/town/messages/${unrelatedQuestion.id}/answer`, 'POST', { revision: unrelatedQuestion.revision, body: 'allow', manual_quota_override: true })
    expect(denied.status).toBe(403)
    expect(runtime.answer).toHaveBeenCalledOnce()
    expect(quotaProvider.read).toHaveBeenCalledTimes(2)
    expect(store.snapshot().messages.some(item => item.kind === 'answer' && item.reply_to === unrelatedQuestion.id)).toBe(false)
  })

  it('cancellation and restart close a queued answer continuation without a late resume', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-answer-stop-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-answer-stop-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-answer-stop-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory })
    const project = fixtureProject(store)
    const draft = store.createTask({ project_id: project.id, title: 'Question', prompt: 'ask', workspace_mode: 'read_only' })
    const ready = store.transitionTask(draft.id, draft.revision, 'ready')
    const dispatching = store.transitionTask(draft.id, ready.revision, 'dispatching')
    const running = store.transitionTask(draft.id, dispatching.revision, 'running', { session_id: 'session-1', run_id: 'run-1' })
    store.transitionTask(draft.id, running.revision, 'waiting_user')
    const question = store.createMessage({ project_id: project.id, task_id: draft.id, from: 'worker', to: 'user', kind: 'question', body: 'Choose?', continuation_id: 'pending-stop' })
    let capacity = false
    const quotaProvider = { read: vi.fn(async () => capacity
      ? { provider: 'codex', account_scope: 'scope-hash', status: 'available', expires_at: new Date(Date.now() + 30_000).toISOString(), windows: [{ used_percent: 12 }], source: 'fixture' }
      : { provider: 'codex', account_scope: 'scope-hash', status: 'unavailable', windows: [], source: 'fixture', last_error: 'probe unavailable' }) }
    const runtime = { answer: vi.fn(async () => ({ resumed: true, state: 'running' })) }
    const base = await start({ baseDirectory, rootPolicy, runtime, quotaProvider, queuePollMs: 1000 })
    const payload = { revision: question.revision, body: 'yes', answer_key: 'stable-stop-key' }
    const first = await call<any>(base, user, `/town/messages/${question.id}/answer`, 'POST', payload)
    expect(first.body).toMatchObject({ resumed: false, state: 'queued_quota' })
    const current = store.getTask(draft.id)!
    await call(base, user, `/town/tasks/${draft.id}/cancel`, 'POST', { revision: current.revision })
    const cancelledQuestion = store.snapshot().messages.find(item => item.id === question.id)!
    expect(cancelledQuestion.continuation_id).toBeUndefined()
    capacity = true
    await new Promise(resolve => setTimeout(resolve, 1100))
    expect(runtime.answer).not.toHaveBeenCalled()

    const second = store.createTask({ project_id: project.id, title: 'Interrupted question', prompt: 'ask', workspace_mode: 'read_only' })
    const secondReady = store.transitionTask(second.id, second.revision, 'ready')
    const secondDispatching = store.transitionTask(second.id, secondReady.revision, 'dispatching')
    const secondRunning = store.transitionTask(second.id, secondDispatching.revision, 'running', { session_id: 'session-2', run_id: 'run-2' })
    store.transitionTask(second.id, secondRunning.revision, 'waiting_user')
    const secondQuestion = store.createMessage({ project_id: project.id, task_id: second.id, from: 'worker', to: 'user', kind: 'question', body: 'Choose?', continuation_id: 'pending-restart' })
    // Queue this second answer with a fresh isolated provider that reports unavailable.
    capacity = false
    const queued = await call<any>(base, user, `/town/messages/${secondQuestion.id}/answer`, 'POST', { revision: secondQuestion.revision, body: 'yes', answer_key: 'stable-restart-key' })
    expect(queued.body.state).toBe('queued_quota')
    new TownStore(user, { baseDirectory, recovery: 'force' })
    expect(store.getTask(second.id)?.state).toBe('interrupted')
    expect(store.snapshot().messages.find(item => item.id === secondQuestion.id)?.continuation_id).toBeUndefined()
    expect(runtime.answer).not.toHaveBeenCalled()
  })

  it('rechecks queued quota work on a bounded cadence and starts when live quota recovers', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'town-store-queue-'))
    const rootPolicy = mkdtempSync(join(tmpdir(), 'town-root-queue-'))
    owned.push(baseDirectory, rootPolicy)
    const user = `town-queue-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory, recovery: 'none' })
    const project = fixtureProject(store)
    const task = store.createTask({ project_id: project.id, title: 'Queued worker', prompt: 'inspect', workspace_mode: 'read_only' })
    let available = false
    const quotaProvider = { read: vi.fn(async () => available
      ? { provider: 'codex', account_scope: 'scope-hash', status: 'available', fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), windows: [{ used_percent: 30 }], source: 'fixture live' }
      : { provider: 'codex', account_scope: 'scope-hash', status: 'unsupported', windows: [], source: 'fixture unsupported' }) }
    const runtime = { start: vi.fn(async () => ({ session_id: 'session-resumed', run_id: 'run-resumed' })) }
    const base = await start({ baseDirectory, rootPolicy, queuePollMs: 1000, quotaProvider, runtime })
    const queued = await call<any>(base, user, `/town/tasks/${task.id}/dispatch`, 'POST', { revision: task.revision })
    expect(queued.body).toMatchObject({ decision: 'queued', reason: 'quota', task: { state: 'queued_quota' } })
    available = true
    await vi.waitFor(() => expect(runtime.start).toHaveBeenCalledOnce(), { timeout: 3000, interval: 20 })
    expect(store.getTask(task.id)).toMatchObject({ state: 'running', run_id: 'run-resumed', session_id: 'session-resumed' })
  })
})
