import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createHash, randomUUID } from 'crypto'
import { sanitizeUserId } from '../session/user-paths.js'

export interface AuditEntry { id: string; ts: string; run_id?: string; session_id: string; user: string; profile: string; tool: string; input_digest: string; effect: 'read' | 'write' | 'outbound' | 'destructive'; decision: 'allow' | 'prompt' | 'deny'; decided_by: 'default' | 'predicate' | 'mode' | 'human' | 'gate'; decided_reason: string; tainted: boolean; ok: boolean }

export function audit(entry: Omit<AuditEntry, 'id' | 'ts' | 'input_digest'> & { input: Record<string, unknown> }): void {
  const now = new Date(); const dir = join(homedir(), '.harness', 'audit', sanitizeUserId(entry.user))
  const input = JSON.stringify(entry.input).replace(/("(?:token|password|secret|api_key)[^"]*"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"').slice(0, 512)
  const record: AuditEntry = { ...entry, id: randomUUID().replace(/-/g, '').slice(0, 12), ts: now.toISOString(), input_digest: createHash('sha256').update(input).digest('hex').slice(0, 16) }
  try { mkdirSync(dir, { recursive: true }); appendFileSync(join(dir, `${now.toISOString().slice(0, 10)}.jsonl`), JSON.stringify(record) + '\n') } catch { /* audit best effort only */ }
}
