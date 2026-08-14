import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { applyUndoEntry, listUndoEntries, resetAppliedUndoEntries } from '../src/server/undo-handlers.js'
import type { AuditEntry } from '../src/audit/journal.js'

function fixture(id: string, sessionId: string, user: string, payload: Record<string, unknown>, expires_at?: string): AuditEntry {
  return { id, ts: new Date(Date.now() - (id === 'old' ? 1000 : 0)).toISOString(), session_id: sessionId, user, profile: 'coding', tool: 'Write', input_digest: 'x', effect: 'write', decision: 'allow', decided_by: 'default', decided_reason: 'test', tainted: false, ok: true, undo: { kind: 'file_restore', payload, expires_at } }
}

describe('undo handlers', () => {
  const originalHome = process.env.HOME

  afterEach(() => {
    resetAppliedUndoEntries()
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    vi.restoreAllMocks()
  })

  it('scopes entries by current user/session, keeps expired rows, caps newest-first, and marks applied', async () => {
    const home = mkdtempSync(join(tmpdir(), 'undo-handler-'))
    process.env.HOME = home
    const user = 'alice'
    const dir = join(home, '.harness', 'audit', user)
    mkdirSync(dir, { recursive: true })
    const target = join(home, 'file.txt')
    writeFileSync(target, 'new')
    const entries = [
      fixture('new', 'session-1', user, { path: target, existed: true, before: Buffer.from('old').toString('base64') }),
      fixture('old', 'session-1', user, { path: join(home, 'old.txt'), existed: false }, new Date(Date.now() - 1_000).toISOString()),
      fixture('other-session', 'session-2', user, { path: join(home, 'other.txt'), existed: false }),
      fixture('other-user', 'session-1', 'bob', { path: join(home, 'bob.txt'), existed: false }),
    ]
    writeFileSync(join(dir, '2026-08-15.jsonl'), entries.slice(0, 3).map(entry => JSON.stringify(entry)).join('\n') + '\n')
    mkdirSync(join(home, '.harness', 'audit', 'bob'), { recursive: true })
    writeFileSync(join(home, '.harness', 'audit', 'bob', '2026-08-15.jsonl'), JSON.stringify(entries[3]) + '\n')

    expect(listUndoEntries(user, 'session-1')).toEqual([
      expect.objectContaining({ id: 'new', target, available: true, applied: false }),
      expect.objectContaining({ id: 'old', available: false, reason: 'undo window has expired' }),
    ])
    await expect(applyUndoEntry(user, 'session-2', 'new', {} as any)).resolves.toContain('unavailable')
    await expect(applyUndoEntry(user, 'session-1', 'new', {} as any)).resolves.toContain('restored')
    expect(listUndoEntries(user, 'session-1')[0]).toMatchObject({ id: 'new', available: false, applied: true, reason: 'already applied' })
    await expect(applyUndoEntry(user, 'session-1', 'new', {} as any)).resolves.toContain('already applied')
  })
})
