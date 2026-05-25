import { appendFileSync, mkdirSync, statSync, renameSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { TelemetryEvent } from '../types.js'

export const TELEMETRY_PATH = join(homedir(), '.harness', 'telemetry.jsonl')

const MAX_TELEMETRY_BYTES = 5 * 1024 * 1024  // 5MB
const MAX_ROTATED_FILES = 5

function rotateTelemetry(): void {
  // Delete the oldest rotated file if it exists
  const oldest = `${TELEMETRY_PATH}.${MAX_ROTATED_FILES}`
  if (existsSync(oldest)) unlinkSync(oldest)
  // Shift .4→.5, .3→.4, .2→.3, .1→.2
  for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
    const from = `${TELEMETRY_PATH}.${i}`
    const to = `${TELEMETRY_PATH}.${i + 1}`
    if (existsSync(from)) renameSync(from, to)
  }
  // Rotate current file to .1
  renameSync(TELEMETRY_PATH, `${TELEMETRY_PATH}.1`)
}

export function logEvent(event: Omit<TelemetryEvent, 'ts'>): void {
  try {
    mkdirSync(join(homedir(), '.harness'), { recursive: true })
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event })
    try {
      const { size } = statSync(TELEMETRY_PATH)
      if (size > MAX_TELEMETRY_BYTES) rotateTelemetry()
    } catch {
      // statSync/rotation can fail in rare race conditions — rotation is best-effort
    }
    appendFileSync(TELEMETRY_PATH, line + '\n', 'utf-8')
  } catch {
    // Telemetry is best-effort — never let it crash the agent loop
  }
}
