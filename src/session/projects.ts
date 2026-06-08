import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { sanitizeUserId } from './user-paths.js'
import { listSessions, saveSession, loadSession } from './store.js'

export interface Project {
  id: string
  name: string
  description?: string
  created_at: string
}

export interface SessionSummary {
  id: string
  project: string
  title?: string
  profile: string
  created_at: string
  usage: { input: number; output: number; cost_usd: number }
}

function inboxDir(user: string): string {
  return join(homedir(), '.harness', 'projects', sanitizeUserId(user))
}

function indexFile(user: string): string {
  return join(inboxDir(user), 'index.json')
}

function readIndex(user: string): Project[] {
  const f = indexFile(user)
  if (!existsSync(f)) return []
  return JSON.parse(readFileSync(f, 'utf-8')) as Project[]
}

function writeIndex(user: string, projects: Project[]): void {
  const dir = inboxDir(user)
  mkdirSync(dir, { recursive: true })
  writeFileSync(indexFile(user), JSON.stringify(projects, null, 2), 'utf-8')
}

export function ensureInbox(user: string): void {
  const projects = readIndex(user)
  if (!projects.find(p => p.id === 'inbox')) {
    writeIndex(user, [
      { id: 'inbox', name: 'Inbox', description: 'Default project', created_at: new Date().toISOString() },
      ...projects,
    ])
  }
}

export function listProjects(user: string): Project[] {
  return readIndex(user)
}

export function createProject(user: string, name: string, description?: string): Project {
  const project: Project = {
    id: randomUUID().replace(/-/g, '').slice(0, 12),
    name,
    description,
    created_at: new Date().toISOString(),
  }
  const projects = readIndex(user)
  writeIndex(user, [...projects, project])
  return project
}

export function assignSession(user: string, sessionId: string, projectId: string): void {
  const session = loadSession(user, sessionId)
  if (!session) return
  session.project = projectId
  saveSession(session)
}

export function listSessionSummaries(user: string, projectId?: string): SessionSummary[] {
  const sessions = listSessions(user)
  const filtered = projectId ? sessions.filter(s => s.project === projectId) : sessions
  return filtered.map(s => ({
    id: s.id,
    project: s.project,
    title: s.title,
    profile: s.profile,
    created_at: s.created_at,
    usage: s.usage,
  }))
}
