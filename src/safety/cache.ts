import { createHash } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import type { RiskLevel } from '../types.js'

export interface CachedVerdict {
  risk: RiskLevel
  reason: string
  ts: number
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function verdictKey(toolName: string, input: Record<string, unknown>): string {
  return createHash('sha256').update(toolName + canonical(input)).digest('hex')
}

export class DangerCache {
  private entries: Record<string, CachedVerdict> = {}
  private loaded = false
  private flushTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly path = join(homedir(), '.harness', 'danger-cache.json'),
    private readonly now = () => Date.now(),
  ) {}

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      if (existsSync(this.path)) this.entries = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, CachedVerdict>
    } catch {
      this.entries = {}
    }
  }

  get(key: string, ttlHours: number): CachedVerdict | undefined {
    this.load()
    const found = this.entries[key]
    if (!found || this.now() - found.ts > ttlHours * 60 * 60 * 1000) {
      if (found) delete this.entries[key]
      return undefined
    }
    return found
  }

  set(key: string, verdict: Omit<CachedVerdict, 'ts'>): void {
    this.load()
    this.entries[key] = { ...verdict, ts: this.now() }
    const keys = Object.keys(this.entries)
    if (keys.length > 2000) {
      keys.sort((a, b) => this.entries[a].ts - this.entries[b].ts)
      for (const old of keys.slice(0, keys.length - 2000)) delete this.entries[old]
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined
        this.flushNow()
      }, 5000)
      this.flushTimer.unref?.()
    }
  }

  flushNow(): void {
    this.load()
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.tmp-${process.pid}`
    writeFileSync(temp, JSON.stringify(this.entries, null, 2) + '\n', 'utf8')
    renameSync(temp, this.path)
  }

  /** Flush only if a debounced write is pending — safe to call unconditionally on process exit. */
  flushIfPending(): void {
    if (!this.flushTimer) return
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    this.flushNow()
  }
}
