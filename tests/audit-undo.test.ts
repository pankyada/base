import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { undoAuditEntry } from '../src/audit/undo.js'
import type { AuditEntry } from '../src/audit/journal.js'

function entry(payload: Record<string, unknown>): AuditEntry {
  return { id: 'undo-1', ts: new Date().toISOString(), session_id: 's', user: 'u', profile: 'p', tool: 'Write', input_digest: 'x', effect: 'write', decision: 'allow', decided_by: 'default', decided_reason: 'test', tainted: false, ok: true, undo: { kind: 'file_restore', payload } }
}

describe('audit undo', () => {
  it('reports entries without an inverse as not undoable', async () => {
    const { undo, ...withoutUndo } = entry({})
    await expect(undoAuditEntry(withoutUndo, '')).resolves.toContain('not undoable')
  })

  it('restores prior file content and removes newly-created files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'undo-'))
    const existing = join(dir, 'existing.txt'); writeFileSync(existing, 'new')
    await expect(undoAuditEntry(entry({ path: existing, existed: true, before: Buffer.from('old').toString('base64') }), '')).resolves.toContain('restored')
    expect(readFileSync(existing, 'utf8')).toBe('old')
    const created = join(dir, 'created.txt'); writeFileSync(created, 'new')
    await undoAuditEntry(entry({ path: created, existed: false }), '')
    expect(existsSync(created)).toBe(false)
  })
})
