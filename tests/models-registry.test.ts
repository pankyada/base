import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { FALLBACK_PRICES, MODEL_REGISTRY, estimateCost, listModels, requiresReasoningEffortNone } from '../src/models/registry.js'

function profile(baseUrl: string, id = 'gpt-5.4-mini'): any {
  return {
    name: 'test',
    model: { base_url: baseUrl, api_key_env: 'KEY', id },
    system_prompt: '/tmp/prompt.md',
    working_dir: '/tmp',
    artifact_dir: '/tmp/artifacts',
    tools: { builtin: {}, custom: {}, mcp_servers: [] },
    hooks: { pre_tool: [], post_tool: [], on_stop: [], timeout_ms: 5000 },
    improvement: { enabled: true, mine_skills_every_n_sessions: 10 },
    agents: [],
    max_depth: 2,
  }
}

describe('model registry', () => {
  it('keeps cost estimation parity for known and fallback models', () => {
    expect(estimateCost('claude-sonnet-4-6', 1000, 500)).toBe(0.0105)
    expect(estimateCost('claude-opus-4-8', 1000, 500)).toBe(0.0525)
    expect(estimateCost('gpt-4o', 1000, 500)).toBe(0.0075)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(estimateCost('unknown-model', 1000, 500)).toBe(
      1000 * FALLBACK_PRICES.input + 500 * FALLBACK_PRICES.output,
    )
    expect(warn).toHaveBeenCalledWith('[cost] unknown model "unknown-model" — using fallback pricing')
    warn.mockRestore()
  })

  it('marks cross-provider models unavailable', () => {
    const anthropic = listModels(profile('https://api.anthropic.com/v1', 'claude-sonnet-5'))
    const anthropicSonnet = anthropic.find((model) => model.id === 'claude-sonnet-5')
    const anthropicGpt = anthropic.find((model) => model.id === 'gpt-5.4-mini')
    expect(anthropicSonnet?.available).toBe(true)
    expect(anthropicGpt?.available).toBe(false)
    expect(anthropicGpt?.reason).toContain('OpenAI')

    const openai = listModels(profile('https://api.openai.com/v1', 'gpt-5.4-mini'))
    expect(openai.find((model) => model.id === 'gpt-5.4-mini')?.available).toBe(true)
    expect(openai.find((model) => model.id === 'claude-opus-5')?.available).toBe(false)
    expect(openai.length).toBeGreaterThanOrEqual(10)
  })

  it('keeps an unknown active profile model visible with fallback warning metadata', () => {
    const models = listModels(profile('https://example.test/v1', 'future-model-2099'))
    const unknown = models.find((model) => model.id === 'future-model-2099')
    expect(unknown).toMatchObject({
      available: true,
      input_price: FALLBACK_PRICES.input,
      output_price: FALLBACK_PRICES.output,
    })
    expect(unknown?.reason).toContain('fallback pricing')
  })

  it('flags the reasoning-family models that 400 on tools without reasoning_effort: none', () => {
    for (const id of ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.4-mini', 'o3', 'o4-mini']) {
      expect(requiresReasoningEffortNone(id), id).toBe(true)
    }
    for (const id of ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-5', 'claude-opus-4-8']) {
      expect(requiresReasoningEffortNone(id), id).toBe(false)
    }
  })

  it('resolves every model id in profiles', () => {
    const ids = new Set(MODEL_REGISTRY.map((model) => model.id))
    const profileDir = join(process.cwd(), 'profiles')
    for (const file of readdirSync(profileDir).filter((name) => name.endsWith('.yaml'))) {
      const content = readFileSync(join(profileDir, file), 'utf8')
      const modelIds = [...content.matchAll(/^\s+(?:id|fallback_id):\s*(\S+)/gm)].map((match) => match[1])
      for (const id of modelIds) {
        expect(ids.has(id), `${file} references missing model ${id}`).toBe(true)
      }
    }
  })
})
