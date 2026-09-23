import { describe, expect, it } from 'vitest'
import { ProfileSchema } from '../src/profiles/schema.js'
import { DecisionLayerSchema } from '../src/decisions/types.js'

const base = {
  name: 'test', model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'base-model' },
  system_prompt: '/tmp/prompt', artifact_dir: '/tmp/artifacts', tools: {}, hooks: {}, improvement: {},
}

describe('workflow.router schema (PT-076, roadmap #31 phase 1)', () => {
  it('is absent by default — router is a no-op unless a profile author opts in', () => {
    const profile = ProfileSchema.parse({ ...base, workflow: { enabled: true } })
    expect(profile.workflow?.router).toBeUndefined()
  })

  it('applies documented defaults when the block is present but empty', () => {
    const profile = ProfileSchema.parse({ ...base, workflow: { enabled: true, router: {} } })
    expect(profile.workflow?.router).toEqual({
      domain_threshold: 0.5,
      ask_threshold: 0.6,
      max_reroutes: 1,
      max_clarifications: 1,
    })
  })

  it('accepts candidates and scale_presets, merging under defaults', () => {
    const profile = ProfileSchema.parse({
      ...base,
      workflow: {
        enabled: true,
        router: {
          candidates: ['coding', 'data', 'writing'],
          scale_presets: {
            trivial: { plan: 0, design: 0, verify: 1, review: 0 },
            large: { plan: 3, design: 2, verify: 2, review: 2 },
          },
        },
      },
    })
    expect(profile.workflow?.router?.candidates).toEqual(['coding', 'data', 'writing'])
    expect(profile.workflow?.router?.domain_threshold).toBe(0.5)
    expect(profile.workflow?.router?.scale_presets?.trivial).toEqual({ plan: 0, design: 0, verify: 1, review: 0 })
    expect(profile.workflow?.router?.scale_presets?.large).toEqual({ plan: 3, design: 2, verify: 2, review: 2 })
  })

  it('rejects an out-of-range domain_threshold', () => {
    expect(() => ProfileSchema.parse({ ...base, workflow: { enabled: true, router: { domain_threshold: 1.5 } } })).toThrow()
  })

  it('rejects an out-of-range ask_threshold', () => {
    expect(() => ProfileSchema.parse({ ...base, workflow: { enabled: true, router: { ask_threshold: -0.1 } } })).toThrow()
  })

  it('rejects a negative max_reroutes / max_clarifications', () => {
    expect(() => ProfileSchema.parse({ ...base, workflow: { enabled: true, router: { max_reroutes: -1 } } })).toThrow()
    expect(() => ProfileSchema.parse({ ...base, workflow: { enabled: true, router: { max_clarifications: -1 } } })).toThrow()
  })

  it('rejects an out-of-range intensity value inside scale_presets', () => {
    expect(() => ProfileSchema.parse({ ...base, workflow: { enabled: true, router: { scale_presets: { medium: { plan: 9 } } } } })).toThrow()
  })

  it('rejects an unknown stage key inside scale_presets', () => {
    expect(() => ProfileSchema.parse({ ...base, workflow: { enabled: true, router: { scale_presets: { small: { biuld: 1 } } } } })).toThrow()
  })

  it('leaves existing workflow behavior (no router key) unchanged', () => {
    const profile = ProfileSchema.parse({ ...base, workflow: { enabled: true } })
    expect(profile.workflow?.routing.policy).toBe('static')
    expect(profile.workflow?.budget.max_stage_retries).toBe(2)
  })
})

describe('decision_layer.features request_routing / edge_checks / claim_check (PT-076)', () => {
  it('are optional and absent by default', () => {
    const layer = DecisionLayerSchema.parse({})
    expect(layer.features).toEqual({})
  })

  it('accept the standard disabled|shadow|enforce modes', () => {
    const layer = DecisionLayerSchema.parse({
      allow_remote_state: true,
      features: { request_routing: 'shadow', edge_checks: 'enforce', claim_check: 'disabled' },
    })
    expect(layer.features.request_routing).toBe('shadow')
    expect(layer.features.edge_checks).toBe('enforce')
    expect(layer.features.claim_check).toBe('disabled')
  })

  it('are covered by the existing allow_remote_state guard — shadow alone without consent is rejected', () => {
    const denied = DecisionLayerSchema.safeParse({ features: { request_routing: 'shadow' } })
    expect(denied.success).toBe(false)
    if (!denied.success) {
      expect(denied.error.issues.some(issue => issue.path.join('.') === 'allow_remote_state')).toBe(true)
    }
  })

  it('accepts request_routing shadow once allow_remote_state is granted', () => {
    const allowed = DecisionLayerSchema.safeParse({ allow_remote_state: true, features: { edge_checks: 'shadow' } })
    expect(allowed.success).toBe(true)
  })

  it('rejects an unrecognized feature key (features remains .strict())', () => {
    expect(() => DecisionLayerSchema.parse({ allow_remote_state: true, features: { request_routing_typo: 'shadow' } })).toThrow()
  })
})
