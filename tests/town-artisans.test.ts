import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createRestHandler } from '../src/server/rest.js'
import { TownStore } from '../src/town/store.js'
import { ARTISANS, artisanBusyWith, artisanId, artisanPrompt, ensureArtisans } from '../src/town/artisans.js'
import { createTownRuntime } from '../src/town/runtime.js'
import { RunStore } from '../src/runs/store.js'
import { PendingStore } from '../src/runs/pending.js'
import { clearRegistry, registerAll } from '../src/tools/builtin/index.js'
import type { ProviderClient, ProviderRequest } from '../src/provider/types.js'
import type { Profile } from '../src/profiles/schema.js'

const owned: string[] = []
const servers: Array<{ server: Server; dispose: () => Promise<void> }> = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(async ({ server, dispose }) => {
    await dispose()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }))
  for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true })
})

const temp = (prefix: string) => { const path = mkdtempSync(join(tmpdir(), prefix)); owned.push(path); return path }

async function start(options: { baseDirectory: string; rootPolicy: string; quotaProvider?: any; runtime?: any }) {
  const handler = createRestHandler({ defaultProfile: { name: 'fixture', model: { auth: 'codex' } } as any, town: options } as any)
  const server = createServer((req, res) => { void handler(req, res) })
  servers.push({ server, dispose: handler.close })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function call<T = any>(base: string, user: string, path: string, method = 'GET', payload?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}?user=${encodeURIComponent(user)}`, {
    method, ...(payload === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
  })
  return { status: response.status, body: await response.json() as T }
}

function project(store: TownStore) {
  return store.putProject({ path: temp('town-artisan-project-'), git: { status: 'known', head: 'abc', dirty: false }, scanned_at: new Date().toISOString(), display: { name: 'Fixture' } })
}

const available = () => ({ read: vi.fn(async () => ({ provider: 'codex', account_scope: 'scope', status: 'available', fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), windows: [{ used_percent: 10 }], source: 'fixture' })) })
const exhausted = () => ({ read: vi.fn(async () => ({ provider: 'codex', account_scope: 'scope', status: 'available', fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), windows: [{ used_percent: 100 }], source: 'fixture' })) })

describe('Town artisans (PT-117)', () => {
  it('seeds the nine masters once with stable persistent identities', () => {
    const store = new TownStore(`artisan-seed-${randomUUID()}`, { baseDirectory: temp('town-artisan-state-') })
    ensureArtisans(store, 'fixture')
    const renamed = store.snapshot().agents.find(agent => agent.id === artisanId('vishwakarma'))!
    store.putAgent({ ...renamed, display_name: 'Vishwakarma the elder' })
    ensureArtisans(store, 'fixture')
    const agents = store.snapshot().agents
    expect(agents).toHaveLength(ARTISANS.filter(item => item.master).length)
    expect(agents.every(agent => agent.lifecycle === 'persistent' && agent.persona && agent.craft)).toBe(true)
    expect(agents.find(agent => agent.id === artisanId('chanakya'))).toMatchObject({ role: 'orchestrator', craft: 'planner' })
    expect(agents.find(agent => agent.id === artisanId('vishwakarma'))?.display_name).toBe('Vishwakarma the elder')
  })

  it('hires an apprentice and rejects duplicate or unknown artisans', async () => {
    const baseDirectory = temp('town-artisan-hire-'), rootPolicy = temp('town-artisan-root-')
    const base = await start({ baseDirectory, rootPolicy })
    const user = `artisan-hire-${randomUUID()}`
    const initial = await call(base, user, '/town/snapshot')
    expect(initial.body.agents.map((agent: any) => agent.persona)).toContain('vishwakarma')
    const hired = await call(base, user, '/town/agents', 'POST', { persona: 'tvashta' })
    expect(hired.status).toBe(201)
    expect(hired.body.agent).toMatchObject({ id: 'artisan-tvashta', craft: 'builder', lifecycle: 'persistent', profile: 'fixture' })
    expect((await call(base, user, '/town/agents', 'POST', { persona: 'tvashta' })).status).toBe(409)
    expect((await call(base, user, '/town/agents', 'POST', { persona: 'vishwakarma' })).status).toBe(409)
    expect((await call(base, user, '/town/agents', 'POST', { persona: 'zeus' })).status).toBe(400)
  })

  it('assigns and dispatches in one call, queues for quota, and serialises a busy artisan', async () => {
    const baseDirectory = temp('town-artisan-assign-'), rootPolicy = temp('town-artisan-root-')
    const user = `artisan-assign-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory })
    const fixture = project(store)
    const runtime = { start: vi.fn(async () => ({ session_id: `session-${randomUUID()}`, run_id: `run-${randomUUID()}` })) }
    const base = await start({ baseDirectory, rootPolicy, quotaProvider: available(), runtime })
    const snapshot = await call(base, user, '/town/snapshot')
    const started = await call(base, user, `/town/agents/${artisanId('vishwakarma')}/assign`, 'POST', { project_id: fixture.id, prompt: 'Build the fixture feature', revision: snapshot.body.cursor })
    expect(started.status).toBe(202)
    expect(started.body).toMatchObject({ decision: 'started', task: { state: 'running', agent_id: artisanId('vishwakarma'), workspace_mode: 'shared_checkout', title: 'Build the fixture feature' } })
    expect(runtime.start).toHaveBeenCalledOnce()

    const next = await call(base, user, '/town/snapshot')
    const second = await call(base, user, `/town/agents/${artisanId('vishwakarma')}/assign`, 'POST', { project_id: fixture.id, prompt: 'Second order', revision: next.body.cursor })
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ decision: 'queued', reason: 'concurrency', detail: 'agent_busy', task: { state: 'queued_concurrency', block_reason: 'agent_busy' } })
    expect(runtime.start).toHaveBeenCalledOnce()

    const reviewer = await call(base, user, `/town/agents/${artisanId('panini')}/assign`, 'POST', { project_id: fixture.id, prompt: 'Review it', revision: (await call(base, user, '/town/snapshot')).body.cursor })
    expect(reviewer.body.task.workspace_mode).toBe('read_only')
    expect(reviewer.body.decision).toBe('queued')
    expect(reviewer.body.detail).toBeUndefined()
  })

  it('queues an assignment for quota and refuses unknown or retired artisans', async () => {
    const baseDirectory = temp('town-artisan-quota-'), rootPolicy = temp('town-artisan-root-')
    const user = `artisan-quota-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory })
    const fixture = project(store)
    const base = await start({ baseDirectory, rootPolicy, quotaProvider: exhausted(), runtime: { start: vi.fn() } })
    const cursor = (await call(base, user, '/town/snapshot')).body.cursor
    const queued = await call(base, user, `/town/agents/${artisanId('aryabhata')}/assign`, 'POST', { project_id: fixture.id, prompt: 'Run tests', revision: cursor })
    expect(queued.body).toMatchObject({ decision: 'queued', reason: 'quota', task: { state: 'queued_quota' } })
    expect((await call(base, user, '/town/agents/artisan-nobody/assign', 'POST', { project_id: fixture.id, prompt: 'x', revision: cursor })).status).toBe(404)
    const nandi = store.snapshot().agents.find(agent => agent.id === artisanId('nandi'))!
    store.putAgent({ ...nandi, retired_at: new Date().toISOString() })
    const retired = await call(base, user, `/town/agents/${artisanId('nandi')}/assign`, 'POST', { project_id: fixture.id, prompt: 'x', revision: store.cursor() })
    expect(retired.status).toBe(409)
  })

  it('routes the town charge to Chanakya instead of creating a task-bound orchestrator', async () => {
    const baseDirectory = temp('town-artisan-orch-'), rootPolicy = temp('town-artisan-root-')
    const user = `artisan-orch-${randomUUID()}`
    const store = new TownStore(user, { baseDirectory })
    const fixture = project(store)
    const base = await start({ baseDirectory, rootPolicy, quotaProvider: exhausted() })
    const snapshot = await call(base, user, '/town/snapshot')
    const orchestrated = await call(base, user, '/town/orchestrate', 'POST', { revision: snapshot.body.cursor, instruction: 'plan the release', project_ids: [fixture.id] })
    expect(orchestrated.body.orchestrator_task.agent_id).toBe(artisanId('chanakya'))
    expect(store.snapshot().agents.filter(agent => agent.role === 'orchestrator')).toHaveLength(1)
  })

  it('detects a busy persistent artisan but never gates legacy task-bound agents', () => {
    const store = new TownStore(`artisan-busy-${randomUUID()}`, { baseDirectory: temp('town-artisan-busy-') })
    ensureArtisans(store, 'fixture')
    const fixture = project(store)
    const legacy = store.putAgent({ id: 'legacy', profile: 'fixture', role: 'worker', display_name: 'legacy', lifecycle: 'task_bound', state: 'idle' })
    const make = (agent: string) => store.createTask({ project_id: fixture.id, title: agent, prompt: agent, agent_id: agent, workspace_mode: 'read_only' })
    const running = make(artisanId('gargi'))
    const ready = store.transitionTask(running.id, running.revision, 'ready')
    store.transitionTask(ready.id, ready.revision, 'dispatching')
    const waiting = make(artisanId('gargi'))
    const legacyA = make(legacy.id), legacyB = make(legacy.id)
    const legacyReady = store.transitionTask(legacyA.id, legacyA.revision, 'ready')
    store.transitionTask(legacyReady.id, legacyReady.revision, 'dispatching')
    const { tasks, agents } = store.snapshot()
    expect(artisanBusyWith(tasks, agents, waiting)?.id).toBe(running.id)
    expect(artisanBusyWith(tasks, agents, legacyB)).toBeUndefined()
  })

  it('builds a persona prompt with the five most recent finished work orders', () => {
    const store = new TownStore(`artisan-prompt-${randomUUID()}`, { baseDirectory: temp('town-artisan-prompt-') })
    ensureArtisans(store, 'fixture')
    const fixture = project(store)
    const id = artisanId('sushruta')
    for (let index = 0; index < 7; index++) {
      const task = store.createTask({ project_id: fixture.id, title: `Fix ${index}`, prompt: 'p', agent_id: id, workspace_mode: 'shared_checkout' })
      const ready = store.transitionTask(task.id, task.revision, 'ready')
      const dispatching = store.transitionTask(ready.id, ready.revision, 'dispatching')
      store.transitionTask(dispatching.id, dispatching.revision, index === 6 ? 'failed' : 'cancelled', { terminal_evidence: `evidence ${index} ${'x'.repeat(400)}` })
    }
    const current = store.createTask({ project_id: fixture.id, title: 'Current', prompt: 'p', agent_id: id, workspace_mode: 'shared_checkout' })
    const { tasks, agents } = store.snapshot()
    const prompt = artisanPrompt(agents.find(agent => agent.id === id), tasks, current.id)
    expect(prompt).toContain('You are Sushruta, the Town debugger')
    expect(prompt.match(/^- \[/gm)).toHaveLength(5)
    expect(prompt).toContain('[failed] Fix 6')
    expect(prompt).not.toContain('Current')
    expect(prompt).not.toContain('x'.repeat(301))
    expect(artisanPrompt(store.putAgent({ id: 'legacy', profile: 'fixture', role: 'worker', display_name: 'legacy', lifecycle: 'task_bound' }), tasks, current.id)).toBe('')
  })

  it('lets the planner assign a persistent artisan by agent_id and records throttled tool activity', async () => {
    const root = temp('town-artisan-runtime-')
    vi.stubEnv('HARNESS_STATE_DIR', join(root, 'harness-state'))
    const projectPath = join(root, 'project'); mkdirSync(projectPath, { recursive: true })
    const store = new TownStore(`artisan-runtime-${randomUUID()}`, { baseDirectory: join(root, 'town') })
    ensureArtisans(store, 'fixture')
    const fixture = store.putProject({ path: projectPath, git: { status: 'known', head: 'h', dirty: false }, scanned_at: new Date().toISOString(), display: { name: 'Runtime' } })
    const profile = {
      name: 'fixture', model: { auth: 'codex_oauth', id: 'gpt-5.4-mini', codex: { max_model_calls_per_run: 24, request_timeout_ms: 30_000 } },
      system_prompt: join(process.cwd(), 'profiles', 'assistant.md'), working_dir: projectPath, artifact_dir: join(root, 'artifacts'),
      memory: { provider: 'fs' }, tools: { builtin: {}, custom: {}, mcp_servers: [] }, hooks: { pre_tool: [], post_tool: [], on_stop: [] },
      safety: { enabled: false, timeout_ms: 1000, cache_ttl_hours: 1, gate_untrusted_actions: false, gate_writes: false },
      max_depth: 1, agents: [], lists: {}, approval_mode: 'danger',
    } as unknown as Profile
    clearRegistry(); registerAll(undefined, profile)
    const systemPrompts: string[] = []
    const assignResults: string[] = []
    const provider: ProviderClient = {
      kind: 'codex_oauth', model: profile.model.id,
      async generate() { throw new Error('stream only') },
      async *stream(request: ProviderRequest, context) {
        context?.beforeAttempt?.()
        systemPrompts.push(request.messages.filter(message => message.role === 'system').map(message => String(message.content)).join('\n'))
        const toolMessages = request.messages.filter(message => message.role === 'tool')
        if (toolMessages.length === 0) {
          const task = store.createTask({ project_id: fixture.id, title: 'Build it', prompt: 'build', workspace_mode: 'shared_checkout', created_by_task_id: planning.id })
          yield { type: 'done', result: { text: '', toolCalls: [{ id: 'assign', name: 'TownAssign', arguments: JSON.stringify({ task_id: task.id, agent_id: artisanId('vishwakarma') }) }], finishReason: 'tool_calls' } }
          return
        }
        assignResults.push(String(toolMessages.at(-1)?.content))
        yield { type: 'done', result: { text: 'Assigned.', toolCalls: [], finishReason: 'stop' } }
      },
    }
    const runtime = createTownRuntime({ runStore: new RunStore(), pendingStore: new PendingStore(join(root, 'pending')), abortRegistry: new Map(), profiles: new Map([[profile.name, profile]]), providerForProfile: () => provider })
    const draft = store.createTask({ project_id: fixture.id, title: 'Plan', prompt: 'plan', agent_id: artisanId('chanakya'), workspace_mode: 'read_only' })
    const ready = store.transitionTask(draft.id, draft.revision, 'ready')
    expect(store.acquireLease(ready.id, 'codex_oauth', 'acct').lease).toBeTruthy()
    const planning = store.transitionTask(ready.id, ready.revision, 'dispatching')
    const started = await runtime.start({ user: store.user, profile, task: planning, project: fixture, workingDirectory: projectPath, orchestrator: true, store, dispatchWorker: vi.fn() as any })
    store.markRunning(planning.id, planning.revision, started.session_id, started.run_id)
    await vi.waitFor(() => expect(store.getTask(planning.id)?.state).toBe('completed'), { timeout: 10_000, interval: 10 })
    expect(systemPrompts[0]).toContain('You are Chanakya, the Town planner')
    expect(systemPrompts[0]).toContain('persistent artisan')
    expect(JSON.parse(assignResults[0]!)).toMatchObject({ agent_id: artisanId('vishwakarma'), craft: 'builder' })
    const built = store.snapshot().tasks.find(task => task.title === 'Build it')!
    expect(built.agent_id).toBe(artisanId('vishwakarma'))
    const planner = store.snapshot().agents.find(agent => agent.id === artisanId('chanakya'))!
    expect(planner.last_tool).toBe('TownAssign')
    expect(planner.last_activity_at).toBeTruthy()
    expect(store.events(0).events.filter(event => event.type === 'agent.activity')).toHaveLength(1)
  })
})
