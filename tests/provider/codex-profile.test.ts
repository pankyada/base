import { describe, expect, it } from 'vitest'
import { ProfileSchema } from '../../src/profiles/schema.js'

const base = { name: 'personal', system_prompt: 'help', artifact_dir: '/tmp/artifacts' }
const codex = { auth: 'codex_oauth', id: 'gpt-5.4-mini' }
describe('explicit Codex profile configuration', () => {
  it('preserves legacy API configuration and normalizes omitted auth', () => {
    const model = { id: 'local-model', base_url: 'http://localhost:9000/v1', api_key_env: 'LOCAL_KEY' }
    expect(ProfileSchema.parse({ ...base, model }).model).toMatchObject({ ...model, auth: 'api_key' })
  })
  it('accepts OAuth without API fields and applies bounded defaults', () => {
    expect(ProfileSchema.parse({ ...base, model: codex }).model).toMatchObject({
      ...codex, codex: { max_model_calls_per_run: 64, request_timeout_ms: 120000 },
    })
  })
  it('accepts canonical effort and matching deprecated alias without network lookup', () => {
    expect(ProfileSchema.parse({ ...base, model: { ...codex, reasoning_effort: 'high', codex: { reasoning_effort: 'high' } } }).model).toMatchObject({ reasoning_effort: 'high', codex: { reasoning_effort: 'high' } })
  })
  it('rejects conflicting canonical and deprecated effort aliases', () => {
    expect(ProfileSchema.safeParse({ ...base, model: { ...codex, reasoning_effort: 'high', codex: { reasoning_effort: 'low' } } }).success).toBe(false)
  })
  it('does not reject a live-catalog root model or invent its effort support', () => {
    const parsed = ProfileSchema.parse({ ...base, model: { ...codex, id: 'future-codex-model', reasoning_effort: 'high' } })
    expect(parsed.model.id).toBe('future-codex-model')
  })
  it.each(['api_key_env', 'base_url'])('rejects contradictory OAuth %s', field => {
    expect(ProfileSchema.safeParse({ ...base, model: { ...codex, [field]: 'https://example.test' } }).success).toBe(false)
  })
  it.each([
    { model: { ...codex, fallback_id: 'claude-unsupported' } },
    { models: { roles: { cheap: 'claude-unsupported' } } },
    { safety: { classifier_model_id: 'claude-unsupported' } },
    { context: { digest_model_id: 'claude-unsupported' } },
    { context_window: { model_id: 'claude-unsupported' } },
    { improvement: { model_id: 'claude-unsupported' } },
  ])('rejects incompatible helper or fallback configuration %j', override => {
    expect(ProfileSchema.safeParse({ ...base, model: codex, ...override }).success).toBe(false)
  })
  it.each([0, 1025, Infinity])('rejects unbounded model attempt cap %s', max => {
    expect(ProfileSchema.safeParse({ ...base, model: { ...codex, codex: { max_model_calls_per_run: max } } }).success).toBe(false)
  })
})
