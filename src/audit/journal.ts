import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { sanitizeUserId } from '../session/user-paths.js'
import { harnessStatePath } from '../config/state-paths.js'

export interface AuditEntry { id: string; ts: string; run_id?: string; session_id: string; user: string; profile: string; tool: string; input_digest: string; effect: 'read' | 'write' | 'outbound' | 'destructive'; decision: 'allow' | 'prompt' | 'deny'; decided_by: 'default' | 'predicate' | 'mode' | 'human' | 'gate'; decided_reason: string; tainted: boolean; ok: boolean; undo?: { kind: string; payload: Record<string, unknown>; expires_at?: string }; path_digest?: string }

export function audit(entry: Omit<AuditEntry, 'id' | 'ts' | 'input_digest' | 'path_digest'> & { input: Record<string, unknown> }): AuditEntry {
  const now = new Date(); const dir = harnessStatePath('audit', sanitizeUserId(entry.user))
  const input = JSON.stringify(entry.input).replace(/("(?:token|password|secret|api_key)[^"]*"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"').slice(0, 512)
  const path = typeof entry.input.file_path === 'string' ? entry.input.file_path : undefined
  const record: AuditEntry = { ...entry, id: randomUUID().replace(/-/g, '').slice(0, 12), ts: now.toISOString(), input_digest: createHash('sha256').update(input).digest('hex').slice(0, 16), ...(path ? { path_digest: createHash('sha256').update(path).digest('hex') } : {}) }
  try { mkdirSync(dir, { recursive: true }); appendFileSync(join(dir, `${now.toISOString().slice(0, 10)}.jsonl`), JSON.stringify(record) + '\n') } catch { /* audit best effort only */ }
  return record
}
