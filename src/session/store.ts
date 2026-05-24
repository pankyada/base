import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { Session } from './types.js'

const SESSIONS_DIR = join(homedir(), '.harness', 'sessions')

export function createSession(profileName: string): Session {
  return {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    profile: profileName,
    created_at: new Date().toISOString(),
    messages: [],
    tool_calls: [],
    usage: { input: 0, output: 0, cost_usd: 0 },
    session_memory: {},
  }
}

export function saveSession(session: Session): void {
  mkdirSync(SESSIONS_DIR, { recursive: true })
  const date = session.created_at.slice(0, 10)
  const path = join(SESSIONS_DIR, `${date}_${session.id}.json`)
  writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8')
}

export function loadSession(id: string): Session | null {
  mkdirSync(SESSIONS_DIR, { recursive: true })
  const files = readdirSync(SESSIONS_DIR)
  const match = files.find(f => f.includes(id))
  if (!match) return null
  return JSON.parse(readFileSync(join(SESSIONS_DIR, match), 'utf-8')) as Session
}
