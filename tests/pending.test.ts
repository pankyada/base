import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PendingStore } from '../src/runs/pending.js'
import { ParkSignal } from '../src/runs/park.js'

function tempStore() {
  return new PendingStore(mkdtempSync(join(tmpdir(), 'harness-pending-')))
}

describe('PendingStore', () => {
  it('persists pending input and answers it once', () => {
    const store = tempStore()
    const pending = store.create({
      id: 'pending-1', run_id: 'run-1', session_id: 'session-1', user: 'alice', profile: 'p',
      prompt: 'Pick one', kind: 'select', options: ['a', 'b'], channel: 'stdout',
      created_at: '2026-08-06T00:00:00.000Z', expires_at: '2026-08-06T01:00:00.000Z',
    })

    expect(store.get('pending-1')).toMatchObject({ state: 'open', prompt: 'Pick one' })
    expect(store.answer('pending-1', 'a', 'rest')).toMatchObject({ state: 'answered', answer: 'a', answered_via: 'rest' })
    expect(store.answer('pending-1', 'b', 'rest')).toBeNull()
    expect(JSON.parse(readFileSync(pending.path, 'utf8')).answer).toBe('a')
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
