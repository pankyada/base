import { describe, expect, it } from 'vitest'
import { ProfileSchema } from '../src/profiles/schema.js'
import { ensureContextState, type Session } from '../src/session/types.js'

describe('context schema', () => {
  it('initialises context for a legacy session without a context field', () => {
    const session = {
      id: 'legacy01',
      user: 'user',
      profile: 'test',
      project: 'inbox',
      created_at: new Date().toISOString(),
      messages: [],
      tool_calls: [],
      usage: { input: 0, output: 0, cost_usd: 0 },
      session_memory: {},
      todos: [],
    } as Session

    const context = ensureContextState(session)
    expect(context.calib.ratio).toBe(1)
    expect(session.context).toBe(context)
  })

  it('maps the deprecated context_window block into context', () => {
    const profile = ProfileSchema.parse({
      name: 'x',
      model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'model' },
      system_prompt: '/tmp/prompt',
      artifact_dir: '/tmp/art',
      context_window: { max_tokens: 50000, model_id: 'x' },
    })

    expect(profile.context.max_tokens).toBe(50000)
    expect(profile.context.digest_model_id).toBe('x')
  })

  it('defaults project files on and supports the profile kill switch', () => {
    const defaults = ProfileSchema.parse({
      name: 'x',
      model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'model' },
      system_prompt: '/tmp/prompt',
      artifact_dir: '/tmp/art',
    })
    const disabled = ProfileSchema.parse({
      name: 'x',
      model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'model' },
      system_prompt: '/tmp/prompt',
      artifact_dir: '/tmp/art',
      context: { project_files: false },
    })

    expect(defaults.context.project_files).toBe(true)
    expect(disabled.context.project_files).toBe(false)
  })

  it('rejects a high water mark that is not above low water', () => {
    expect(() => ProfileSchema.parse({
      name: 'x',
      model: { base_url: 'https://example.com', api_key_env: 'KEY', id: 'model' },
      system_prompt: '/tmp/prompt',
      artifact_dir: '/tmp/art',
      context: { high_water: 0.4, low_water: 0.4 },
    })).toThrow()
  })
})
