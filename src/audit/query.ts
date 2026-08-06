import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir, userInfo } from 'os'
import { sanitizeUserId } from '../session/user-paths.js'
import type { AuditEntry } from './journal.js'

export function listAudit(user = process.env.HARNESS_USER ?? userInfo().username, tool?: string): AuditEntry[] {
  const dir = join(homedir(), '.harness', 'audit', sanitizeUserId(user))
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(file => file.endsWith('.jsonl')).flatMap(file => readFileSync(join(dir, file), 'utf-8').trim().split('\n').filter(Boolean).flatMap(line => {
    try { const entry = JSON.parse(line) as AuditEntry; return !tool || entry.tool === tool ? [entry] : [] } catch { return [] }
  }))
}
