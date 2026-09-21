import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

// Vitest setup file: runs once before any test module loads. Keeps the whole
// suite off the real user's ~/.harness by pointing HARNESS_STATE_DIR at a
// fresh temp directory for the duration of the run. Tests that need to
// exercise a specific pre-existing HARNESS_STATE_DIR (or homeDir override)
// still work unaffected — this only supplies a default when nothing set one.
const preExisting = process.env.HARNESS_STATE_DIR

let isolatedDir: string | undefined
if (!preExisting) {
  isolatedDir = mkdtempSync(join(tmpdir(), 'harness-test-state-'))
  process.env.HARNESS_STATE_DIR = isolatedDir
}

afterAll(() => {
  if (isolatedDir) {
    rmSync(isolatedDir, { recursive: true, force: true })
  }
})
