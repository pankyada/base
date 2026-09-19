import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaimMeta, MemoryEntry, MemoryRecord } from './interface.js'
import { overlapsWindow } from './temporal.js'
import { atomicWriteJson, readJson } from '../shared/atomic-json.js'
import { userPaths } from '../session/user-paths.js'

export interface MemoryConflict {
  version: 1
  id: string
  user: string
  scope: string
  claim_key: string
  claim_a: { key: string; value?: string; source?: string }
  claim_b: { key: string; value?: string; source?: string }
  /** Stable source IDs and rationale are advisory; both claims remain unresolved. */
  evidence?: string[]
  rationale?: string
  candidate_revision?: string
  dependent_missions: string[]
  state: 'open' | 'superseded' | 'ambiguous'
  resolution?: { by: string; at: string; chosen_key?: string; reason?: string }
  revision: number
}

export function recordUnresolvedConflict(store: MemoryConflictStore, input: Omit<MemoryConflict, 'version' | 'id' | 'revision' | 'state'> & { id?: string; evidence?: string[]; rationale?: string; candidate_revision?: string }): MemoryConflict {
  const conflict: MemoryConflict = {
    ...input,
    version: 1,
    id: input.id ?? randomUUID(),
    state: 'open',
    revision: 1,
  }
  return store.save(conflict)
}
function claimOf(entry: MemoryEntry | MemoryRecord): ClaimMeta | undefined { return entry.claim }
function claimKey(entry: MemoryEntry | MemoryRecord): string | undefined { const claim = claimOf(entry); return claim ? `${claim.entity}\u0000${claim.predicate}` : undefined }
export function detectConflicts(entries: MemoryEntry[], user: string, scope: string): MemoryConflict[] { const groups = new Map<string, MemoryEntry[]>(); for (const entry of entries) { const key = claimKey(entry); if (!key || !entry.claim?.normalized_value) continue; const group = groups.get(key) ?? []; group.push(entry); groups.set(key, group) }; const conflicts: MemoryConflict[] = []; for (const [key, group] of groups) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) { const a = group[i], b = group[j]; if (a.claim?.normalized_value === b.claim?.normalized_value) continue; const from = new Date(Math.min(Date.parse(a.temporal?.valid_from ?? '0000-01-01T00:00:00Z'), Date.parse(b.temporal?.valid_from ?? '0000-01-01T00:00:00Z'))); const to = new Date(Math.max(Date.parse(a.temporal?.valid_until ?? '9999-12-31T00:00:00Z'), Date.parse(b.temporal?.valid_until ?? '9999-12-31T00:00:00Z'))); if (!overlapsWindow(a.temporal, from, to) || !overlapsWindow(b.temporal, from, to)) continue; conflicts.push({ version: 1, id: randomUUID(), user, scope, claim_key: key, claim_a: { key: a.key, value: a.claim?.normalized_value, source: a.claim?.source_evidence?.[0] }, claim_b: { key: b.key, value: b.claim?.normalized_value, source: b.claim?.source_evidence?.[0] }, dependent_missions: [], state: 'open', revision: 1 }) } return conflicts }
export function resolveConflict(conflict: MemoryConflict, input: { user: string; revision: number; chosenKey?: string; preserveAmbiguity?: boolean; reason?: string }): MemoryConflict { if (conflict.user !== input.user) throw new Error('conflict belongs to another user'); if (conflict.revision !== input.revision) throw new Error(`stale conflict revision: expected ${input.revision}, actual ${conflict.revision}`); if (!input.chosenKey && !input.preserveAmbiguity) throw new Error('resolution must choose a claim or preserve ambiguity'); return { ...conflict, revision: conflict.revision + 1, state: input.preserveAmbiguity ? 'ambiguous' : 'superseded', resolution: { by: input.user, at: new Date().toISOString(), chosen_key: input.chosenKey, reason: input.reason } } }

/** Durable per-user conflict records. Conflict files never cross user roots. */
export class MemoryConflictStore {
  constructor(private readonly user: string) {}
  get owner(): string { return this.user }
  private root(): string { return join(userPaths(this.user, '').privateMemDir, '.conflicts') }
  private path(id: string): string { return join(this.root(), `${id}.json`) }
  save(conflict: MemoryConflict): MemoryConflict {
    if (conflict.user !== this.user) throw new Error('conflict belongs to another user')
    atomicWriteJson(this.path(conflict.id), conflict)
    return conflict
  }
  get(id: string): MemoryConflict | null {
    const path = this.path(id)
    if (!existsSync(path)) return null
    const conflict = readJson<MemoryConflict>(path)
    return conflict.user === this.user ? conflict : null
  }
  list(): MemoryConflict[] {
    const root = this.root()
    if (!existsSync(root)) return []
    return readdirSync(root).filter(file => file.endsWith('.json')).flatMap(file => {
      try { const conflict = readJson<MemoryConflict>(join(root, file)); return conflict.user === this.user ? [conflict] : [] } catch { return [] }
    }).sort((a, b) => b.id.localeCompare(a.id))
  }
}
