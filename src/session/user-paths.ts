import { join } from 'path'
import { homedir } from 'os'

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
}

export function userPaths(user: string, artifactDir: string): UserPaths {
  const safe = sanitizeUserId(user)
  return {
    sessionsDir: join(homedir(), '.harness', 'sessions', safe),
    privateMemDir: join(artifactDir, 'users', safe, 'memory'),
    usageFile: join(homedir(), '.harness', 'usage', `${safe}.json`),
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
  const base = join(homedir(), '.harness', 'projects', safe)
  return {
    recordFile: join(base, `${safeProject}.json`),
    memoryDir: join(base, safeProject, 'memory'),
  }
}
