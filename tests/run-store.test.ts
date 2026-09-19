import { afterAll, afterEach, describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStore } from '../src/runs/store.js'
import type { Run } from '../src/runs/types.js'

const priorStateDir = process.env.HARNESS_STATE_DIR
const tempRoots: string[] = []
const suiteRoot = mkdtempSync(join(tmpdir(), 'harness-run-store-suite-'))
tempRoots.push(suiteRoot)
const store = new RunStore(join(suiteRoot, 'runs'))

afterEach(() => {
  if (priorStateDir === undefined) delete process.env.HARNESS_STATE_DIR
  else process.env.HARNESS_STATE_DIR = priorStateDir
})

afterAll(() => { for (const root of tempRoots) rmSync(root, { recursive: true, force: true }) })

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: Math.random().toString(36).slice(2, 10),
    profile: 'test-profile',
    user: 'testuser',
    trigger: 'rest',
    input: 'hello',
    status: 'running',
    started_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('RunStore', () => {
  it('creates and retrieves a run by id', () => {
    const run = makeRun()
    store.create(run)
    const found = store.get(run.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(run.id)
    expect(found!.profile).toBe('test-profile')
  })

  it('updates run status', () => {
    const run = makeRun()
    store.create(run)
    store.update(run.id, { status: 'completed', finished_at: new Date().toISOString() })
    const updated = store.get(run.id)
    expect(updated!.status).toBe('completed')
    expect(updated!.finished_at).toBeDefined()
  })

  it('returns null for unknown id', () => {
    expect(store.get('doesnotexist')).toBeNull()
  })

  it('lists runs filtered by user', () => {
    const alice = makeRun({ user: 'alice', id: 'alice001' })
    const bob = makeRun({ user: 'bob', id: 'bob00001' })
    store.create(alice)
    store.create(bob)
    const results = store.list({ user: 'alice' })
    const ids = results.map(r => r.id)
    expect(ids).toContain('alice001')
    expect(ids).not.toContain('bob00001')
  })

  it('lists runs filtered by status', () => {
    const running = makeRun({ id: 'run00001', status: 'running' })
    const done = makeRun({ id: 'done0001', status: 'completed' })
    store.create(running)
    store.create(done)
    const results = store.list({ status: 'running', user: 'testuser' })
    expect(results.some(r => r.id === 'run00001')).toBe(true)
    expect(results.some(r => r.id === 'done0001')).toBe(false)
  })

  it('scanRunning returns all running runs', () => {
    const run = makeRun({ id: 'scan0001', status: 'running' })
    store.create(run)
    const running = store.scanRunning()
    expect(running.some(r => r.id === 'scan0001')).toBe(true)
  })

  it('scopes crash-recovery scans and writes to the configured state root', () => {
    const sharedRoot = mkdtempSync(join(tmpdir(), 'harness-runs-shared-'))
    const isolatedRoot = mkdtempSync(join(tmpdir(), 'harness-runs-isolated-'))
    tempRoots.push(sharedRoot, isolatedRoot)
    const id = 'same-run-id'
    const shared = new RunStore(join(sharedRoot, 'runs'))
    const sharedRun = makeRun({ id, user: 'alice', input: 'shared run' })
    shared.create(sharedRun)

    process.env.HARNESS_STATE_DIR = isolatedRoot
    const isolated = new RunStore()
    expect(isolated.scanRunning()).toEqual([])
    const isolatedRun = makeRun({ id, user: 'alice', input: 'isolated run' })
    isolated.create(isolatedRun)

    expect(readFileSync(join(isolatedRoot, 'runs', 'alice', `${isolatedRun.started_at.slice(0, 10)}_${id}.json`), 'utf8')).toContain('isolated run')
    expect(shared.get(id)?.input).toBe('shared run')
    expect(shared.scanRunning()).toMatchObject([{ id, status: 'running', input: 'shared run' }])
  })
})
