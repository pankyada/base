import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProfileSchema, MODE_DEFAULTS } from '../src/profiles/schema.js'
import { applyModeDefaults, validateMode } from '../src/profiles/loader.js'

const BASE: any = {
  name: 'test',
  model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'gpt-4o' },
  system_prompt: './prompt.md',
  artifact_dir: '/tmp/test',
}

describe('ProfileSchema – mode field', () => {
  it('mode is optional, defaults to undefined', () => {
    const p = ProfileSchema.parse(BASE)
    expect(p.mode).toBeUndefined()
  })

  it('accepts valid mode values', () => {
    for (const mode of ['developer', 'analyst', 'assistant', 'production']) {
      const p = ProfileSchema.parse({ ...BASE, mode })
      expect(p.mode).toBe(mode)
    }
  })

  it('rejects invalid mode values', () => {
    expect(() => ProfileSchema.parse({ ...BASE, mode: 'superuser' })).toThrow()
  })

  it('MODE_DEFAULTS covers all four modes', () => {
    expect(Object.keys(MODE_DEFAULTS)).toEqual(
      expect.arrayContaining(['developer', 'analyst', 'assistant', 'production'])
    )
  })
})

describe('applyModeDefaults', () => {
  it('returns profile unchanged when no mode set', () => {
    const profile = ProfileSchema.parse(BASE)
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin).toEqual(profile.tools.builtin)
  })

  it('developer mode: all tools are allow', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'developer' })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.Bash).toBe('allow')
    expect(result.tools.builtin.Write).toBe('allow')
    expect(result.tools.builtin.Edit).toBe('allow')
    expect(result.tools.builtin.Delegate).toBe('allow')
    expect(result.tools.builtin.ExecuteCode).toBe('allow')
    expect(result.tools.builtin.WebFetch).toBe('allow')
    expect(result.tools.builtin.WebSearch).toBe('allow')
  })

  it('analyst mode: Bash/Write/Edit/Delegate are deny, ExecuteCode/Read/Memory/Todo are allow', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'analyst' })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.Bash).toBe('deny')
    expect(result.tools.builtin.Write).toBe('deny')
    expect(result.tools.builtin.Edit).toBe('deny')
    expect(result.tools.builtin.Delegate).toBe('deny')
    expect(result.tools.builtin.ExecuteCode).toBe('allow')
    expect(result.tools.builtin.Read).toBe('allow')
    expect(result.tools.builtin.MemoryWrite).toBe('allow')
    expect(result.tools.builtin.TodoWrite).toBe('allow')
    expect(result.tools.builtin.WebFetch).toBe('allow')
    expect(result.tools.builtin.WebSearch).toBe('allow')
  })

  it('assistant mode: additionally denies ExecuteCode', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'assistant' })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.ExecuteCode).toBe('deny')
    expect(result.tools.builtin.Bash).toBe('deny')
    expect(result.tools.builtin.MemoryRead).toBe('allow')
    expect(result.tools.builtin.TodoRead).toBe('allow')
    expect(result.tools.builtin.WebFetch).toBe('deny')
    expect(result.tools.builtin.WebSearch).toBe('deny')
  })

  it('production mode: danger tools deny, unlisted tools default to prompt', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'production' })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.Bash).toBe('deny')
    expect(result.tools.builtin.ExecuteCode).toBe('deny')
    expect(result.tools.builtin.Read).toBe('allow')
    expect(result.tools.builtin.MemoryRead).toBe('allow')
    expect(result.tools.builtin.Grep).toBe('prompt')
    expect(result.tools.builtin.Glob).toBe('prompt')
    expect(result.tools.builtin.Stats).toBe('prompt')
    expect(result.tools.builtin.Skill).toBe('prompt')
    expect(result.tools.builtin.WebFetch).toBe('deny')
    expect(result.tools.builtin.WebSearch).toBe('deny')
  })

  it('mode wins over profile explicit setting on conflict', () => {
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'analyst',
      tools: { builtin: { Bash: 'allow' } },
    })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.Bash).toBe('deny')
  })

  it('profile can configure tools the mode leaves open', () => {
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'analyst',
      tools: { builtin: { Grep: 'deny' } },
    })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.Grep).toBe('deny')
  })
})

describe('validateMode', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { warnSpy.mockRestore() })

  it('developer mode always warns about multi-tenant risk', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'developer' })
    validateMode(applyModeDefaults(profile))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('developer mode'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('multi-tenant'))
  })

  it('analyst mode without executor warns', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'analyst' })
    validateMode(applyModeDefaults(profile))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('analyst mode without executor'))
  })

  it('analyst mode with executor does not warn about executor', () => {
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'analyst',
      executor: { default: 'docker', fallback: 'docker', docker_image: 'python:3.12-slim', timeout_ms: 30000, allowed_packages: [] },
    })
    validateMode(applyModeDefaults(profile))
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('analyst mode without executor'))
  })

  it('production mode without contract warns', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'production' })
    validateMode(applyModeDefaults(profile))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('production mode without contract'))
  })

  it('production mode with contract does not warn about contract', () => {
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'production',
      contract: { input: { type: 'object' }, output: { type: 'object' } },
    })
    validateMode(applyModeDefaults(profile))
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('production mode without contract'))
  })

  it('developer + cron trigger throws hard error', () => {
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'developer',
      triggers: { cron: '0 9 * * *', webhook: false },
    })
    expect(() => validateMode(applyModeDefaults(profile))).toThrow(
      /developer mode with cron\/webhook triggers/
    )
  })

  it('developer + webhook trigger throws hard error', () => {
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'developer',
      triggers: { cron: undefined, webhook: true },
    })
    expect(() => validateMode(applyModeDefaults(profile))).toThrow(
      /developer mode with cron\/webhook triggers/
    )
  })

  it('developer + poll trigger throws hard error', () => {
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'developer',
      triggers: { poll: [{ name: 'mail', every: '5m', probe: { tool: 'mail__list' }, cursor_path: 'messages[0].id' }] },
    })
    expect(() => validateMode(applyModeDefaults(profile))).toThrow(
      /developer mode with cron\/webhook triggers/
    )
  })

  it('no mode: no warnings, no errors', () => {
    const profile = ProfileSchema.parse(BASE)
    expect(() => validateMode(applyModeDefaults(profile))).not.toThrow()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
