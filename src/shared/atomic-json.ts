import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface AtomicJsonOptions {
  /** Test hook. Throwing before rename leaves the previous record untouched. */
  beforeRename?: (tempPath: string, targetPath: string) => void
  mode?: number
}

export class RevisionConflictError extends Error {
  readonly expected: number
  readonly actual: number
  constructor(path: string, expected: number, actual: number) {
    super(`revision conflict for ${path}: expected ${expected}, actual ${actual}`)
    this.name = 'RevisionConflictError'
    this.expected = expected
    this.actual = actual
  }
}

export class CorruptRecordError extends Error {
  constructor(readonly path: string, cause?: unknown) {
    super(`corrupt JSON record: ${path}${cause instanceof Error ? ` (${cause.message})` : ''}`)
    this.name = 'CorruptRecordError'
  }
}

/** Same-directory temp + rename. Cleanup always runs after a failed write. */
export function atomicWriteJson<T>(path: string, value: T, options: AtomicJsonOptions = {}): void {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = join(dirname(path), `.${path.split('/').pop() ?? 'record'}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: options.mode })
    options.beforeRename?.(tempPath, path)
    renameSync(tempPath, path)
  } catch (error) {
    try { if (existsSync(tempPath)) unlinkSync(tempPath) } catch { /* preserve original failure */ }
    throw error
  }
}

export function readJson<T>(path: string): T {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch (error) { throw new CorruptRecordError(path, error) }
}

export function readJsonOrNull<T>(path: string): T | null {
  if (!existsSync(path)) return null
  return readJson<T>(path)
}

export interface VersionedRecord { revision: number; updated_at?: string; version?: number }

export function nextRevision(current: VersionedRecord | null): number { return (current?.revision ?? 0) + 1 }

export function updateJsonRecord<T extends VersionedRecord>(path: string, expectedRevision: number | undefined, update: (current: T | null) => T, options?: AtomicJsonOptions): T {
  const current = readJsonOrNull<T>(path)
  const actual = current?.revision ?? 0
  if (expectedRevision !== undefined && expectedRevision !== actual) throw new RevisionConflictError(path, expectedRevision, actual)
  const next = update(current)
  if (!Number.isInteger(next.revision) || next.revision !== actual + 1) throw new Error(`record revision must advance from ${actual} to ${actual + 1}`)
  next.updated_at = new Date().toISOString()
  atomicWriteJson(path, next, options)
  return next
}

export function mtimeMs(path: string): number { return statSync(path).mtimeMs }
