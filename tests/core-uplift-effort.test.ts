import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProfileSchema } from '../src/profiles/schema.js'
import { discoverProfileModels } from '../src/models/discovery.js'
import { listModels, validateModelEffort } from '../src/models/registry.js'
import { serializeCodexRequest } from '../src/provider/codex/request.js'
import { writeCodexCredential } from '../src/provider/auth/store.js'
import type { Profile } from '../src/profiles/schema.js'

const profile = (overrides: Record<string, unknown> = {}): Profile => ({
  name: 'fixture',
  model: { auth: 'codex_oauth', id: 'gpt-5.4-mini', codex: {} },
  system_prompt: '/tmp/prompt.md',
  working_dir: '/tmp',
  artifact_dir: '/tmp/artifacts',
  ...overrides,
} as Profile)

describe('Core model effort contract', () => {
  it('parses provider-native effort metadata and keeps scope opaque', async () => {
    const original = globalThis.fetch
    const homeDir = mkdtempSync(join(tmpdir(), 'core-effort-'))
    await writeCodexCredential({ kind: 'codex_oauth', access_token: 'fixture', refresh_token: 'fixture', account_id: 'account-fixture', expires_at: Date.now() + 60_000 }, homeDir)
    globalThis.fetch = (async () => new Response(JSON.stringify({
      models: [{
        slug: 'gpt-future', visibility: 'list',
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [
          { effort: 'low', description: 'small' },
          { effort: 'medium', description: 'balanced' },
          { effort: 'low', description: 'duplicate' },
        ],
      }],
    }))) as typeof fetch
    try {
      const models = await discoverProfileModels(profile(), { homeDir })
      expect(models[0]?.effort).toMatchObject({
        status: 'supported', provider_default: 'medium', source: 'live', stale: false,
      })
      expect(models[0]?.effort?.options.map(option => option.value)).toEqual(['low', 'medium'])
      expect(models[0]?.effort?.scope?.transport).toBe('codex_subscription')
      expect(models[0]?.effort?.scope?.endpoint).toContain('/models')
      expect(models[0]?.effort?.scope?.provider_scope).toMatch(/^[a-f0-9]{16}$/)
    } finally { globalThis.fetch = original; rmSync(homeDir, { recursive: true, force: true }) }
  })

  it('allows unknown model default operation without invented effort support', () => {
    const request = serializeCodexRequest({
      model: 'future-model', instructions: 'hello', messages: [{ role: 'user', content: 'hi' }], stream: true,
    })
    expect(request.reasoning).toBeUndefined()
    expect(() => serializeCodexRequest({
      model: 'future-model', instructions: 'hello', reasoningEffort: 'high',
      messages: [{ role: 'user', content: 'hi' }], stream: true,
    })).toThrow(/unknown|unsupported/i)
  })

  it('serializes selected Codex effort and omits provider default', () => {
    const base = { model: 'gpt-5.4-mini', instructions: 'hello', messages: [{ role: 'user' as const, content: 'hi' }], stream: true as const }
    expect(serializeCodexRequest({ ...base, reasoningEffort: 'low' }).reasoning).toEqual({ effort: 'low' })
    expect(serializeCodexRequest(base).reasoning).toBeUndefined()
    expect(() => serializeCodexRequest({ ...base, reasoningEffort: 'ultra' }, {
      status: 'supported', options: [{ value: 'ultra', label: 'ultra', selectable: true }], source: 'live', checked_at: new Date().toISOString(), stale: false,
    })).toThrow(/unavailable/i)
    expect(() => serializeCodexRequest({ ...base, reasoningEffort: 'low' }, {
      status: 'supported', options: [{ value: 'low', label: 'low', selectable: true }], source: 'live', checked_at: new Date().toISOString(), stale: true,
    })).toThrow(/unavailable/i)
  })

  it('validates effort syntax offline while accepting unknown provider model IDs', () => {
    expect(ProfileSchema.parse({
      ...profile(), model: { auth: 'codex_oauth', id: 'future-model', reasoning_effort: 'provider-custom', codex: {} },
    }).model.reasoning_effort).toBe('provider-custom')
    expect(() => ProfileSchema.parse({
      ...profile(), model: { auth: 'codex_oauth', id: 'future-model', reasoning_effort: 'bad\u0000value', codex: {} },
    })).toThrow()
    expect(() => ProfileSchema.parse({
      ...profile(), model: { auth: 'codex_oauth', id: 'future-model', reasoning_effort: 'low', codex: { reasoning_effort: 'high' } },
    })).toThrow(/conflicting/i)
  })

  it('validates model and effort atomically, including provider-managed options', () => {
    const model = listModels(profile()).find(item => item.id === 'gpt-5.4-mini')!
    expect(validateModelEffort(model, null)).toEqual({ ok: true, effort: null })
    expect(validateModelEffort(model, 'not-advertised')).toMatchObject({ ok: false })
    const ultra = { ...model, effort: { ...model.effort!, options: [...model.effort!.options, { value: 'ultra', label: 'ultra', selectable: false, unavailable_reason: 'provider-managed' }] } }
    expect(validateModelEffort(ultra, 'ultra')).toMatchObject({ ok: false, reason: 'provider-managed' })
    const unknown = listModels(profile({ model: { auth: 'codex_oauth', id: 'future-model', codex: {} } })).find(item => item.id === 'future-model')!
    expect(validateModelEffort(unknown, null)).toEqual({ ok: true, effort: null })
    expect(validateModelEffort(unknown, 'high')).toMatchObject({ ok: false })
  })
})
