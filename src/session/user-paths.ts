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
