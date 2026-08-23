import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { writeUserConfig } from '../src/config/user-config.js'
import { runDoctor, runDoctorCommand } from '../src/cli/doctor.js'

function profile(dir: string): void {
  const profiles = join(dir, '.harness', 'profiles')
  mkdirSync(profiles, { recursive: true })
  writeFileSync(join(profiles, 'prompt.md'), '# prompt')
  writeFileSync(join(profiles, 'coding.yaml'), 'name: coding\nmodel:\n  base_url: https://api.openai.com/v1\n  api_key_env: OPENAI_API_KEY\n  id: gpt-4o\nsystem_prompt: ./prompt.md\nartifact_dir: ./artifacts\n')
}

describe('doctor', () => {
  it('reports stable checks and fails independently without a config', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-doctor-'))
    try {
      const result = await runDoctor({ homeDir: home, environment: {}, offline: true })
      expect(result.ok).toBe(false)
      expect(result.checks.find(check => check.name === 'config')?.fix).toBe('harness init')
      expect(result.checks).toHaveLength(7)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('passes offline checks when config, profile, key, and path are present', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-doctor-'))
    try {
      profile(home)
      writeUserConfig({ version: 1, default_profile: 'coding', profiles_dir: '~/.harness/profiles', surface: 'cli', initialised_at: '2026-08-23T09:12:44Z', harness_version: '0.7.0' }, home)
      const result = await runDoctor({ homeDir: home, environment: { OPENAI_API_KEY: 'present', PATH: `${join(home, '.local', 'bin')}:bin` }, offline: true, portCheck: async () => true })
      expect(result.ok).toBe(true)
      expect(result.checks.every(check => check.ok)).toBe(true)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('emits a stable JSON result and non-zero status on failures', async () => {
    const home = mkdtempSync(join(tmpdir(), 'harness-doctor-'))
    const lines: string[] = []
    try {
      const status = await runDoctorCommand(['--offline', '--json'], { log: line => lines.push(line), error: () => {} }, { homeDir: home, environment: {} })
      expect(status).toBe(1)
      expect(JSON.parse(lines[0])).toMatchObject({ ok: false, checks: expect.any(Array) })
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
})
