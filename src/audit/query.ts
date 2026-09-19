import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { userInfo } from 'os'
import { sanitizeUserId } from '../session/user-paths.js'
import { harnessStatePath } from '../config/state-paths.js'
import type { AuditEntry } from './journal.js'
import { createHash } from 'crypto'

export function listAudit(user = process.env.HARNESS_USER ?? userInfo().username, tool?: string, since?: Date): AuditEntry[] {
  const dir = harnessStatePath('audit', sanitizeUserId(user))
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(file => file.endsWith('.jsonl')).flatMap(file => readFileSync(join(dir, file), 'utf-8').trim().split('\n').filter(Boolean).flatMap(line => {
    try {
      const entry = JSON.parse(line) as AuditEntry
      if (tool && entry.tool !== tool) return []
      if (since && Date.parse(entry.ts) < since.getTime()) return []
      return [entry]
    } catch { return [] }
  })).sort((a, b) => a.ts.localeCompare(b.ts))
}

export function findAuditEntry(user: string, id: string): AuditEntry | null {
  return listAudit(user).find(entry => entry.id === id) ?? null
}

export function wasTaintedWrite(user: string, path: string): boolean {
  const digest = createHash('sha256').update(path).digest('hex')
  return listAudit(user).some(entry => entry.ok && entry.tainted && entry.effect === 'write' && entry.path_digest === digest)
}
