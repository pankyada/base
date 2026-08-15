import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { undoAuditEntry } from '../src/audit/undo.js'
import type { AuditEntry } from '../src/audit/journal.js'

function entry(payload: Record<string, unknown>): AuditEntry {
  return { id: 'undo-1', ts: new Date().toISOString(), session_id: 's', user: 'u', profile: 'p', tool: 'Write', input_digest: 'x', effect: 'write', decision: 'allow', decided_by: 'default', decided_reason: 'test', tainted: false, ok: true, undo: { kind: 'file_restore', payload } }
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

describe('audit undo', () => {
  it('reports entries without an inverse as not undoable', async () => {
    const { undo, ...withoutUndo } = entry({})
    await expect(undoAuditEntry(withoutUndo, '')).resolves.toContain('not undoable')
  })

  it('restores prior file content and removes newly-created files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'undo-'))
    const existing = join(dir, 'existing.txt'); writeFileSync(existing, 'new')
    await expect(undoAuditEntry(entry({ path: existing, existed: true, before: Buffer.from('old').toString('base64'), after_sha256: hash('new') }), '')).resolves.toContain('restored')
    expect(readFileSync(existing, 'utf8')).toBe('old')
    const created = join(dir, 'created.txt'); writeFileSync(created, 'new')
    await undoAuditEntry(entry({ path: created, existed: false, after_sha256: hash('new') }), '')
    expect(existsSync(created)).toBe(false)
  })

  it('refuses a hand-edited file when the post-write hash drifts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'undo-drift-'))
    const path = join(dir, 'file.txt')
    writeFileSync(path, 'new')
    const after_sha256 = createHash('sha256').update('new').digest('hex')
    writeFileSync(path, 'edited later')
    await expect(undoAuditEntry(entry({ path, existed: true, before: Buffer.from('old').toString('base64'), after_sha256 }), '')).resolves.toContain('drifted')
    expect(readFileSync(path, 'utf8')).toBe('edited later')

    writeFileSync(path, 'new')
    await expect(undoAuditEntry(entry({ path, existed: true, before: Buffer.from('old').toString('base64'), after_sha256 }), '')).resolves.toContain('restored')
    expect(readFileSync(path, 'utf8')).toBe('old')
  })

  it('refuses legacy restores unless forced, then restores existing content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'undo-legacy-'))
    const path = join(dir, 'file.txt')
    writeFileSync(path, 'new')
    const inverse = entry({ path, existed: true, before: Buffer.from('old').toString('base64') })
    await expect(undoAuditEntry(inverse, '')).resolves.toContain('retry with force')
    expect(readFileSync(path, 'utf8')).toBe('new')
    await expect(undoAuditEntry(inverse, '', { force: true })).resolves.toContain('forced legacy restore')
    expect(readFileSync(path, 'utf8')).toBe('old')
  })

  it('handles a legacy delete inverse whose target is already gone without crashing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'undo-legacy-gone-'))
    const path = join(dir, 'gone.txt')
    const inverse = entry({ path, existed: false })
    await expect(undoAuditEntry(inverse, '')).resolves.toContain('retry with force')
    await expect(undoAuditEntry(inverse, '', { force: true })).resolves.toContain('already absent')
  })

  it('keeps a confirmed hash mismatch a hard refusal even with force', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'undo-hash-force-'))
    const path = join(dir, 'file.txt')
    writeFileSync(path, 'edited later')
    await expect(undoAuditEntry(entry({ path, existed: true, before: Buffer.from('old').toString('base64'), after_sha256: hash('new') }), '', { force: true })).resolves.toContain('drifted')
    expect(readFileSync(path, 'utf8')).toBe('edited later')
  })
})
