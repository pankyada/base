import { afterEach, describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { harnessStatePath } from '../src/config/state-paths.js'

const previousStateDir = process.env.HARNESS_STATE_DIR

afterEach(() => {
  if (previousStateDir === undefined) delete process.env.HARNESS_STATE_DIR
  else process.env.HARNESS_STATE_DIR = previousStateDir
})

describe('harnessStatePath', () => {
  it('keeps the existing per-user state root by default', () => {
    delete process.env.HARNESS_STATE_DIR
    expect(harnessStatePath('runs', 'default')).toBe(join(homedir(), '.harness', 'runs', 'default'))
  })

  it('uses the current absolute override instead of a module-cached root', () => {
    process.env.HARNESS_STATE_DIR = '/tmp/harness-state-first'
    expect(harnessStatePath('runs')).toBe('/tmp/harness-state-first/runs')
    process.env.HARNESS_STATE_DIR = '/tmp/harness-state-second'
    expect(harnessStatePath('sessions', 'alice')).toBe('/tmp/harness-state-second/sessions/alice')
  })

  it('rejects a relative override', () => {
    process.env.HARNESS_STATE_DIR = 'relative-state'
    expect(() => harnessStatePath('runs')).toThrow(/must be absolute/i)
  })
})
