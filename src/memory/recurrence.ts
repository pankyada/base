export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export interface RecurrenceRule {
  freq: Frequency
  interval: number
  byday?: string[]
  bymonthday?: number[]
  until?: Date
  count?: number
}

const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const FIELDS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'UNTIL', 'COUNT'])

function parseOffsetTimestamp(value: string, field: string): Date {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error(`${field} must include an offset`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${field}`)
  return date
}

export function parseRecurrence(raw: string): RecurrenceRule {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('RRULE must be a non-empty string')
  const values = new Map<string, string>()
  for (const part of raw.split(';')) {
    const [rawKey, rawValue, ...extra] = part.split('=')
    const key = rawKey?.toUpperCase()
    if (!key || !rawValue || extra.length > 0 || !FIELDS.has(key) || values.has(key)) throw new Error(`invalid or duplicate RRULE field in "${raw}"`)
    values.set(key, rawValue)
  }
  const freq = values.get('FREQ') as Frequency | undefined
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) throw new Error(`unsupported RRULE FREQ in "${raw}"`)
  const interval = Number(values.get('INTERVAL') ?? '1')
  if (!Number.isSafeInteger(interval) || interval < 1) throw new Error(`invalid RRULE INTERVAL in "${raw}"`)

  const byday = values.get('BYDAY')?.split(',').filter(Boolean)
  if (byday?.some(day => !/^(?:-1|[1-5])?(?:MO|TU|WE|TH|FR|SA|SU)$/.test(day))) throw new Error(`invalid RRULE BYDAY in "${raw}"`)
  if (byday?.some(day => /^-?\d/.test(day) && freq !== 'MONTHLY')) throw new Error('ordinal BYDAY is only supported for MONTHLY rules')
  if (byday && freq !== 'WEEKLY' && freq !== 'MONTHLY') throw new Error('BYDAY is only supported for WEEKLY and MONTHLY rules')

  const bymonthday = values.get('BYMONTHDAY')?.split(',').map(Number)
  if (bymonthday?.some(day => !Number.isSafeInteger(day) || day === 0 || day < -1 || day > 31)) throw new Error(`invalid RRULE BYMONTHDAY in "${raw}"`)
  if (bymonthday && freq !== 'MONTHLY' && freq !== 'YEARLY') throw new Error('BYMONTHDAY is only supported for MONTHLY and YEARLY rules')

  const untilRaw = values.get('UNTIL')
  const until = untilRaw ? parseOffsetTimestamp(untilRaw, 'RRULE UNTIL') : undefined
  const countRaw = values.get('COUNT')
  const count = countRaw === undefined ? undefined : Number(countRaw)
  if (count !== undefined && (!Number.isSafeInteger(count) || count < 1)) throw new Error(`invalid RRULE COUNT in "${raw}"`)
  return { freq, interval, byday, bymonthday, until, count }
}

interface LocalDate { year: number; month: number; day: number; hour: number; minute: number; second: number; ms: number; offset: number }

function parseLocal(iso: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(iso)
  if (!match) throw new Error(`timestamp must be ISO-8601 with offset: "${iso}"`)
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6] ?? 0)
  const ms = Number((match[7] ?? '').padEnd(3, '0') || 0)
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) throw new Error(`invalid recurrence start timestamp: "${iso}"`)
  const offset = match[8] === 'Z' ? 0 : (match[8][0] === '-' ? -1 : 1) * (Number(match[8].slice(1, 3)) * 60 + Number(match[8].slice(4, 6)))
  return { year, month, day, hour, minute, second, ms, offset }
}

function daysInMonth(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate() }
function fixedOffsetInstant(local: LocalDate): Date { return new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.ms) - local.offset * 60_000) }

function zoneOffsetAt(instant: Date, timezone: string): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(instant).find(value => value.type === 'timeZoneName')?.value
  if (!part || part === 'GMT') return 0
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part)
  if (!match) throw new Error(`could not determine offset for timezone "${timezone}"`)
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0))
}

function zonedInstant(local: LocalDate, timezone: string): Date {
  const wallTime = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.ms)
  let instant = new Date(wallTime - local.offset * 60_000)
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = new Date(wallTime - zoneOffsetAt(instant, timezone) * 60_000)
    if (candidate.getTime() === instant.getTime()) return candidate
    instant = candidate
  }
  return instant
}

function toInstant(local: LocalDate, timezone?: string): Date { return timezone ? zonedInstant(local, timezone) : fixedOffsetInstant(local) }
function dayDiff(a: LocalDate, b: LocalDate): number { return Math.floor((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000) }
function monthDiff(a: LocalDate, b: LocalDate): number { return (b.year - a.year) * 12 + b.month - a.month }
function weekDiff(a: LocalDate, b: LocalDate): number {
  const aSunday = Date.UTC(a.year, a.month - 1, a.day) - new Date(Date.UTC(a.year, a.month - 1, a.day)).getUTCDay() * 86_400_000
  const bSunday = Date.UTC(b.year, b.month - 1, b.day) - new Date(Date.UTC(b.year, b.month - 1, b.day)).getUTCDay() * 86_400_000
  return Math.floor((bSunday - aSunday) / (7 * 86_400_000))
}

function weekday(date: LocalDate): string { return DAY_NAMES[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()] }

function matchesDay(rule: RecurrenceRule, start: LocalDate, date: LocalDate): boolean {
  if (!rule.byday) return weekday(date) === weekday(start)
  return rule.byday.some(value => {
    const name = value.slice(-2)
    if (name !== weekday(date)) return false
    const ordinal = value.slice(0, -2)
    if (!ordinal) return true
    if (ordinal === '-1') return date.day + 7 > daysInMonth(date.year, date.month)
    return Math.ceil(date.day / 7) === Number(ordinal)
  })
}

function matches(rule: RecurrenceRule, start: LocalDate, date: LocalDate): boolean {
  if (dayDiff(start, date) < 0) return false
  const cadence = rule.freq === 'DAILY'
    ? dayDiff(start, date) % rule.interval === 0
    : rule.freq === 'WEEKLY'
      ? weekDiff(start, date) % rule.interval === 0
      : rule.freq === 'MONTHLY'
        ? monthDiff(start, date) % rule.interval === 0
        : (date.year - start.year) % rule.interval === 0 && date.month === start.month
  if (!cadence) return false
  if (rule.bymonthday && !rule.bymonthday.some(day => date.day === (day === -1 ? daysInMonth(date.year, date.month) : day))) return false
  if (rule.byday && !matchesDay(rule, start, date)) return false
  if (rule.freq === 'WEEKLY' && !rule.byday && weekday(date) !== weekday(start)) return false
  if ((rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') && !rule.bymonthday && !rule.byday && date.day !== start.day) return false
  return true
}

/** Expand only a finite window and return at most cap occurrences. */
export function expandRecurrence(raw: string, startIso: string, from: Date, to: Date, cap = 366, timezone?: string): Date[] {
  const rule = parseRecurrence(raw)
  const start = parseLocal(startIso)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to.getTime() <= from.getTime() || cap <= 0) return []
  const occurrences: Date[] = []
  const cursor: LocalDate = { ...start, hour: 0, minute: 0, second: 0, ms: 0 }
  const stop = new Date(to.getTime() + 2 * 86_400_000)
  let matched = 0
  const maxIterations = Math.max(10_000, Math.min(5_000_000, cap * 20_000))
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const occurrence = toInstant({ ...cursor, hour: start.hour, minute: start.minute, second: start.second, ms: start.ms }, timezone)
    if (occurrence.getTime() >= stop.getTime()) break
    if (matches(rule, start, cursor)) {
      if (rule.until && occurrence.getTime() > rule.until.getTime()) break
      matched++
      if (occurrence >= from && occurrence < to) {
        occurrences.push(occurrence)
        if (occurrences.length >= cap) break
      }
      if (rule.count && matched >= rule.count) break
    }
    const next = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day) + 86_400_000)
    cursor.year = next.getUTCFullYear(); cursor.month = next.getUTCMonth() + 1; cursor.day = next.getUTCDate()
  }
  return occurrences
}

export const expand = expandRecurrence
