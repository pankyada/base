import { chmodSync, lstatSync, readFileSync, openSync, closeSync, renameSync, unlinkSync, writeSync, fsyncSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { codexAuthPath, ensureCodexAuthDir, assertCodexAuthDirs } from './paths.js'
import { withCodexAuthLock } from './lock.js'

export const CODEX_AUTH_VERSION = 1
export type CodexAuthStatus = 'active' | 'expired' | 'reauth_required' | 'missing' | 'disabled'
export interface CodexCredential {
  kind: 'codex_oauth'
  access_token: string
  refresh_token: string
  expires_at: number
  account_id: string
  /** Provider generation, never sent in shared protocol. */
  generation: string
}
export interface CodexAuthRecord {
  version: 1
  revision: number
  generation: string
  credential?: CodexCredential
  status?: Exclude<CodexAuthStatus, 'missing' | 'disabled'>
  updated_at: string
}

export class CodexAuthStoreError extends Error { constructor(message: string) { super(message); this.name = 'CodexAuthStoreError' } }

export function readCodexAuth(home?: string): CodexAuthRecord | null {
  assertCodexAuthDirs(home)
  const path = codexAuthPath(home)
  let stat
  try { stat = lstatSync(path) } catch (error: any) { if (error?.code === 'ENOENT') return null; throw error }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new CodexAuthStoreError(`refusing non-regular Codex credential store: ${path}`)
  if (stat.size > 512 * 1024) throw new CodexAuthStoreError('Codex credential store exceeds size limit')
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<CodexAuthRecord>
    validateRecord(value, path)
    return value as CodexAuthRecord
  } catch (error) {
    if (error instanceof CodexAuthStoreError) throw error
    throw new CodexAuthStoreError(`invalid Codex credential store: ${path}`)
  }
}

export async function writeCodexCredential(credential: Omit<CodexCredential, 'generation'> & { generation?: string }, home?: string, signal?: AbortSignal): Promise<CodexAuthRecord> {
  return withCodexAuthLock(() => {
    signal?.throwIfAborted()
    const current = readCodexAuth(home)
    return writeCodexCredentialLocked(credential, current, home)
  }, { home, signal })
}

/** Persist after the caller already owns the auth lock. */
export function writeCodexCredentialLocked(credential: Omit<CodexCredential, 'generation'> & { generation?: string }, current: CodexAuthRecord | null, home?: string): CodexAuthRecord {
  const generation = credential.generation ?? randomUUID()
  const record: CodexAuthRecord = { version: 1, revision: (current?.revision ?? 0) + 1, generation, credential: { ...credential, generation }, status: 'active', updated_at: new Date().toISOString() }
  persist(record, home)
  return record
}

export async function logoutCodex(home?: string): Promise<CodexAuthRecord> {
  return withCodexAuthLock(() => {
    const current = readCodexAuth(home)
    const record: CodexAuthRecord = { version: 1, revision: (current?.revision ?? 0) + 1, generation: randomUUID(), status: 'reauth_required', updated_at: new Date().toISOString() }
    persist(record, home)
    return record
  }, { home })
}

export function markCodexReauthRequiredLocked(current: CodexAuthRecord | null, home?: string): CodexAuthRecord {
  const record: CodexAuthRecord = { version: 1, revision: (current?.revision ?? 0) + 1, generation: randomUUID(), status: 'reauth_required', updated_at: new Date().toISOString() }
  persist(record, home)
  return record
}

export function codexAuthStatus(home?: string, now = Date.now()): { status: CodexAuthStatus; accountHint?: string; expiresAt?: number; generation?: string } {
  if (process.env.HARNESS_DISABLE_CODEX_OAUTH === '1') return { status: 'disabled' }
  const record = readCodexAuth(home)
  if (!record?.credential) return { status: record?.status === 'reauth_required' ? 'reauth_required' : 'missing', generation: record?.generation }
  const status = record.credential.expires_at <= now ? 'expired' : (record.status ?? 'active')
  return { status, accountHint: maskAccount(record.credential.account_id), expiresAt: record.credential.expires_at, generation: record.generation }
}

export function credentialForInference(home?: string): CodexCredential {
  if (process.env.HARNESS_DISABLE_CODEX_OAUTH === '1') throw new CodexAuthStoreError('Codex OAuth is disabled (set profile to API mode)')
  const record = readCodexAuth(home)
  if (!record?.credential) throw new CodexAuthStoreError('Codex login required: run harness auth login openai --method browser')
  return record.credential
}

function persist(record: CodexAuthRecord, home?: string): void {
  validateRecord(record, codexAuthPath(home))
  const dir = ensureCodexAuthDir(home)
  const path = codexAuthPath(home)
  const temp = join(dir, `.openai-codex.${process.pid}.${randomUUID()}.tmp`)
  let fd: number | undefined
  try {
    fd = openSync(temp, 'wx', 0o600)
    writeSync(fd, `${JSON.stringify(record, null, 2)}\n`, undefined, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temp, path)
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch { /* preserve original error */ }
    throw error
  }
  chmodSync(path, 0o600)
  if (process.platform !== 'win32') {
    const directory = openSync(dir, 'r')
    try { fsyncSync(directory) } finally { closeSync(directory) }
  }
}

function validateRecord(value: Partial<CodexAuthRecord>, path: string): void {
  if (!value || typeof value !== 'object') throw new CodexAuthStoreError(`invalid Codex credential store: ${path}`)
  if (value.version !== 1 || typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 0 || typeof value.generation !== 'string' || value.generation.length < 8 || typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))) throw new CodexAuthStoreError(`invalid Codex credential store: ${path}`)
  if (value.status !== undefined && value.status !== 'active' && value.status !== 'expired' && value.status !== 'reauth_required') throw new CodexAuthStoreError(`invalid Codex credential store: ${path}`)
  if (value.credential !== undefined) {
    const c = value.credential
    if (!c || value.status === 'reauth_required' || c.kind !== 'codex_oauth' || typeof c.access_token !== 'string' || !c.access_token.trim() || c.access_token.length > 128 * 1024 || typeof c.refresh_token !== 'string' || !c.refresh_token.trim() || c.refresh_token.length > 128 * 1024 || !Number.isFinite(c.expires_at) || c.expires_at <= 0 || typeof c.account_id !== 'string' || !c.account_id.trim() || c.account_id.length > 1024 || /[\r\n]/.test(c.account_id) || c.generation !== value.generation) throw new CodexAuthStoreError(`invalid Codex credential store: ${path}`)
  }
}

function maskAccount(account: string): string { return account.length <= 8 ? '[redacted]' : `${account.slice(0, 4)}…${account.slice(-4)}` }
