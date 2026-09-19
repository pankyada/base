import { appendFileSync, mkdirSync, statSync, renameSync, existsSync, unlinkSync } from 'fs'
import { dirname } from 'path'
import { harnessStatePath } from '../config/state-paths.js'
import { TelemetryEvent } from '../types.js'

export function telemetryFilePath(): string { return harnessStatePath('telemetry.jsonl') }

const MAX_TELEMETRY_BYTES = 5 * 1024 * 1024  // 5MB
const MAX_ROTATED_FILES = 5

function rotateTelemetry(path: string): void {
  // Delete the oldest rotated file if it exists
  const oldest = `${path}.${MAX_ROTATED_FILES}`
  if (existsSync(oldest)) unlinkSync(oldest)
  // Shift .4→.5, .3→.4, .2→.3, .1→.2
  for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
    const from = `${path}.${i}`
    const to = `${path}.${i + 1}`
    if (existsSync(from)) renameSync(from, to)
  }
  // Rotate current file to .1
  renameSync(path, `${path}.1`)
}

export function logEvent(event: Omit<TelemetryEvent, 'ts'>): void {
  try {
    const path = telemetryFilePath()
    mkdirSync(dirname(path), { recursive: true })
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event })
    try {
      const { size } = statSync(path)
      if (size > MAX_TELEMETRY_BYTES) rotateTelemetry(path)
    } catch {
      // statSync/rotation can fail in rare race conditions — rotation is best-effort
    }
    appendFileSync(path, line + '\n', 'utf-8')
  } catch {
    // Telemetry is best-effort — never let it crash the agent loop
  }
}
