import { readFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { Run } from './types.js'
import { sanitizeUserId } from '../session/user-paths.js'
import { atomicWriteJson, readJson, RevisionConflictError } from '../shared/atomic-json.js'
import { harnessStatePath } from '../config/state-paths.js'

const RUN_INDEX = 'index.json'

interface RunHistoryIndex {
  version: 1
  entries: Array<{ id: string; file: string; updated_at: string }>
}

export interface RunStoreDiagnostic { path: string; error: string }
export interface RunHistoryPage { runs: Run[]; next_cursor?: string }
interface RunHistoryCursor { version: 1; user: string | null; profile: string | null; status: Run['status'] | null; updated_at: string; id: string }

function runsDir(user: string, root: string): string {
  return join(root, sanitizeUserId(user))
}

function allRunsBase(root: string): string { return root }

function runIndexPath(dir: string): string {
  return join(dir, RUN_INDEX)
}

function readRunRecords(dir: string): Run[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.json') && file !== RUN_INDEX)
    .flatMap(file => {
      try { return [JSON.parse(readFileSync(join(dir, file), 'utf8')) as Run] } catch { return [] }
    })
}

function rebuildRunIndex(dir: string): void {
  const files = readdirSync(dir)
  const entries = readRunRecords(dir).map(run => ({
    id: run.id,
    file: files.find(file => file.endsWith(`_${run.id}.json`)) ?? `${run.id}.json`,
    updated_at: run.updated_at ?? run.started_at,
  }))
  atomicWriteJson<RunHistoryIndex>(runIndexPath(dir), { version: 1, entries })
}

function ensureRunIndex(dir: string): { valid: boolean; error?: string } {
  const path = runIndexPath(dir)
  if (!existsSync(path)) {
    rebuildRunIndex(dir)
    return { valid: false, error: 'missing history index; rebuilt' }
  }
  try {
    const index = readJson<RunHistoryIndex>(path)
    if (index.version !== 1 || !Array.isArray(index.entries)) throw new Error('invalid history index shape')
    return { valid: true }
  } catch (error) {
    rebuildRunIndex(dir)
    return { valid: false, error: `corrupt history index; rebuilt (${error instanceof Error ? error.message : String(error)})` }
  }
}

export class RunStore {
  private diagnostics: RunStoreDiagnostic[] = []

  constructor(private readonly root = harnessStatePath('runs')) {}

  getDiagnostics(): RunStoreDiagnostic[] {
    return [...this.diagnostics]
  }

  create(run: Run): void {
    const dir = runsDir(run.user, this.root)
    mkdirSync(dir, { recursive: true })
    const date = run.started_at.slice(0, 10)
    run.revision = run.revision ?? 1
    run.updated_at = new Date().toISOString()
    atomicWriteJson(join(dir, `${date}_${run.id}.json`), run)
    rebuildRunIndex(dir)
  }

  update(id: string, patch: Partial<Run>, expectedRevision?: number): void {
    const run = this.get(id)
    if (!run) return
    const actual = run.revision ?? 1
    if (expectedRevision !== undefined && expectedRevision !== actual) throw new RevisionConflictError(id, expectedRevision, actual)
    const updated = { ...run, ...patch }
    updated.revision = actual + 1
    updated.updated_at = new Date().toISOString()
    const dir = runsDir(run.user, this.root)
    const date = run.started_at.slice(0, 10)
    atomicWriteJson(join(dir, `${date}_${id}.json`), updated)
    rebuildRunIndex(dir)
  }

  get(id: string): Run | null {
    const base = allRunsBase(this.root)
    if (!existsSync(base)) return null
    for (const userDir of readdirSync(base, { withFileTypes: true })) {
      if (!userDir.isDirectory()) continue
      const dir = join(base, userDir.name)
      const files = readdirSync(dir)
      const match = files.find(f => f !== RUN_INDEX && f === `${f.split('_')[0]}_${id}.json` && f.endsWith('.json'))
      if (match) {
        try {
          return JSON.parse(readFileSync(join(dir, match), 'utf-8')) as Run
        } catch { return null }
      }
    }
    return null
  }

  list(opts: { user?: string; status?: Run['status']; profile?: string; limit?: number } = {}): Run[] {
    const { user, status, profile, limit = 50 } = opts
    this.diagnostics = []
    const base = allRunsBase(this.root)
    if (!existsSync(base)) return []
    const userDirs = user
      ? [sanitizeUserId(user)]
      : readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    const runs: Run[] = []
    for (const u of userDirs) {
      const dir = join(base, u)
      if (!existsSync(dir)) continue
      const indexStatus = ensureRunIndex(dir)
      if (indexStatus.error) this.diagnostics.push({ path: runIndexPath(dir), error: indexStatus.error })
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json') || file === RUN_INDEX) continue
        try {
          const run = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Run
          if (status && run.status !== status) continue
          if (profile && run.profile !== profile) continue
          runs.push(run)
        } catch (error) {
          this.diagnostics.push({ path: join(dir, file), error: error instanceof Error ? error.message : String(error) })
        }
      }
    }
    return runs.sort((a, b) => Date.parse(b.updated_at ?? b.started_at) - Date.parse(a.updated_at ?? a.started_at) || b.id.localeCompare(a.id)).slice(0, limit)
  }

  /** Additive, scope-bound cursor page for reconnecting operator clients. */
  listPage(opts: { user?: string; status?: Run['status']; profile?: string; limit?: number; cursor?: string } = {}): RunHistoryPage {
    if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) throw new Error('invalid run history limit')
    const limit = Math.min(opts.limit ?? 50, 1000)
    const all = this.list({ user: opts.user, status: opts.status, profile: opts.profile, limit: 100_000 })
    let start = 0
    if (opts.cursor) {
      let value: Partial<RunHistoryCursor>
      try { value = JSON.parse(Buffer.from(opts.cursor, 'base64url').toString('utf8')) } catch { throw new Error('invalid run history cursor') }
      const requestedUser = opts.user ? sanitizeUserId(opts.user) : null
      if (value.version !== 1 || value.user !== requestedUser || value.profile !== (opts.profile ?? null) || value.status !== (opts.status ?? null) || typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at)) || typeof value.id !== 'string' || !value.id) throw new Error('invalid run history cursor')
      start = all.findIndex(run => {
        const updatedAt = run.updated_at ?? run.started_at
        return Date.parse(updatedAt) < Date.parse(value.updated_at!) || (updatedAt === value.updated_at && run.id.localeCompare(value.id!) < 0)
      })
      if (start < 0) start = all.length
    }
    const runs = all.slice(start, start + limit)
    if (start + runs.length >= all.length) return { runs }
    const last = runs.at(-1)!
    const cursor: RunHistoryCursor = { version: 1, user: opts.user ? sanitizeUserId(opts.user) : null, profile: opts.profile ?? null, status: opts.status ?? null, updated_at: last.updated_at ?? last.started_at, id: last.id }
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64url')
    return { runs, next_cursor: encoded }
  }

  scanRunning(): Run[] {
    return this.list({ status: 'running', limit: 1000 })
  }
}
