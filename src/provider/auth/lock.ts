import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { codexAuthLockPath, ensureCodexAuthDir } from './paths.js'
import { delay } from './async.js'

export interface LockOptions { home?: string; timeoutMs?: number; pollMs?: number; staleMs?: number; signal?: AbortSignal }
interface LockOwner { nonce: string; pid: number; acquiredAt: number }

function ownerAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error: any) { return error?.code !== 'ESRCH' }
}
function readOwner(path: string): LockOwner | undefined {
  try {
    const stat = lstatSync(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined
    const file = join(path, 'owner.json')
    const info = lstatSync(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) return undefined
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return value && typeof value.nonce === 'string' && Number.isInteger(value.pid) && value.pid > 0 &&
      Number.isFinite(value.acquiredAt) ? value : undefined
  } catch { return undefined }
}

export async function withCodexAuthLock<T>(fn: () => Promise<T> | T, options: LockOptions = {}): Promise<T> {
  const path = codexAuthLockPath(options.home)
  const recovery = `${path}.recovery`
  const started = Date.now()
  const owner: LockOwner = { nonce: randomUUID(), pid: process.pid, acquiredAt: started }
  ensureCodexAuthDir(options.home)
  while (true) {
    options.signal?.throwIfAborted()
    if (Date.now() - started >= (options.timeoutMs ?? 30_000)) throw new Error('Timed out waiting for Codex credential lock; inspect lock owner before removing stale state')
    if (existsSync(recovery)) { await delay(options.pollMs ?? 25, options.signal); continue }
    let acquired = false
    try {
      mkdirSync(path, { mode: 0o700 })
      acquired = true
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error
      const stat = lstatSync(path)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Refusing unsafe Codex credential lock')
      if (recoverStale(path, recovery, options.staleMs ?? 120_000)) continue
    }
    if (!acquired) { await delay(options.pollMs ?? 25, options.signal); continue }
    let ownerWritten = false
    try {
      writeFileSync(join(path, 'owner.json'), JSON.stringify(owner), { mode: 0o600, flag: 'wx' })
      ownerWritten = true
      // A recoverer may have started after our pre-acquisition check. Its
      // removal already happened if mkdir succeeded; yield without entering.
      if (existsSync(recovery)) continue
      options.signal?.throwIfAborted()
      return await fn()
    } finally {
      if (!ownerWritten || readOwner(path)?.nonce === owner.nonce) rmSync(path, { recursive: true, force: true })
    }
  }
}

function recoverStale(path: string, recovery: string, staleMs: number): boolean {
  const owner = readOwner(path)
  if (!owner || ownerAlive(owner.pid) || Date.now() - owner.acquiredAt <= staleMs) return false
  try { mkdirSync(recovery, { mode: 0o700 }) } catch (error: any) {
    if (error?.code === 'EEXIST') return false
    throw error
  }
  try {
    // Only one recoverer can remove a stale directory. Acquirers also honor
    // the marker, preventing a second recoverer from deleting a new owner.
    const current = readOwner(path)
    if (current?.nonce !== owner.nonce || ownerAlive(current.pid)) return false
    rmSync(path, { recursive: true, force: true })
    return true
  } finally { rmSync(recovery, { recursive: true, force: true }) }
}
