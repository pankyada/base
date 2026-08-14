import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from 'fs'
import { dirname } from 'path'
import { createHash } from 'crypto'
import { loadProfile } from '../profiles/loader.js'
import { createSession } from '../session/store.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import type { AuditEntry } from './journal.js'
import type { MemoryRecord, MemoryScope } from '../memory/interface.js'
import type { Profile } from '../profiles/schema.js'

export async function undoAuditEntry(entry: AuditEntry, profilePath: string | Profile): Promise<string> {
  if (!entry.undo) return `audit entry ${entry.id} is not undoable`
  if (entry.undo.expires_at && Date.parse(entry.undo.expires_at) <= Date.now()) return `audit entry ${entry.id} undo window has expired`
  const { kind, payload } = entry.undo
  if (kind === 'file_restore') {
    const path = payload.path
    if (typeof path !== 'string' || typeof payload.existed !== 'boolean') return `audit entry ${entry.id} has invalid file inverse`
    const expected = payload.after_sha256
    const legacyWarning = typeof expected === 'string' ? '' : ' (warning: cannot verify current content; legacy undo entry)'
    if (typeof expected === 'string') {
      if (!existsSync(path)) return `cannot undo ${entry.id}: ${path} drifted after the journalled write`
      const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
      if (actual !== expected) return `cannot undo ${entry.id}: ${path} drifted after the journalled write`
    }
    if (!payload.existed) { unlinkSync(path); return `undid ${entry.id}: removed ${path}${legacyWarning}` }
    if (typeof payload.before !== 'string') return `audit entry ${entry.id} has no prior file content`
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.from(payload.before, 'base64'))
    return `undid ${entry.id}: restored ${path}${legacyWarning}`
  }
  if (kind === 'memory_restore') {
    const scope = payload.scope as MemoryScope
    const key = payload.key
    if (!['session', 'profile', 'user', 'project'].includes(scope) || typeof key !== 'string') return `audit entry ${entry.id} has invalid memory inverse`
    const profile = typeof profilePath === 'string' ? loadProfile(profilePath) : profilePath
    const session = createSession(profile.name, entry.user); session.project = typeof payload.project === 'string' ? payload.project : 'inbox'
    const memory = profile.memory?.provider === 'graph' ? new GraphMemoryProvider(profile.artifact_dir, session) : new FsMemoryProvider(profile.artifact_dir, session)
    const before = payload.before as MemoryRecord | null
    if (!before) { await memory.delete(scope, key); return `undid ${entry.id}: removed ${scope}/${key}` }
    await memory.write(scope, key, before.content, before.links, before.temporal, { tainted: before.provenance === 'untrusted', source: before.source })
    return `undid ${entry.id}: restored ${scope}/${key}`
  }
  return `audit entry ${entry.id} has unsupported inverse ${kind}`
}
