import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  atomicWriteJson,
  readJson,
  RevisionConflictError,
} from '../src/shared/atomic-json.js'
import {
  createSession,
  listSessionHistory,
  listSessions,
  loadSession,
  saveSession,
} from '../src/session/store.js'
import { userPaths, sanitizeUserId } from '../src/session/user-paths.js'
import type { Session } from '../src/session/types.js'
import { RunStore } from '../src/runs/store.js'
import { harnessStatePath } from '../src/config/state-paths.js'
import type { Run } from '../src/runs/types.js'

const ownedPaths: string[] = []

function uniqueUser(): string {
  const user = `r2-acceptance-${randomUUID()}`
  ownedPaths.push(userPaths(user, '').sessionsDir)
  ownedPaths.push(harnessStatePath('runs', sanitizeUserId(user)))
  return user
}

function sessionFixture(id: string, user: string, updatedAt: string, project = 'inbox'): Session {
  return {
    id,
    revision: 1,
    updated_at: updatedAt,
    user,
    profile: 'coding',
    project,
    created_at: updatedAt,
    messages: [],
    tool_calls: [],
    usage: { input: 0, output: 0, cost_usd: 0 },
    session_memory: {},
    todos: [],
  }
}

function runFixture(id: string, user: string, startedAt: string): Run {
  return {
    id,
    revision: 1,
    updated_at: startedAt,
    profile: 'coding',
    user,
    trigger: 'rest',
    input: { id },
    status: 'completed',
    started_at: startedAt,
  }
}

afterEach(() => {
  for (const path of ownedPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('R2 persistence acceptance', () => {
  it('preserves the prior record when an atomic rename is interrupted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-r2-atomic-'))
    ownedPaths.push(dir)
    const path = join(dir, 'record.json')
    atomicWriteJson(path, { revision: 1, value: 'prior' })

    expect(() => atomicWriteJson(path, { revision: 2, value: 'new' }, {
      beforeRename: () => { throw new Error('simulated interruption') },
    })).toThrow('simulated interruption')
    expect(readJson<{ revision: number; value: string }>(path)).toEqual({ revision: 1, value: 'prior' })
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('loads exact session and run ids when one id prefixes another', () => {
    const user = uniqueUser()
    const short = createSession('coding', user)
    short.id = 'abc12345'
    const long = createSession('coding', user)
    long.id = 'abc123456'
    saveSession(short)
    saveSession(long)
    expect(loadSession(user, short.id)?.id).toBe(short.id)
    expect(loadSession(user, long.id)?.id).toBe(long.id)

    const store = new RunStore()
    store.create({ ...runFixture('run-a', user, '2026-01-01T00:00:00.000Z') })
    store.create({ ...runFixture('run-ab', user, '2026-01-01T00:00:01.000Z') })
    expect(store.get('run-a')?.id).toBe('run-a')
    expect(store.get('run-ab')?.id).toBe('run-ab')
  })

  it('isolates corrupt records while listing healthy session and run history', () => {
    const user = uniqueUser()
    const session = createSession('coding', user)
    session.id = 'healthy01'
    saveSession(session)
    const sessionsDir = userPaths(user, '').sessionsDir
    writeFileSync(join(sessionsDir, 'corrupt.json'), '{broken', 'utf8')
    expect(listSessions(user).map(item => item.id)).toEqual(['healthy01'])
    const sessionPage = listSessionHistory(user)
    expect(sessionPage.items.map(item => item.id)).toEqual(['healthy01'])
    expect(sessionPage.diagnostics.some(item => item.path.endsWith('corrupt.json'))).toBe(true)

    const store = new RunStore()
    store.create(runFixture('healthy-run', user, '2026-01-01T00:00:00.000Z'))
    const runDir = harnessStatePath('runs', sanitizeUserId(user))
    writeFileSync(join(runDir, 'corrupt.json'), '{broken', 'utf8')
    expect(store.list({ user }).map(item => item.id)).toEqual(['healthy-run'])
    expect(store.getDiagnostics().some(item => item.path.endsWith('corrupt.json'))).toBe(true)
  })

  it('rebuilds missing or corrupt history indexes from valid records', () => {
    const user = uniqueUser()
    const sessionsDir = userPaths(user, '').sessionsDir
    mkdirSync(sessionsDir, { recursive: true })
    const first = sessionFixture('index001', user, '2026-01-01T00:00:00.000Z')
    atomicWriteJson(join(sessionsDir, '2026-01-01_index001.json'), first)
    const firstPage = listSessionHistory(user)
    const sessionIndex = join(sessionsDir, 'index.json')
    expect(firstPage.items.map(item => item.id)).toEqual(['index001'])
    expect(existsSync(sessionIndex)).toBe(true)

    writeFileSync(sessionIndex, '{broken', 'utf8')
    const rebuiltPage = listSessionHistory(user)
    expect(rebuiltPage.items.map(item => item.id)).toEqual(['index001'])
    expect(rebuiltPage.diagnostics.some(item => item.path === sessionIndex)).toBe(true)
    expect(() => readJson(sessionIndex)).not.toThrow()

    const store = new RunStore()
    store.create(runFixture('index-run', user, '2026-01-01T00:00:00.000Z'))
    const runIndex = harnessStatePath('runs', sanitizeUserId(user), 'index.json')
    expect(existsSync(runIndex)).toBe(true)
    writeFileSync(runIndex, '{broken', 'utf8')
    expect(store.list({ user }).map(item => item.id)).toContain('index-run')
    expect(() => readJson(runIndex)).not.toThrow()
  })

  it('rejects stale session and run revisions instead of silently overwriting', () => {
    const user = uniqueUser()
    const session = createSession('coding', user)
    session.id = 'revision1'
    saveSession(session)
    const stale = loadSession(user, session.id)!
    const current = loadSession(user, session.id)!
    current.summary = 'current'
    saveSession(current)
    stale.summary = 'stale'
    expect(() => saveSession(stale)).toThrow(RevisionConflictError)
    expect(loadSession(user, session.id)?.summary).toBe('current')

    const store = new RunStore()
    store.create(runFixture('revision-run', user, '2026-01-01T00:00:00.000Z'))
    store.update('revision-run', { status: 'running' }, 1)
    expect(() => store.update('revision-run', { status: 'failed' }, 1)).toThrow(RevisionConflictError)
    expect(store.get('revision-run')?.status).toBe('running')
  })

  it('keeps user scopes separate and paginates newest-first with stable cursors', () => {
    const userA = uniqueUser()
    const userB = uniqueUser()
    const sessionDirA = userPaths(userA, '').sessionsDir
    mkdirSync(sessionDirA, { recursive: true })
    for (const [id, timestamp] of [
      ['page001', '2026-01-01T00:00:01.000Z'],
      ['page002', '2026-01-01T00:00:02.000Z'],
      ['page003', '2026-01-01T00:00:03.000Z'],
    ] as const) {
      atomicWriteJson(join(sessionDirA, `2026-01-01_${id}.json`), sessionFixture(id, userA, timestamp))
    }
    const other = createSession('coding', userB)
    other.id = 'page9999'
    saveSession(other)

    const first = listSessionHistory(userA, { limit: 2 })
    expect(first.items.map(item => item.id)).toEqual(['page003', 'page002'])
    expect(first.nextCursor).toBe('page002')
    const second = listSessionHistory(userA, { limit: 2, cursor: first.nextCursor })
    expect(second.items.map(item => item.id)).toEqual(['page001'])
    expect(listSessionHistory(userA).items.every(item => item.user === userA)).toBe(true)
    expect(listSessionHistory(userB).items.map(item => item.id)).toEqual(['page9999'])
  })
})
