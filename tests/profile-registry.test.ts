import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadProfileDirectory, selectProfile } from '../src/profiles/registry.js'

function yaml(name: string) {
  return `name: ${name}\nmodel:\n  base_url: https://api.openai.com/v1\n  api_key_env: KEY\n  id: gpt-4o\nsystem_prompt: ./prompt.md\nartifact_dir: ./artifacts\n`
}

describe('profile registry', () => {
  it('loads valid YAML profiles, skips invalid files, and chooses alphabetically by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'profile-registry-'))
    writeFileSync(join(dir, 'zeta.yaml'), yaml('zeta')); writeFileSync(join(dir, 'alpha.yaml'), yaml('alpha'))
    writeFileSync(join(dir, 'broken.yaml'), 'not: [yaml')
    writeFileSync(join(dir, 'prompt.md'), '# prompt')
    const registry = loadProfileDirectory(dir)
    expect([...registry.profiles.keys()]).toEqual(['alpha', 'zeta'])
    expect(registry.errors).toHaveLength(1)
    expect(registry.defaultProfile.name).toBe('alpha')
  })

  it('rejects unknown names without silently falling back', () => {
    const profiles = new Map([['alpha', { name: 'alpha' } as any]])
    expect(() => selectProfile(profiles, 'missing')).toThrow('unknown profile "missing"; available: alpha')
  })
})
