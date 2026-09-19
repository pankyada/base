import { join } from 'path'
import { harnessStatePath } from '../config/state-paths.js'

export function sanitizeUserId(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 64)
  return slug || 'default'
}

export interface UserPaths {
  sessionsDir: string
  privateMemDir: string
  usageFile: string
  missionsDir: string
  evaluationsDir: string
  artifactsDir: string
}

export function userPaths(user: string, artifactDir: string): UserPaths {
  const safe = sanitizeUserId(user)
  return {
    sessionsDir: harnessStatePath('sessions', safe),
    privateMemDir: join(artifactDir, 'users', safe, 'memory'),
    usageFile: harnessStatePath('usage', `${safe}.json`),
    missionsDir: harnessStatePath('missions', safe),
    evaluationsDir: harnessStatePath('evaluations', safe),
    artifactsDir: harnessStatePath('artifacts', safe),
  }
}

export interface ProjectPaths {
  recordFile: string
  memoryDir: string
}

export function sanitizeProjectId(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 64)
  return slug || 'inbox'
}

export function projectPaths(user: string, projectId: string): ProjectPaths {
  const safe = sanitizeUserId(user)
  const safeProject = sanitizeProjectId(projectId)
  const base = harnessStatePath('projects', safe)
  return {
    recordFile: join(base, `${safeProject}.json`),
    memoryDir: join(base, safeProject, 'memory'),
  }
}
