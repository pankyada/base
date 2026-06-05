import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { Session, SessionSummary } from './types.js'
import { userPaths, sanitizeUserId } from './user-paths.js'

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

export function saveSession(session: Session): void {
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
  writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8')
}

export function loadSession(user: string, id: string): Session | null {
  const { sessionsDir } = userPaths(user, '')
  if (!existsSync(sessionsDir)) return null
  const files = readdirSync(sessionsDir)
  const match = files.find(f => f.includes(id))
  if (!match) return null
  return JSON.parse(readFileSync(join(sessionsDir, match), 'utf-8')) as Session
}

export function listSessions(user: string): Session[] {
  const { sessionsDir } = userPaths(user, '')
  if (!existsSync(sessionsDir)) return []
  return readdirSync(sessionsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(sessionsDir, f), 'utf-8')) as Session)
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
