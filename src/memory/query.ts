import type { MemoryEntry, RecallQuery, TemporalMeta } from './interface.js'
import { expandRecurrence } from './recurrence.js'

function parseAt(value?: string): Date {
  const at = value ? new Date(value) : new Date()
  if (Number.isNaN(at.getTime())) throw new Error(`invalid recall time "${value}"`)
  return at
}

function windowFor(query: RecallQuery, at: Date): { from: Date; to: Date } | undefined {
  if (!query.window) return undefined
  const range = /^(\d{4}-\d{2}-\d{2}(?:T[^.]+(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?)\.\.(\d{4}-\d{2}-\d{2}(?:T[^.]+(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?)$/.exec(query.window)
  if (range) return { from: parseAt(range[1]), to: parseAt(range[2]) }
  const relative = /^(next|last)\s+(\d+)d$/.exec(query.window.trim().toLowerCase())
  if (!relative) throw new Error(`invalid recall window "${query.window}"`)
  const delta = Number(relative[2]) * 86_400_000
  return relative[1] === 'next' ? { from: at, to: new Date(at.getTime() + delta) } : { from: new Date(at.getTime() - delta), to: at }
}

function dateOr(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`temporal timestamp must be ISO-8601 with offset: "${value}"`)
  return date.getTime()
}

export function validateTemporal(meta: TemporalMeta | undefined): void {
  if (!meta) return
  for (const value of [meta.valid_from, meta.valid_until]) {
    if (value && !/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error(`temporal timestamp needs an explicit offset: "${value}"`)
    if (value && Number.isNaN(new Date(value).getTime())) throw new Error(`invalid temporal timestamp: "${value}"`)
  }
  if (meta.valid_from && meta.valid_until && new Date(meta.valid_until).getTime() < new Date(meta.valid_from).getTime()) throw new Error('valid_until must not precede valid_from')
  if (meta.confidence !== undefined && (meta.confidence < 0 || meta.confidence > 1 || !Number.isFinite(meta.confidence))) throw new Error('confidence must be between 0 and 1')
  if (meta.timezone) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: meta.timezone }).format() } catch { throw new Error(`invalid IANA timezone: "${meta.timezone}"`) }
  }
  if (meta.recur && !meta.valid_from) throw new Error('recur requires valid_from with offset')
  if (meta.recur && meta.valid_from) expandRecurrence(meta.recur, meta.valid_from, new Date(meta.valid_from), new Date(new Date(meta.valid_from).getTime() + 86_400_000), 1, meta.timezone)
}

function activeAt(meta: TemporalMeta | undefined, at: Date): boolean {
  if (!meta?.recur) return at.getTime() >= dateOr(meta?.valid_from, Number.NEGATIVE_INFINITY) && at.getTime() <= dateOr(meta?.valid_until, Number.POSITIVE_INFINITY)
  const start = new Date(meta.valid_from!)
  const duration = meta.valid_until ? Math.max(1, new Date(meta.valid_until).getTime() - start.getTime()) : 86_400_000
  return expandRecurrence(meta.recur, meta.valid_from!, new Date(at.getTime() - duration), new Date(at.getTime() + 1), 366, meta.timezone)
    .some(occurrence => occurrence.getTime() <= at.getTime() && at.getTime() < occurrence.getTime() + duration)
}

function overlaps(meta: TemporalMeta | undefined, from: Date, to: Date): boolean {
  if (!meta?.recur) return dateOr(meta?.valid_from, Number.NEGATIVE_INFINITY) < to.getTime() && dateOr(meta?.valid_until, Number.POSITIVE_INFINITY) >= from.getTime()
  const start = new Date(meta.valid_from!)
  const duration = meta.valid_until ? Math.max(1, new Date(meta.valid_until).getTime() - start.getTime()) : 86_400_000
  return expandRecurrence(meta.recur, meta.valid_from!, new Date(from.getTime() - duration), to, 366, meta.timezone)
    .some(occurrence => occurrence.getTime() < to.getTime() && occurrence.getTime() + duration >= from.getTime())
}

function specificity(meta: TemporalMeta | undefined): number {
  const from = dateOr(meta?.valid_from, Number.NEGATIVE_INFINITY)
  const until = dateOr(meta?.valid_until, Number.POSITIVE_INFINITY)
  return until - from
}

export function queryEntries(entries: MemoryEntry[], query: RecallQuery): MemoryEntry[] {
  const at = parseAt(query.at)
  const window = windowFor(query, at)
  const text = query.text?.toLowerCase()
  const selected = entries.filter(entry => {
    if (window ? !overlaps(entry.temporal, window.from, window.to) : !activeAt(entry.temporal, at)) return false
    if (query.entity && !(entry.temporal?.entity === query.entity || (query.entity.endsWith('/') && entry.temporal?.entity?.startsWith(query.entity)))) return false
    if (query.relation && !entry.links?.some(link => link.relation === query.relation)) return false
    if (text && !`${entry.key} ${entry.content ?? entry.preview}`.toLowerCase().includes(text)) return false
    return true
  })
  const selectedByKey = new Map(selected.map(entry => [entry.key, entry]))
  const superseded = new Set(selected.flatMap(entry => entry.temporal?.supersedes && selectedByKey.has(entry.temporal.supersedes) ? [entry.temporal.supersedes] : []))
  const collapsed = new Map<string, MemoryEntry>()
  for (const entry of selected) {
    if (superseded.has(entry.key)) continue
    const entity = entry.temporal?.entity
    if (!entity) { collapsed.set(`key:${entry.key}`, entry); continue }
    const existing = collapsed.get(`entity:${entity}`)
    if (!existing || dateOr(entry.temporal?.valid_from, Number.NEGATIVE_INFINITY) > dateOr(existing.temporal?.valid_from, Number.NEGATIVE_INFINITY)) collapsed.set(`entity:${entity}`, entry)
  }
  return [...collapsed.values()]
    .sort((a, b) => specificity(a.temporal) - specificity(b.temporal)
      || dateOr(b.temporal?.valid_from, Number.NEGATIVE_INFINITY) - dateOr(a.temporal?.valid_from, Number.NEGATIVE_INFINITY)
      || (b.temporal?.confidence ?? 1) - (a.temporal?.confidence ?? 1)
      || a.key.localeCompare(b.key))
    .slice(0, query.limit ?? 20)
}

/** Facts starting in the next day belong in the system-prefix pin band. */
export function imminentEntries(entries: MemoryEntry[], at = new Date(), withinMs = 86_400_000): MemoryEntry[] {
  return entries
    .filter(entry => {
      const start = entry.temporal?.valid_from
      if (!start) return false
      const instant = new Date(start).getTime()
      return Number.isFinite(instant) && instant > at.getTime() && instant <= at.getTime() + withinMs
    })
    .sort((a, b) => dateOr(a.temporal?.valid_from, Number.POSITIVE_INFINITY) - dateOr(b.temporal?.valid_from, Number.POSITIVE_INFINITY))
}
