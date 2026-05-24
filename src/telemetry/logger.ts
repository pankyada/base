import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { TelemetryEvent } from '../types.js'

export const TELEMETRY_PATH = join(homedir(), '.harness', 'telemetry.jsonl')

export function logEvent(event: Omit<TelemetryEvent, 'ts'>): void {
  mkdirSync(join(homedir(), '.harness'), { recursive: true })
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event })
  appendFileSync(TELEMETRY_PATH, line + '\n', 'utf-8')
}
