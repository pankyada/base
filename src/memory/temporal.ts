import type { MemoryEntry, TemporalMeta } from './interface.js'
import { expandRecurrence } from './recurrence.js'

const TEMPORAL_KEYS = ['valid_from', 'valid_until', 'recur', 'timezone', 'entity', 'confidence', 'supersedes'] as const

export function parseTimestamp(value: string, field = 'timestamp'): Date {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error(`${field} must be ISO-8601 with offset: "${value}"`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${field}: "${value}"`)
  return date
}

/** Read only temporal keys; legacy frontmatter with none remains untouched. */
export function parseTemporal(data: Record<string, unknown>): TemporalMeta | undefined {
  const temporal: TemporalMeta = {}
  for (const key of TEMPORAL_KEYS) {
    const value = data[key]
    if (value === undefined) continue
    if (key === 'confidence') {
      if (typeof value !== 'number') throw new Error('temporal confidence must be a number')
      temporal.confidence = value
    } else {
      if (typeof value !== 'string') throw new Error(`temporal ${key} must be a string`)
      temporal[key] = value as never
    }
  }
  return Object.keys(temporal).length ? (validateTemporal(temporal), temporal) : undefined
}

export function serializeTemporal(meta?: TemporalMeta): Record<string, unknown> {
  if (!meta) return {}
  validateTemporal(meta)
  return Object.fromEntries(TEMPORAL_KEYS.filter(key => meta[key] !== undefined).map(key => [key, meta[key]]))
}

export function validateTemporal(meta: TemporalMeta | undefined): void {
  if (!meta) return
  const from = meta.valid_from ? parseTimestamp(meta.valid_from, 'valid_from') : undefined
  const until = meta.valid_until ? parseTimestamp(meta.valid_until, 'valid_until') : undefined
  if (from && until && until.getTime() < from.getTime()) throw new Error('valid_until must not precede valid_from')
  if (meta.confidence !== undefined && (!Number.isFinite(meta.confidence) || meta.confidence < 0 || meta.confidence > 1)) {
    throw new Error('confidence must be between 0 and 1')
  }
  if (meta.timezone) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: meta.timezone }).format() } catch { throw new Error(`invalid IANA timezone: "${meta.timezone}"`) }
  }
  if (meta.recur) {
    if (!meta.valid_from) throw new Error('recur requires valid_from with offset')
    expandRecurrence(meta.recur, meta.valid_from, from ?? new Date(), new Date((from ?? new Date()).getTime() + 86_400_000), 1, meta.timezone)
  }
}

function bound(meta: TemporalMeta | undefined, key: 'valid_from' | 'valid_until', fallback: number): number {
  const value = meta?.[key]
  return value ? parseTimestamp(value, key).getTime() : fallback
}

function recurrenceDuration(meta: TemporalMeta): number {
  if (!meta.valid_until || !meta.valid_from) return 86_400_000
  return Math.max(0, bound(meta, 'valid_until', 0) - bound(meta, 'valid_from', 0))
}

export function isValidAt(meta: TemporalMeta | undefined, at: Date): boolean {
  if (!meta?.recur) return at.getTime() >= bound(meta, 'valid_from', Number.NEGATIVE_INFINITY) && at.getTime() < bound(meta, 'valid_until', Number.POSITIVE_INFINITY)
  const duration = recurrenceDuration(meta)
  const occurrences = expandRecurrence(meta.recur, meta.valid_from!, new Date(at.getTime() - duration - 86_400_000), new Date(at.getTime() + 1), 366, meta.timezone)
  return occurrences.some(occurrence => occurrence.getTime() <= at.getTime() && at.getTime() < occurrence.getTime() + duration)
}

export function overlapsWindow(meta: TemporalMeta | undefined, from: Date, to: Date): boolean {
  if (to.getTime() <= from.getTime()) return false
  if (!meta?.recur) return bound(meta, 'valid_from', Number.NEGATIVE_INFINITY) < to.getTime() && bound(meta, 'valid_until', Number.POSITIVE_INFINITY) > from.getTime()
  const duration = recurrenceDuration(meta)
  return expandRecurrence(meta.recur, meta.valid_from!, new Date(from.getTime() - duration - 86_400_000), to, 366, meta.timezone)
    .some(occurrence => occurrence.getTime() < to.getTime() && occurrence.getTime() + duration > from.getTime())
}

export function validitySpecificity(meta: TemporalMeta | undefined): number {
  return bound(meta, 'valid_until', Number.POSITIVE_INFINITY) - bound(meta, 'valid_from', Number.NEGATIVE_INFINITY)
}

export function isExpired(meta: TemporalMeta | undefined, now: Date): boolean {
  return !meta?.recur && Boolean(meta?.valid_until) && bound(meta, 'valid_until', Number.POSITIVE_INFINITY) <= now.getTime()
}

export function isImminent(meta: TemporalMeta | undefined, now: Date, withinMs = 86_400_000): boolean {
  if (!meta?.valid_from) return false
  const starts = bound(meta, 'valid_from', Number.POSITIVE_INFINITY)
  return starts > now.getTime() && starts <= now.getTime() + withinMs && !isExpired(meta, now)
}

export function sortTemporalEntries(entries: MemoryEntry[], now = new Date()): MemoryEntry[] {
  return entries.filter(entry => isValidAt(entry.temporal, now))
}

// Names used by callers that describe the operation in frontmatter terms.
export const parseTemporalFrontmatter = parseTemporal
export const serializeTemporalFrontmatter = serializeTemporal
export const parseTemporalMeta = parseTemporal
export const serializeTemporalMeta = serializeTemporal
