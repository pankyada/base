import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** Resolve mutable Harness state without changing the established default layout. */
export function harnessStateDirectory(): string {
  const configured = process.env.HARNESS_STATE_DIR?.trim()
  if (!configured) return join(homedir(), '.harness')
  if (!isAbsolute(configured)) throw new Error('HARNESS_STATE_DIR must be absolute')
  return resolve(configured)
}

/** Resolve a mutable state path at call time so process-specific overrides are never module-cached. */
export function harnessStatePath(...segments: string[]): string {
  return join(harnessStateDirectory(), ...segments)
}
