import { readFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { Session, SessionSummary } from './types.js'
import { userPaths, sanitizeUserId } from './user-paths.js'
import { atomicWriteJson, readJson, RevisionConflictError } from '../shared/atomic-json.js'
import { validateContinuation } from '../provider/codex/continuation.js'

const SESSION_INDEX = 'index.json'

interface SessionHistoryIndex {
  version: 1
  entries: Array<{ id: string; file: string; updated_at: string }>
}

function sessionIndexPath(sessionsDir: string): string {
  return join(sessionsDir, SESSION_INDEX)
}

function readSessionRecords(sessionsDir: string): Session[] {
  return readdirSync(sessionsDir)
    .filter(file => file.endsWith('.json') && file !== SESSION_INDEX)
    .flatMap(file => {
      try { return [sanitizeSession(JSON.parse(readFileSync(join(sessionsDir, file), 'utf-8')) as Session)] } catch { return [] }
    })
}

function sanitizeSession(session: Session): Session {
  if (!Array.isArray(session.messages)) session.messages = []
  for (const message of session.messages as any[]) {
    if (!message || typeof message !== 'object') continue
    if (message.role !== 'assistant' || message.providerState === undefined) {
      if (message.role !== 'assistant') delete message.providerState
      continue
    }
    try {
      validateContinuation(message.providerState, { anchorCallIds: Array.isArray(message.tool_calls) ? message.tool_calls.map((call: any) => call?.id).filter((id: unknown): id is string => typeof id === 'string') : [] })
    } catch {
      delete message.providerState
    }
  }
  return session
}

function rebuildSessionIndex(sessionsDir: string): void {
  const entries = readSessionRecords(sessionsDir).map(session => ({
    id: session.id,
    file: readdirSync(sessionsDir).find(file => file.endsWith(`_${session.id}.json`)) ?? `${session.id}.json`,
    updated_at: session.updated_at ?? session.created_at,
  }))
  atomicWriteJson<SessionHistoryIndex>(sessionIndexPath(sessionsDir), { version: 1, entries })
}

function ensureSessionIndex(sessionsDir: string): { valid: boolean; error?: string } {
  const path = sessionIndexPath(sessionsDir)
  if (!existsSync(path)) {
    rebuildSessionIndex(sessionsDir)
    return { valid: false, error: 'missing history index; rebuilt' }
  }
  try {
    const index = readJson<SessionHistoryIndex>(path)
    if (index.version !== 1 || !Array.isArray(index.entries)) throw new Error('invalid history index shape')
    return { valid: true }
  } catch (error) {
    rebuildSessionIndex(sessionsDir)
    return { valid: false, error: `corrupt history index; rebuilt (${error instanceof Error ? error.message : String(error)})` }
  }
}

export function createSession(profileName: string, user: string): Session {
  return {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    user: sanitizeUserId(user),
    profile: profileName,
    project: 'inbox',
    created_at: new Date().toISOString(),
    messages: [],
    tool_calls: [],
    usage: { input: 0, output: 0, cost_usd: 0 },
    session_memory: {},
    todos: [],
  }
}

export function saveSession(session: Session, expectedRevision?: number): void {
  sanitizeSession(session)
  if (!session.project) session.project = 'inbox'
  if (!session.title) {
    const firstUser = (session.messages as Array<{ role?: string; content?: unknown }>)
      .find(m => m?.role === 'user' && typeof m.content === 'string')
    if (firstUser && typeof firstUser.content === 'string') {
      const derived = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 80)
      if (derived) session.title = derived
    }
  }
  const { sessionsDir } = userPaths(session.user, '')
  mkdirSync(sessionsDir, { recursive: true })
  const date = session.created_at.slice(0, 10)
  const path = join(sessionsDir, `${date}_${session.id}.json`)
  const existing = loadSession(session.user, session.id)
  const actualRevision = existing?.revision ?? 0
  const requestedRevision = expectedRevision ?? session.revision
  if (requestedRevision !== undefined && requestedRevision !== actualRevision) {
    throw new RevisionConflictError(path, requestedRevision, actualRevision)
  }
  session.revision = actualRevision + 1
  session.updated_at = new Date().toISOString()
  atomicWriteJson(path, session, { mode: 0o600 })
  rebuildSessionIndex(sessionsDir)
}

export function loadSession(user: string, id: string): Session | null {
  const { sessionsDir } = userPaths(user, '')
  if (!existsSync(sessionsDir)) return null
  const files = readdirSync(sessionsDir)
  // Exact stem match prevents prefix collisions (abc must not load abc1).
  const match = files.find(f => f !== SESSION_INDEX && f.endsWith(`_${id}.json`))
  if (!match) return null
  return sanitizeSession(JSON.parse(readFileSync(join(sessionsDir, match), 'utf-8')) as Session)
}

export function listSessions(user: string): Session[] {
  const { sessionsDir } = userPaths(user, '')
  if (!existsSync(sessionsDir)) return []
  const records = readSessionRecords(sessionsDir)
  ensureSessionIndex(sessionsDir)
  return records
    .sort((a, b) => Date.parse(b.updated_at ?? b.created_at) - Date.parse(a.updated_at ?? a.created_at) || b.id.localeCompare(a.id))
}

export interface SessionHistoryPage { items: Session[]; nextCursor?: string; diagnostics: Array<{ path: string; error: string }> }

/** Corruption-isolated, newest-first history page. Cursor is an opaque id. */
export function listSessionHistory(user: string, options: { projectId?: string; limit?: number; cursor?: string } = {}): SessionHistoryPage {
  const { sessionsDir } = userPaths(user, '')
  if (!existsSync(sessionsDir)) return { items: [], diagnostics: [] }
  const diagnostics: SessionHistoryPage['diagnostics'] = []
  const indexStatus = ensureSessionIndex(sessionsDir)
  if (indexStatus.error) diagnostics.push({ path: sessionIndexPath(sessionsDir), error: indexStatus.error })
  const all = readdirSync(sessionsDir).filter(file => file.endsWith('.json') && file !== SESSION_INDEX).flatMap(file => {
    try { return [JSON.parse(readFileSync(join(sessionsDir, file), 'utf8')) as Session] }
    catch (error) { diagnostics.push({ path: join(sessionsDir, file), error: error instanceof Error ? error.message : String(error) }); return [] }
  }).filter(s => !options.projectId || (s.project ?? 'inbox') === options.projectId)
    .sort((a, b) => Date.parse(b.updated_at ?? b.created_at) - Date.parse(a.updated_at ?? a.created_at) || b.id.localeCompare(a.id))
  const cursorIndex = options.cursor ? all.findIndex(item => item.id === options.cursor) : -1
  const start = options.cursor ? (cursorIndex >= 0 ? cursorIndex + 1 : all.length) : 0
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 20)))
  const items = all.slice(start, start + limit)
  return { items, nextCursor: start + limit < all.length ? items.at(-1)?.id : undefined, diagnostics }
}

export function listSessionSummaries(user: string, projectId?: string): SessionSummary[] {
  return listSessions(user)
    .filter(s => projectId ? (s.project ?? 'inbox') === projectId : true)
    .map(s => ({
      id: s.id,
      project: s.project ?? 'inbox',
      title: s.title,
      summary: s.summary,
      created_at: s.created_at,
      usage: s.usage,
    }))
}

export function assignSession(user: string, sessionId: string, projectId: string): void {
  const s = loadSession(user, sessionId)
  if (!s) return
  s.project = projectId
  saveSession(s)
}
