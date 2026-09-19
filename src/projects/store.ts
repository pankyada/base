import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { Project } from './types.js'
import { projectPaths, sanitizeUserId } from '../session/user-paths.js'
import { harnessStatePath } from '../config/state-paths.js'

function writeProject(p: Project): void {
  const { recordFile } = projectPaths(p.user, p.id)
  mkdirSync(dirname(recordFile), { recursive: true })
  writeFileSync(recordFile, JSON.stringify(p, null, 2), 'utf-8')
}

export function createProject(user: string, name: string, description?: string): Project {
  const p: Project = {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    user: sanitizeUserId(user),
    name,
    created_at: new Date().toISOString(),
    ...(description ? { description } : {}),
  }
  writeProject(p)
  return p
}

export function getProject(user: string, id: string): Project | null {
  const { recordFile } = projectPaths(user, id)
  if (!existsSync(recordFile)) return null
  return JSON.parse(readFileSync(recordFile, 'utf-8')) as Project
}

export function ensureInbox(user: string): Project {
  const existing = getProject(user, 'inbox')
  if (existing) return existing
  const p: Project = {
    id: 'inbox',
    user: sanitizeUserId(user),
    name: 'Inbox',
    created_at: new Date().toISOString(),
  }
  writeProject(p)
  return p
}

export function listProjects(user: string): Project[] {
  const safe = sanitizeUserId(user)
  const dir = harnessStatePath('projects', safe)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Project)
}
