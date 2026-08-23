import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { writeUserConfig } from '../src/config/user-config.js'
import { loadStartupProfiles } from '../src/server/profile-startup.js'

function yaml(name: string): string {
  return `name: ${name}\nmodel:\n  base_url: https://api.openai.com/v1\n  api_key_env: KEY\n  id: gpt-4o\nsystem_prompt: ./prompt.md\nartifact_dir: ./artifacts\n`
}

function writeProfiles(home: string, names: string[]): void {
  const dir = join(home, '.harness', 'profiles')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'prompt.md'), '# prompt')
  for (const name of names) writeFileSync(join(dir, `${name}.yaml`), yaml(name))
}

describe('server startup profiles', () => {
  it('loads the user profile directory and honours its default pointer', () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-profile-startup-'))
    try {
      const names = ['coding', 'data', 'assistant', 'devops', 'research', 'researcher', 'summariser', 'writer', 'security']
      writeProfiles(home, names)
      writeUserConfig({ version: 1, default_profile: 'data', profiles_dir: '~/.harness/profiles', surface: 'tui', initialised_at: '2026-08-23T09:12:44Z', harness_version: '0.7.0' }, home)

      const registry = loadStartupProfiles({ homeDir: home, environment: {} })
      expect(registry.defaultProfile.name).toBe('data')
      expect(registry.profiles.size).toBe(9)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('keeps coding.yaml as the last-resort fallback', () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-profile-startup-'))
    try {
      const dir = join(home, '.harness', 'profiles')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'prompt.md'), '# prompt')
      writeFileSync(join(dir, 'coding.yaml'), yaml('coding'))

      expect(loadStartupProfiles({ homeDir: home, environment: {} }).defaultProfile.name).toBe('coding')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
