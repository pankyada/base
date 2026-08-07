import type { MemoryEntry, RecallQuery, TemporalMeta } from './interface.js'
import { isImminent, isValidAt, overlapsWindow, parseTimestamp, validateTemporal, validitySpecificity } from './temporal.js'

function parseAt(value?: string): Date {
  if (!value) return new Date()
  return parseQueryTimestamp(value, 'recall at')
}

function parseQueryTimestamp(value: string, field: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`)
    if (!Number.isNaN(date.getTime())) return date
  }
  return parseTimestamp(value, field)
}

function parseWindow(value: string, at: Date): { from: Date; to: Date } {
  const relative = /^(next|last)\s+(\d+)d$/i.exec(value.trim())
  if (relative) {
    const delta = Number(relative[2]) * 86_400_000
    return relative[1].toLowerCase() === 'next'
      ? { from: at, to: new Date(at.getTime() + delta) }
      : { from: new Date(at.getTime() - delta), to: at }
  }
  const separator = value.indexOf('..')
  if (separator > 0 && value.indexOf('..', separator + 2) === -1) {
    return {
      from: parseQueryTimestamp(value.slice(0, separator), 'window start'),
      to: parseQueryTimestamp(value.slice(separator + 2), 'window end'),
    }
  }
  throw new Error(`invalid recall window "${value}"`)
}

function dateOr(value: string | undefined, fallback: number): number {
  return value ? parseTimestamp(value).getTime() : fallback
}

function lexicalScore(entry: MemoryEntry, text?: string): number {
  if (!text) return 0
  const haystack = `${entry.key} ${entry.content ?? entry.preview}`.toLowerCase()
  const needle = text.toLowerCase().trim()
  if (!needle) return 0
  let score = 0
  let offset = 0
  while ((offset = haystack.indexOf(needle, offset)) !== -1) { score++; offset += needle.length }
  return score
}

function entityMatches(entity: string | undefined, query?: string): boolean {
  if (!query) return true
  return entity === query || (query.endsWith('/') && entity !== undefined && entity.startsWith(query))
}

export { validateTemporal }

export function queryEntries(entries: MemoryEntry[], query: RecallQuery): MemoryEntry[] {
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) throw new Error('recall limit must be a positive integer')
  const at = parseAt(query.at)
  const window = query.window ? parseWindow(query.window, at) : undefined
  const text = query.text?.trim()
  const selected = entries
    .filter(entry => window ? overlapsWindow(entry.temporal, window.from, window.to) : isValidAt(entry.temporal, at))
    .filter(entry => entityMatches(entry.temporal?.entity, query.entity))
    .filter(entry => !query.relation || entry.links?.some(link => link.relation === query.relation))
    .filter(entry => !text || lexicalScore(entry, text) > 0)
    .map(entry => ({ entry, lexical: lexicalScore(entry, text) }))

  const selectedByKey = new Map(selected.map(item => [item.entry.key, item.entry]))
  const superseded = new Set<string>()
  for (const { entry } of selected) {
    const replacement = entry.temporal?.supersedes
    if (replacement && selectedByKey.has(replacement)) superseded.add(replacement)
  }

  const collapsed = new Map<string, { entry: MemoryEntry; lexical: number }>()
  for (const item of selected) {
    if (superseded.has(item.entry.key)) continue
    const entity = item.entry.temporal?.entity
    const key = entity ? `entity:${entity}` : `key:${item.entry.key}`
    const existing = collapsed.get(key)
    if (!existing || !entity || newerEntityFact(item.entry, existing.entry) || (sameInstant(item.entry, existing.entry) && compare(item, existing) < 0)) collapsed.set(key, item)
  }

  return [...collapsed.values()]
    .sort(compare)
    .map(item => item.entry)
    .slice(0, query.limit ?? 20)
}

function compare(a: { entry: MemoryEntry; lexical: number }, b: { entry: MemoryEntry; lexical: number }): number {
  const aSpecificity = validitySpecificity(a.entry.temporal)
  const bSpecificity = validitySpecificity(b.entry.temporal)
  const specificity = aSpecificity === bSpecificity ? 0 : aSpecificity < bSpecificity ? -1 : 1
  const aFrom = dateOr(a.entry.temporal?.valid_from, Number.NEGATIVE_INFINITY)
  const bFrom = dateOr(b.entry.temporal?.valid_from, Number.NEGATIVE_INFINITY)
  const recency = aFrom === bFrom ? 0 : bFrom < aFrom ? -1 : 1
  return specificity
    || recency
    || (b.entry.temporal?.confidence ?? 1) - (a.entry.temporal?.confidence ?? 1)
    || b.lexical - a.lexical
    || a.entry.key.localeCompare(b.entry.key)
}

function sameInstant(a: MemoryEntry, b: MemoryEntry): boolean {
  return dateOr(a.temporal?.valid_from, Number.NEGATIVE_INFINITY) === dateOr(b.temporal?.valid_from, Number.NEGATIVE_INFINITY)
}

function newerEntityFact(a: MemoryEntry, b: MemoryEntry): boolean {
  const aFrom = dateOr(a.temporal?.valid_from, Number.NEGATIVE_INFINITY)
  const bFrom = dateOr(b.temporal?.valid_from, Number.NEGATIVE_INFINITY)
  return aFrom > bFrom
}

/** Facts beginning in the next day are candidates for the memory prefix band. */
export function imminentEntries(entries: MemoryEntry[], at = new Date(), withinMs = 86_400_000): MemoryEntry[] {
  const candidates = entries
    .filter(entry => isImminent(entry.temporal, at, withinMs))
  const superseded = new Set(entries.flatMap(entry => entry.temporal?.supersedes ? [entry.temporal.supersedes] : []))
  const latestByEntity = new Map<string, MemoryEntry>()
  for (const entry of candidates) {
    const entity = entry.temporal?.entity
    if (!entity) continue
    const existing = latestByEntity.get(entity)
    if (!existing || newerEntityFact(entry, existing)) latestByEntity.set(entity, entry)
  }
  return candidates
    .filter(entry => !superseded.has(entry.key))
    .filter(entry => !entry.temporal?.entity || latestByEntity.get(entry.temporal.entity)?.key === entry.key)
    .sort((a, b) => dateOr(a.temporal?.valid_from, Number.POSITIVE_INFINITY) - dateOr(b.temporal?.valid_from, Number.POSITIVE_INFINITY))
}

export { isValidAt, overlapsWindow, isImminent, validitySpecificity }
