import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadProfile } from '../src/profiles/loader.js'

describe('loadProfile', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'harness-'))

  it('parses valid profile yaml', () => {
    const yaml = `
name: test
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
system_prompt: ${tmp}/prompt.md
working_dir: ${tmp}
artifact_dir: ${tmp}/artifacts
skills_dirs: []
`
    writeFileSync(join(tmp, 'profile.yaml'), yaml)
    writeFileSync(join(tmp, 'prompt.md'), '# prompt')
    const profile = loadProfile(join(tmp, 'profile.yaml'))
    expect(profile.name).toBe('test')
    expect(profile.model.id).toBe('gpt-4o')
    expect(profile.tools.builtin.Read).toBe('allow')
  })

  it('throws on missing required fields', () => {
    writeFileSync(join(tmp, 'bad.yaml'), 'name: bad')
    expect(() => loadProfile(join(tmp, 'bad.yaml'))).toThrow()
  })
})
