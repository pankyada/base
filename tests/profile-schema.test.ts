import { describe, expect, it } from 'vitest'
import { ProfileSchema } from '../src/profiles/schema.js'

describe('safety profile block', () => {
  it('keeps profiles without safety backward compatible', () => {
    const profile = ProfileSchema.parse({
      name: 'x', model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'model' },
      system_prompt: '/tmp/prompt', artifact_dir: '/tmp/art',
    })
    expect(profile.safety).toMatchObject({ enabled: true, timeout_ms: 3000, cache_ttl_hours: 168 })
  })

  it('parses configured safety controls', () => {
    const profile = ProfileSchema.parse({
      name: 'x', model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'model' },
      system_prompt: '/tmp/prompt', artifact_dir: '/tmp/art',
      safety: { enabled: false, timeout_ms: 900, cache_ttl_hours: 2, classifier_model_id: 'cheap' },
    })
    expect(profile.safety).toEqual({ enabled: false, timeout_ms: 900, cache_ttl_hours: 2, classifier_model_id: 'cheap', gate_untrusted_actions: false, gate_writes: false })
  })

  it('accepts optional use-case metadata without requiring it', () => {
    const profile = ProfileSchema.parse({
      name: 'x', model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'model' },
      system_prompt: '/tmp/prompt', artifact_dir: '/tmp/art',
      use_case: { label: 'Coding', blurb: 'Write and refactor code', rank: 1 },
    })
    expect(profile.use_case).toEqual({ label: 'Coding', blurb: 'Write and refactor code', rank: 1 })
    expect(ProfileSchema.parse({ name: 'y', model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'model' }, system_prompt: '/tmp/prompt', artifact_dir: '/tmp/art' }).use_case).toBeUndefined()
  })

  it('rejects wildcard provenance overrides', () => {
    expect(() => ProfileSchema.parse({
      name: 'bad-provenance',
      model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'm' },
      system_prompt: '/tmp/prompt', artifact_dir: '/tmp/art',
      tools: { provenance: { '*': 'trusted' } },
    })).toThrow(/wildcard provenance/i)
  })
})
