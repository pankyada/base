import { listAudit } from '../audit/query.js'
import { undoAuditEntry } from '../audit/undo.js'
import type { AuditEntry } from '../audit/journal.js'
import type { Profile } from '../profiles/schema.js'

export interface UndoEntryView {
  id: string
  ts: string
  tool: string
  target: string
  expires_at?: string
  available: boolean
  forceable: boolean
  applied: boolean
  reason?: string
}

const appliedUndoEntries = new Set<string>()

function targetFor(entry: AuditEntry): string {
  const payload = entry.undo?.payload ?? {}
  if (typeof payload.path === 'string') return payload.path
  if (typeof payload.scope === 'string' && typeof payload.key === 'string') return `${payload.scope}/${payload.key}`
  return entry.tool
}

export function listUndoEntries(user: string, sessionId: string): UndoEntryView[] {
  return listAudit(user)
    .filter(entry => entry.session_id === sessionId && entry.undo != null && entry.ok)
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 50)
    .map(entry => {
      const applied = appliedUndoEntries.has(entry.id)
      const expired = Boolean(entry.undo?.expires_at && Date.parse(entry.undo.expires_at) <= Date.now())
      const legacy = entry.undo?.kind === 'file_restore' && typeof entry.undo.payload.after_sha256 !== 'string'
      return {
        id: entry.id,
        ts: entry.ts,
        tool: entry.tool,
        target: targetFor(entry),
        expires_at: entry.undo?.expires_at,
        available: !applied && !expired && !legacy,
        forceable: !applied && !expired && legacy,
        applied,
        ...(applied ? { reason: 'already applied' } : expired ? { reason: 'undo window has expired' } : legacy ? { reason: 'cannot verify current content; enter twice to force restore' } : {}),
      }
    })
}

export async function applyUndoEntry(user: string, sessionId: string, id: string, profile: Profile, force = false): Promise<string> {
  const entry = listAudit(user).find(candidate => candidate.id === id)
  if (!entry || entry.session_id !== sessionId || !entry.undo || !entry.ok) return `undo entry ${id} is unavailable in this session`
  if (appliedUndoEntries.has(id)) return `undo entry ${id} was already applied`
  const result = await undoAuditEntry(entry, profile, { force })
  if (result.startsWith('undid ')) appliedUndoEntries.add(id)
  return result
}

export function resetAppliedUndoEntries(): void {
  appliedUndoEntries.clear()
}
