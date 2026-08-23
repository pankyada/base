import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { readUserConfig, resolveDefaultProfile, writeUserConfig } from '../src/config/user-config.js'

function home(): string {
  return mkdtempSync(join(tmpdir(), 'harness-user-config-'))
}

const config = {
  version: 1 as const,
  default_profile: 'data',
  profiles_dir: '~/.harness/profiles',
  surface: 'tui' as const,
  initialised_at: '2026-08-23T09:12:44Z',
  harness_version: '0.7.0',
}

describe('user config', () => {
  it('round-trips known and future fields unchanged', () => {
    const dir = home()
    try {
      writeUserConfig({ ...config, future_setting: { keep: true } }, dir)
      expect(readUserConfig(dir)).toEqual({ ...config, future_setting: { keep: true } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('degrades safely for missing, malformed, and wrong-version config', () => {
    const dir = home()
    const file = join(dir, '.harness', 'config.json')
    try {
      expect(readUserConfig(dir)).toBeUndefined()
      mkdirSync(join(dir, '.harness'))
      writeFileSync(file, '{')
      expect(readUserConfig(dir)).toBeUndefined()
      writeFileSync(file, JSON.stringify({ ...config, version: 2 }))
      expect(readUserConfig(dir)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves the default in explicit, environment, config, then coding order', () => {
    const dir = home()
    try {
      writeUserConfig(config, dir)
      expect(resolveDefaultProfile({ explicitProfile: 'devops', environment: { HARNESS_PROFILE: 'research' }, homeDir: dir })).toBe('devops')
      expect(resolveDefaultProfile({ environment: { HARNESS_PROFILE: 'research' }, homeDir: dir })).toBe('research')
      expect(resolveDefaultProfile({ environment: {}, homeDir: dir })).toBe('data')
      expect(resolveDefaultProfile({ environment: {}, homeDir: join(dir, 'missing') })).toBe('coding')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
