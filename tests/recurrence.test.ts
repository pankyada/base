import { describe, expect, it } from 'vitest'
import { expandRecurrence } from '../src/memory/recurrence.js'

describe('bounded recurrence', () => {
  it('skips invalid month days and supports last-day recurrence', () => {
    const from = new Date('2026-04-01T00:00:00Z')
    const to = new Date('2026-06-01T00:00:00Z')
    expect(expandRecurrence('FREQ=MONTHLY;BYMONTHDAY=31', '2026-01-31T09:00:00+05:30', from, to).map(date => date.toISOString().slice(0, 10))).toEqual(['2026-05-31'])
    expect(expandRecurrence('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-01-31T09:00:00+05:30', from, to).map(date => date.toISOString().slice(0, 10))).toEqual(['2026-04-30', '2026-05-31'])
  })

  it('honors COUNT and leap days', () => {
    const dates = expandRecurrence('FREQ=YEARLY;COUNT=3', '2024-02-29T09:00:00+05:30', new Date('2024-01-01T00:00:00Z'), new Date('2035-01-01T00:00:00Z'))
    expect(dates.map(date => date.toISOString().slice(0, 10))).toEqual(['2024-02-29', '2028-02-29', '2032-02-29'])
  })

  it('stops at UNTIL even when COUNT permits more occurrences', () => {
    const dates = expandRecurrence(
      'FREQ=DAILY;COUNT=10;UNTIL=2026-01-03T09:00:00+00:00',
      '2026-01-01T09:00:00+00:00',
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-10T00:00:00Z'),
    )
    expect(dates.map(date => date.toISOString())).toEqual([
      '2026-01-01T09:00:00.000Z',
      '2026-01-02T09:00:00.000Z',
      '2026-01-03T09:00:00.000Z',
    ])
  })

  it.each([
    ['spring forward', '2026-03-07T09:00:00-05:00', '2026-03-08T13:00:00.000Z'],
    ['fall back', '2026-10-31T09:00:00-04:00', '2026-11-01T14:00:00.000Z'],
  ])('keeps 9am local through %s', (_name, start, expected) => {
    const dates = expandRecurrence(
      'FREQ=DAILY;COUNT=2',
      start,
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-11-03T00:00:00Z'),
      366,
      'America/New_York',
    )
    expect(dates[1]?.toISOString()).toBe(expected)
  })
})
