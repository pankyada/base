import { describe, expect, it } from 'vitest'
import { effectFor, isGatedEffect } from '../src/tools/effects.js'
import { ProfileSchema } from '../src/profiles/schema.js'

describe('web tool effects and ACL defaults', () => {
  it('treats fetch and search as outbound gated effects', () => {
    expect(effectFor('WebFetch')).toBe('outbound')
    expect(effectFor('WebSearch')).toBe('outbound')
    expect(isGatedEffect(effectFor('WebFetch'))).toBe(true)
    expect(isGatedEffect(effectFor('WebSearch'))).toBe(true)
  })

  it('defaults both built-ins to prompt in a profile without a mode', () => {
    const profile = ProfileSchema.parse({
      name: 'web',
      model: { base_url: 'https://example.com', api_key_env: 'MODEL_KEY', id: 'model' },
      system_prompt: '/tmp/prompt',
      artifact_dir: '/tmp/artifacts',
    })
    expect(profile.tools.builtin.WebFetch).toBe('prompt')
    expect(profile.tools.builtin.WebSearch).toBe('prompt')
  })
})
