import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { AuditEntry } from '../src/audit/journal.js'

vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, unlinkSync: vi.fn(() => { throw new Error('unlink exploded') }) }
})

import { undoNotice, resetAppliedUndoEntries } from '../src/server/undo-handlers.js'
import { harnessStatePath } from '../src/config/state-paths.js'

function fixture(id: string, user: string, sessionId: string, path: string): AuditEntry {
  return { id, ts: new Date().toISOString(), session_id: sessionId, user, profile: 'coding', tool: 'Write', input_digest: 'x', effect: 'write', decision: 'allow', decided_by: 'default', decided_reason: 'test', tainted: false, ok: true, undo: { kind: 'file_restore', payload: { path, existed: false } } }
}

describe('undo error handling', () => {
  const originalStateDir = process.env.HARNESS_STATE_DIR

  afterEach(() => {
    resetAppliedUndoEntries()
    if (originalStateDir === undefined) delete process.env.HARNESS_STATE_DIR
    else process.env.HARNESS_STATE_DIR = originalStateDir
  })

  it('turns a forced unlink failure into a warning notice', async () => {
    const home = mkdtempSync(join(tmpdir(), 'undo-error-'))
    process.env.HARNESS_STATE_DIR = join(home, '.harness')
    const user = 'alice'
    const sessionId = 'session-1'
    const auditDir = harnessStatePath('audit', user)
    mkdirSync(auditDir, { recursive: true })
    const target = join(home, 'created.txt')
    writeFileSync(target, 'new')
    writeFileSync(join(auditDir, '2026-08-15.jsonl'), JSON.stringify(fixture('entry-1', user, sessionId, target)) + '\n')

    await expect(undoNotice(user, sessionId, 'entry-1', {} as any, true, 'recover failed write')).resolves.toEqual({ level: 'warn', message: 'undo entry entry-1 failed: unlink exploded' })
  })
})
