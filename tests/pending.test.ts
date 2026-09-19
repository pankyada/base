import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PendingStore } from '../src/runs/pending.js'
import { ParkSignal } from '../src/runs/park.js'
import { randomUUID } from 'node:crypto'

const previousStateDir = process.env.HARNESS_STATE_DIR
const roots: string[] = []

afterEach(() => {
  if (previousStateDir === undefined) delete process.env.HARNESS_STATE_DIR
  else process.env.HARNESS_STATE_DIR = previousStateDir
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempStore(now: () => Date = () => new Date()) {
  return new PendingStore(mkdtempSync(join(tmpdir(), 'harness-pending-')), now)
}

describe('PendingStore', () => {
  it('uses the configured state root for the default pending store', () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-pending-root-'))
    roots.push(root)
    process.env.HARNESS_STATE_DIR = root
    const store = new PendingStore()
    const pending = store.create({ id: randomUUID(), run_id: 'run-isolated', session_id: 'session-isolated', user: 'alice', profile: 'coding', prompt: 'Continue?', kind: 'text', created_at: '2026-08-06T00:00:00.000Z', expires_at: '2099-08-06T00:00:00.000Z' })
    expect(existsSync(join(root, 'pending', 'alice', `${pending.created_at.slice(0, 10)}_${pending.id}.json`))).toBe(true)
  })

  it('persists pending input and answers it once', () => {
    const store = tempStore(() => new Date('2026-08-06T00:30:00.000Z'))
    const pending = store.create({
      id: 'pending-1', run_id: 'run-1', session_id: 'session-1', user: 'alice', profile: 'p',
      prompt: 'Pick one', kind: 'select', options: ['a', 'b'], channel: 'stdout',
      created_at: '2026-08-06T00:00:00.000Z', expires_at: '2026-08-06T01:00:00.000Z',
    })

    expect(store.get('pending-1')).toMatchObject({ state: 'open', prompt: 'Pick one' })
    expect(store.answer('pending-1', 'a', 'rest')).toMatchObject({ state: 'answered', answer: 'a', answered_via: 'rest' })
    expect(store.answer('pending-1', 'b', 'rest')).toBeNull()
    expect(JSON.parse(readFileSync(pending.path, 'utf8')).answer).toBe('a')
    expect(readdirSync(join(pending.path, '..')).some(file => file.endsWith('.tmp'))).toBe(false)
  })

  it('validates select and multi-select answers before durable transition', () => {
    const store = tempStore()
    store.create({ id: 'pending-select', run_id: 'r', session_id: 's', user: 'alice', profile: 'p', prompt: 'Pick', kind: 'select', options: ['a', 'b'], created_at: '2026-08-06T00:00:00.000Z', expires_at: '2099-08-06T00:00:00.000Z' })
    expect(store.answer('pending-select', 'z', 'rest')).toBeNull()
    expect(store.get('pending-select')?.state).toBe('open')
    store.create({ id: 'pending-multi', run_id: 'r', session_id: 's', user: 'alice', profile: 'p', prompt: 'Pick', kind: 'multi_select', options: ['a', 'b'], created_at: '2026-08-06T00:00:00.000Z', expires_at: '2099-08-06T00:00:00.000Z' })
    expect(store.answer('pending-multi', 'a,b', 'rest')).toMatchObject({ state: 'answered' })
  })

  it('expires open records with an explicit state', () => {
    const store = tempStore()
    store.create({
      id: 'pending-2', run_id: 'run-2', session_id: 'session-2', user: 'alice', profile: 'p',
      prompt: 'Question', kind: 'text', created_at: '2026-08-06T00:00:00.000Z',
      expires_at: '2026-08-06T01:00:00.000Z',
    })

    expect(store.sweep(new Date('2026-08-06T02:00:00.000Z'))).toHaveLength(1)
    expect(store.get('pending-2')).toMatchObject({ state: 'expired' })
    expect(store.answer('pending-2', 'late', 'rest')).toBeNull()
  })
})

describe('ParkSignal', () => {
  it('is identifiable without treating park as a failure', () => {
    const signal = new ParkSignal('pending-3')
    expect(signal.name).toBe('ParkSignal')
    expect(signal.pendingId).toBe('pending-3')
  })
})
