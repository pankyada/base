import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { loadProfile } from '../profiles/loader.js'
import { createSession } from '../session/store.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import type { AuditEntry } from './journal.js'
import type { MemoryRecord, MemoryScope } from '../memory/interface.js'

export async function undoAuditEntry(entry: AuditEntry, profilePath: string): Promise<string> {
  if (!entry.undo) return `audit entry ${entry.id} is not undoable`
  if (entry.undo.expires_at && Date.parse(entry.undo.expires_at) <= Date.now()) return `audit entry ${entry.id} undo window has expired`
  const { kind, payload } = entry.undo
  if (kind === 'file_restore') {
    const path = payload.path
    if (typeof path !== 'string' || typeof payload.existed !== 'boolean') return `audit entry ${entry.id} has invalid file inverse`
    if (!payload.existed) { if (existsSync(path)) unlinkSync(path); return `undid ${entry.id}: removed ${path}` }
    if (typeof payload.before !== 'string') return `audit entry ${entry.id} has no prior file content`
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.from(payload.before, 'base64'))
    return `undid ${entry.id}: restored ${path}`
  }
  if (kind === 'memory_restore') {
    const scope = payload.scope as MemoryScope
    const key = payload.key
    if (!['session', 'profile', 'user', 'project'].includes(scope) || typeof key !== 'string') return `audit entry ${entry.id} has invalid memory inverse`
    const profile = loadProfile(profilePath)
    const session = createSession(profile.name, entry.user); session.project = typeof payload.project === 'string' ? payload.project : 'inbox'
    const memory = profile.memory?.provider === 'graph' ? new GraphMemoryProvider(profile.artifact_dir, session) : new FsMemoryProvider(profile.artifact_dir, session)
    const before = payload.before as MemoryRecord | null
    if (!before) { await memory.delete(scope, key); return `undid ${entry.id}: removed ${scope}/${key}` }
    await memory.write(scope, key, before.content, before.links, before.temporal, { tainted: before.provenance === 'untrusted', source: before.source })
    return `undid ${entry.id}: restored ${scope}/${key}`
  }
  return `audit entry ${entry.id} has unsupported inverse ${kind}`
}
