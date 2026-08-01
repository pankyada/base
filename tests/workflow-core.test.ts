import { describe, expect, it } from 'vitest'
import { ProfileSchema, resolveRole } from '../src/profiles/schema.js'
import { chooseExploration, resolveTier } from '../src/workflow/policy.js'

const base = {
  name: 'test', model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'base-model' },
  system_prompt: '/tmp/prompt', artifact_dir: '/tmp/artifacts', tools: {}, hooks: {}, improvement: {},
}

describe('workflow profile and policy', () => {
  it('keeps workflow optional and resolves role fallback', () => {
    const profile = ProfileSchema.parse(base)
    expect(profile.workflow).toBeUndefined()
    expect(resolveRole(profile, 'cheap')).toBe('base-model')
  })

  it('parses routing defaults and rejects excessive exploration', () => {
    const profile = ProfileSchema.parse({ ...base, models: { roles: { cheap: 'cheap-model' } }, workflow: { enabled: true } })
    expect(profile.workflow?.routing.explore_rate).toBe(0.12)
    expect(resolveRole(profile, 'cheap')).toBe('cheap-model')
    expect(() => ProfileSchema.parse({ ...base, workflow: { routing: { explore_rate: 0.51 } } })).toThrow()
  })

  it('uses static table and blocks unsafe exploration', () => {
    const profile = ProfileSchema.parse({ ...base, models: { roles: { balanced: 'balanced-model' } }, workflow: { routing: { table: { build: 'balanced' } } } })
    expect(resolveTier(profile, 'build')).toEqual({ tier: 'balanced', modelId: 'balanced-model', explore: false })
    expect(chooseExploration(profile, 'balanced', 'irreversible', 1, () => 0)).toEqual({ tier: 'balanced', explore: false })
    expect(chooseExploration(profile, 'balanced', 'easy', 0.2, () => 0)).toEqual({ tier: 'balanced', explore: false })
  })
})
