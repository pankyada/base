import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, unlinkSync, writeFileSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { logEvent } from '../src/telemetry/logger.js'
import { queryEvents } from '../src/telemetry/query.js'

const TELEMETRY_PATH = join(homedir(), '.harness', 'telemetry.jsonl')

describe('telemetry', () => {
  beforeEach(() => {
    if (existsSync(TELEMETRY_PATH)) unlinkSync(TELEMETRY_PATH)
    for (let i = 1; i <= 5; i++) {
      const p = `${TELEMETRY_PATH}.${i}`
      if (existsSync(p)) unlinkSync(p)
    }
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

  it('rotates current file to .1 when size exceeds 5MB', () => {
    // Write >5MB so next logEvent triggers rotation
    mkdirSync(join(homedir(), '.harness'), { recursive: true })
    writeFileSync(TELEMETRY_PATH, 'x'.repeat(5 * 1024 * 1024 + 1))
    logEvent({ session: 'abc', profile: 'test', kind: 'tool', name: 'Read', ok: true })
    expect(existsSync(`${TELEMETRY_PATH}.1`)).toBe(true)
    // New file has only the one appended event
    const events = queryEvents({})
    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('Read')
  })

  it('shifts existing rotated files and deletes oldest beyond .5', () => {
    mkdirSync(join(homedir(), '.harness'), { recursive: true })
    // Pre-create .1 through .5
    for (let i = 1; i <= 5; i++) {
      writeFileSync(`${TELEMETRY_PATH}.${i}`, `content-${i}`)
    }
    // Write >5MB and trigger rotation
    writeFileSync(TELEMETRY_PATH, 'x'.repeat(5 * 1024 * 1024 + 1))
    logEvent({ session: 'abc', profile: 'test', kind: 'tool', name: 'Read', ok: true })
    // Old .5 is gone (replaced by old .4)
    expect(readFileSync(`${TELEMETRY_PATH}.5`, 'utf-8')).toBe('content-4')
    expect(readFileSync(`${TELEMETRY_PATH}.4`, 'utf-8')).toBe('content-3')
    expect(readFileSync(`${TELEMETRY_PATH}.2`, 'utf-8')).toBe('content-1')
    // .1 now holds the big pre-rotation file
    expect(readFileSync(`${TELEMETRY_PATH}.1`, 'utf-8').length).toBeGreaterThan(5 * 1024 * 1024)
  })

  it('queryEvents returns only the last 2000 lines when file has more', () => {
    // Write 2500 JSON lines directly
    mkdirSync(join(homedir(), '.harness'), { recursive: true })
    const lines = Array.from({ length: 2500 }, (_, i) =>
      JSON.stringify({ ts: new Date().toISOString(), session: 'x', profile: 'test', kind: 'tool' as const, name: `T${i}`, ok: true })
    ).join('\n') + '\n'
    writeFileSync(TELEMETRY_PATH, lines)
    const events = queryEvents({})
    expect(events).toHaveLength(2000)
    expect(events[events.length - 1].name).toBe('T2499')
  })
})
