import { afterEach, describe, expect, it } from 'vitest'
import { harnessStatePath } from '../src/config/state-paths.js'
import { rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { RunStore } from '../src/runs/store.js'
import { sanitizeUserId } from '../src/session/user-paths.js'
import type { Run } from '../src/runs/types.js'

const owned: string[] = []
afterEach(() => { for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true }) })

function run(id: string, user: string, updated_at: string, profile = 'coding', status: Run['status'] = 'completed'): Run {
  return { id, user, profile, status, trigger: 'rest', input: {}, started_at: updated_at, updated_at, revision: 1 }
}

describe('Core bounded run history cursor', () => {
  it('binds cursor to user/profile/status and continues after deleted anchor', () => {
    const user = `history-${randomUUID()}`
    owned.push(harnessStatePath('runs', sanitizeUserId(user)))
    const store = new RunStore()
    store.create(run('history-1', user, '2026-01-01T00:00:01.000Z'))
    store.create(run('history-2', user, '2026-01-01T00:00:02.000Z'))
    store.create(run('history-3', user, '2026-01-01T00:00:03.000Z'))
    const first = store.listPage({ user, profile: 'coding', status: 'completed', limit: 2 })
    expect(first.runs.map(item => item.id)).toEqual(['history-3', 'history-2'])
    rmSync(harnessStatePath('runs', sanitizeUserId(user), '2026-01-01_history-2.json'), { force: true })
    const second = store.listPage({ user, profile: 'coding', status: 'completed', limit: 2, cursor: first.next_cursor })
    expect(second.runs.map(item => item.id)).toEqual(['history-1'])
    expect(() => store.listPage({ user, profile: 'other', status: 'completed', cursor: first.next_cursor })).toThrow('invalid run history cursor')
    expect(() => store.listPage({ user: `${user}-other`, profile: 'coding', status: 'completed', cursor: first.next_cursor })).toThrow('invalid run history cursor')
  })

  it('uses versioned aggregate cursor scope and rejects malformed cursors', () => {
    const user = `history-aggregate-${randomUUID()}`
    owned.push(harnessStatePath('runs', sanitizeUserId(user)))
    const store = new RunStore(); store.create(run('aggregate-1', user, '2026-01-01T00:00:01.000Z')); store.create(run('aggregate-2', user, '2026-01-01T00:00:02.000Z'))
    const page = store.listPage({ limit: 1 })
    expect(() => store.listPage({ user, cursor: page.next_cursor })).toThrow('invalid run history cursor')
    expect(() => store.listPage({ cursor: Buffer.from(JSON.stringify({ version: 1, user: null, profile: null, status: null, updated_at: 'bad', id: 'x' })).toString('base64url') })).toThrow('invalid run history cursor')
  })
})
