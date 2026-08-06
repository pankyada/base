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

  it('resolves relative system_prompt against the profile file dir, not cwd', () => {
    const subdir = mkdtempSync(join(tmpdir(), 'harness-profiledir-'))
    const yaml = `
name: test
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
system_prompt: ./prompt.md
artifact_dir: ${subdir}/artifacts
`
    writeFileSync(join(subdir, 'profile.yaml'), yaml)
    writeFileSync(join(subdir, 'prompt.md'), '# prompt')
    const profile = loadProfile(join(subdir, 'profile.yaml'))
    expect(profile.system_prompt).toBe(join(subdir, 'prompt.md'))
  })

  it('resolves optional voice prompt beside the profile', () => {
    const subdir = mkdtempSync(join(tmpdir(), 'harness-voice-profiledir-'))
    writeFileSync(join(subdir, 'profile.yaml'), `name: voice\nmodel:\n  base_url: https://api.openai.com/v1\n  api_key_env: KEY\n  id: gpt-4o\nsystem_prompt: ./prompt.md\nsystem_prompt_voice: ./voice.md\nartifact_dir: ${subdir}/artifacts\n`)
    writeFileSync(join(subdir, 'prompt.md'), '# prompt'); writeFileSync(join(subdir, 'voice.md'), '# voice')
    expect(loadProfile(join(subdir, 'profile.yaml')).system_prompt_voice).toBe(join(subdir, 'voice.md'))
  })

  it('defaults hooks.timeout_ms to 5000', () => {
    const yaml = `
name: test
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
system_prompt: ${tmp}/prompt.md
artifact_dir: ${tmp}/artifacts
`
    writeFileSync(join(tmp, 'timeout-profile.yaml'), yaml)
    const profile = loadProfile(join(tmp, 'timeout-profile.yaml'))
    expect(profile.hooks.timeout_ms).toBe(5000)
  })

  it('parses context_window when present', () => {
    const yaml = `
name: test
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
system_prompt: ${tmp}/prompt.md
artifact_dir: ${tmp}/artifacts
context_window:
  max_tokens: 50000
`
    writeFileSync(join(tmp, 'cw-profile.yaml'), yaml)
    const profile = loadProfile(join(tmp, 'cw-profile.yaml'))
    expect(profile.context_window?.max_tokens).toBe(50000)
  })

  it('context_window is undefined when not present', () => {
    const profile = loadProfile(join(tmp, 'profile.yaml'))
    expect(profile.context_window).toBeUndefined()
  })
})
