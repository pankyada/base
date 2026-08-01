import { describe, expect, it } from 'vitest'
import { ProfileSchema, resolveRole } from '../src/profiles/schema.js'

const base = {
  name: 'test', model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'base-model' },
  system_prompt: '/tmp/prompt', artifact_dir: '/tmp/artifacts', tools: {}, hooks: {}, improvement: {},
}

describe('workflow profile schema', () => {
  it('preserves old profile shape and applies workflow defaults', () => {
    expect(ProfileSchema.parse(base).workflow).toBeUndefined()
    const profile = ProfileSchema.parse({ ...base, workflow: { enabled: true } })
    expect(profile.workflow?.routing.policy).toBe('static')
    expect(profile.workflow?.budget.max_stage_retries).toBe(2)
  })

  it('resolves role fallback and validates exploration bounds', () => {
    const profile = ProfileSchema.parse({ ...base, models: { roles: { cheap: 'cheap-model' } } })
    expect(resolveRole(profile, 'cheap')).toBe('cheap-model')
    expect(resolveRole(profile, 'critic')).toBe('base-model')
    expect(() => ProfileSchema.parse({ ...base, workflow: { routing: { explore_rate: 0.51 } } })).toThrow()
  })
})
