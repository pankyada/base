import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { logEvent } from '../src/telemetry/logger.js'
import { queryEvents } from '../src/telemetry/query.js'

const TELEMETRY_PATH = join(homedir(), '.harness', 'telemetry.jsonl')

describe('telemetry', () => {
  beforeEach(() => {
    if (existsSync(TELEMETRY_PATH)) unlinkSync(TELEMETRY_PATH)
  })

  it('appends events to jsonl file', () => {
    logEvent({ session: 'abc', profile: 'coding', kind: 'tool', name: 'Read', ok: true, duration_ms: 10 })
    logEvent({ session: 'abc', profile: 'coding', kind: 'tool', name: 'Write', ok: true, duration_ms: 20 })
    const events = queryEvents({})
    expect(events).toHaveLength(2)
    expect(events[0].name).toBe('Read')
    expect(events[0].ts).toBeDefined()
  })

  it('filters by profile', () => {
    logEvent({ session: 'a', profile: 'coding', kind: 'tool', name: 'Read', ok: true })
    logEvent({ session: 'b', profile: 'data', kind: 'tool', name: 'Read', ok: true })
    const events = queryEvents({ profile: 'coding' })
    expect(events).toHaveLength(1)
  })

  it('filters by since date', () => {
    logEvent({ session: 'a', profile: 'coding', kind: 'tool', name: 'Read', ok: true })
    const future = new Date(Date.now() + 60_000)
    const events = queryEvents({ since: future })
    expect(events).toHaveLength(0)
  })
})
