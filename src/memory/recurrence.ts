type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

interface Rule {
  freq: Frequency
  interval: number
  byday?: string[]
  bymonthday?: number[]
  until?: Date
  count?: number
}

const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function parseRule(raw: string): Rule {
  const values = new Map(raw.split(';').map(part => {
    const [key, value] = part.split('=', 2)
    return [key?.toUpperCase(), value]
  }))
  const freq = values.get('FREQ') as Frequency | undefined
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) throw new Error(`unsupported RRULE FREQ in "${raw}"`)
  const interval = Number(values.get('INTERVAL') ?? '1')
  if (!Number.isInteger(interval) || interval < 1) throw new Error(`invalid RRULE INTERVAL in "${raw}"`)
  const byday = values.get('BYDAY')?.split(',').filter(Boolean)
  if (byday?.some(day => !/^(?:[1-5]|-1)?(?:MO|TU|WE|TH|FR|SA|SU)$/.test(day))) throw new Error(`invalid RRULE BYDAY in "${raw}"`)
  const bymonthday = values.get('BYMONTHDAY')?.split(',').map(Number)
  if (bymonthday?.some(day => !Number.isInteger(day) || day === 0 || day < -1 || day > 31)) throw new Error(`invalid RRULE BYMONTHDAY in "${raw}"`)
  const untilRaw = values.get('UNTIL')
  const until = untilRaw ? new Date(untilRaw) : undefined
  if (until && Number.isNaN(until.getTime())) throw new Error(`invalid RRULE UNTIL in "${raw}"`)
  const countRaw = values.get('COUNT')
  const count = countRaw === undefined ? undefined : Number(countRaw)
  if (count !== undefined && (!Number.isInteger(count) || count < 1)) throw new Error(`invalid RRULE COUNT in "${raw}"`)
  for (const key of values.keys()) if (!['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'UNTIL', 'COUNT'].includes(key ?? '')) throw new Error(`unsupported RRULE field "${key}"`)
  return { freq, interval, byday, bymonthday, until, count }
}

interface LocalDate { year: number; month: number; day: number; hour: number; minute: number; second: number; ms: number; offset: number }

function parseLocal(iso: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(iso)
  if (!match) throw new Error(`timestamp must be ISO-8601 with offset: "${iso}"`)
  const offset = match[8] === 'Z' ? 0 : (match[8][0] === '-' ? -1 : 1) * (Number(match[8].slice(1, 3)) * 60 + Number(match[8].slice(4, 6)))
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0), ms: Number((match[7] ?? '').padEnd(3, '0') || 0), offset }
}

function daysInMonth(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate() }
function fixedOffsetInstant(local: LocalDate): Date { return new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.ms) - local.offset * 60_000) }

function zoneOffsetAt(instant: Date, timezone: string): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find(value => value.type === 'timeZoneName')?.value
  if (!part || part === 'GMT') return 0
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part)
  if (!match) throw new Error(`could not determine offset for timezone "${timezone}"`)
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
}

function zonedInstant(local: LocalDate, timezone: string): Date {
  const wallTime = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.ms)
  let instant = new Date(wallTime - local.offset * 60_000)
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = new Date(wallTime - zoneOffsetAt(instant, timezone) * 60_000)
    if (candidate.getTime() === instant.getTime()) return candidate
    instant = candidate
  }
  return instant
}

function toInstant(local: LocalDate, timezone?: string): Date {
  return timezone ? zonedInstant(local, timezone) : fixedOffsetInstant(local)
}
function dayDiff(a: LocalDate, b: LocalDate): number { return Math.floor((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000) }
function monthDiff(a: LocalDate, b: LocalDate): number { return (b.year - a.year) * 12 + b.month - a.month }
function weekDiff(a: LocalDate, b: LocalDate): number {
  const aSunday = Date.UTC(a.year, a.month - 1, a.day) - new Date(Date.UTC(a.year, a.month - 1, a.day)).getUTCDay() * 86_400_000
  const bSunday = Date.UTC(b.year, b.month - 1, b.day) - new Date(Date.UTC(b.year, b.month - 1, b.day)).getUTCDay() * 86_400_000
  return Math.floor((bSunday - aSunday) / (7 * 86_400_000))
}

function matchesDay(rule: Rule, start: LocalDate, date: LocalDate): boolean {
  const weekday = DAY_NAMES[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()]
  if (!rule.byday) return weekday === DAY_NAMES[new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay()]
  return rule.byday.some(value => {
    const ordinal = value.slice(0, -2)
    const name = value.slice(-2)
    if (name !== weekday) return false
    if (!ordinal) return true
    const target = Number(ordinal)
    if (target === -1) return date.day + 7 > daysInMonth(date.year, date.month)
    return Math.ceil(date.day / 7) === target
  })
}

function matches(rule: Rule, start: LocalDate, date: LocalDate): boolean {
  if (date.year < start.year || (date.year === start.year && (date.month < start.month || (date.month === start.month && date.day < start.day)))) return false
  if (rule.freq === 'DAILY') return dayDiff(start, date) % rule.interval === 0
  if (rule.freq === 'WEEKLY') return weekDiff(start, date) % rule.interval === 0 && matchesDay(rule, start, date)
  if (rule.freq === 'MONTHLY') {
    if (monthDiff(start, date) % rule.interval !== 0) return false
    if (rule.bymonthday) return rule.bymonthday.some(day => date.day === (day === -1 ? daysInMonth(date.year, date.month) : day))
    return rule.byday ? matchesDay(rule, start, date) : date.day === start.day
  }
  if ((date.year - start.year) % rule.interval !== 0 || date.month !== start.month) return false
  return rule.bymonthday ? rule.bymonthday.some(day => date.day === (day === -1 ? daysInMonth(date.year, date.month) : day)) : date.day === start.day
}

export function expandRecurrence(raw: string, startIso: string, from: Date, to: Date, cap = 366, timezone?: string): Date[] {
  const rule = parseRule(raw)
  const start = parseLocal(startIso)
  const occurrences: Date[] = []
  let count = 0
  const cursor = { ...start, hour: 0, minute: 0, second: 0, ms: 0 }
  const stop = new Date(to.getTime() + 86_400_000)
  while (toInstant(cursor, timezone).getTime() < stop.getTime() && occurrences.length < cap) {
    if (matches(rule, start, cursor)) {
      const occurrence = toInstant({ ...cursor, hour: start.hour, minute: start.minute, second: start.second, ms: start.ms }, timezone)
      if (!rule.until || occurrence.getTime() <= rule.until.getTime()) {
        count++
        if (occurrence >= from && occurrence < to) occurrences.push(occurrence)
        if (rule.count && count >= rule.count) break
      }
    }
    const next = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day) + 86_400_000)
    cursor.year = next.getUTCFullYear(); cursor.month = next.getUTCMonth() + 1; cursor.day = next.getUTCDate()
  }
  return occurrences
}
