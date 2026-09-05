import type { Profile } from '../profiles/schema.js'
import type { ModelInfo } from '../types.js'
import { CODEX_MODELS } from '../provider/codex/models.js'

interface ModelPricing {
  input: number
  output: number
}

interface ModelDefinition extends ModelPricing {
  id: string
  label: string
  provider: string
  base_url: string
  context_window: number
  tags: string[]
}

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'
const OPENAI_BASE_URL = 'https://api.openai.com/v1'

// Prices are USD per token. Provider pages list prices per million tokens;
// values below divide those prices by 1,000,000.
export const MODEL_PRICES: Readonly<Record<string, ModelPricing>> = {
  // source: https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-07-31
  'claude-opus-5': { input: 0.000005, output: 0.000025 },
  // source: https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-07-31
  'claude-fable-5': { input: 0.00001, output: 0.00005 },
  // source: https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-07-31
  'claude-sonnet-5': { input: 0.000002, output: 0.00001 },
  // source: https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-07-31
  'claude-opus-4-8': { input: 0.000015, output: 0.000075 },
  // source: https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-07-31
  'claude-sonnet-4-6': { input: 0.000003, output: 0.000015 },
  // source: https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-07-31
  'claude-haiku-4-5-20251001': { input: 0.0000008, output: 0.000004 },
  // source: https://docs.anthropic.com/en/docs/about-claude/pricing, checked 2026-07-31
  'claude-3-5-sonnet-20241022': { input: 0.000003, output: 0.000015 },
  // source: https://docs.anthropic.com/en/docs/about-claude/pricing, checked 2026-07-31
  'claude-3-haiku-20240307': { input: 0.00000025, output: 0.00000125 },
  // source: https://developers.openai.com/api/docs/pricing, checked 2026-07-31
  'gpt-5.6-sol': { input: 0.000005, output: 0.00003 },
  // source: https://developers.openai.com/api/docs/pricing, checked 2026-07-31
  'gpt-5.6-terra': { input: 0.000002, output: 0.000012 },
  // source: https://developers.openai.com/api/docs/pricing, checked 2026-07-31
  'gpt-5.6-luna': { input: 0.0000002, output: 0.0000012 },
  // source: https://developers.openai.com/api/docs/models/gpt-5.5, checked 2026-07-31
  'gpt-5.5': { input: 0.000005, output: 0.00003 },
  // source: https://developers.openai.com/api/docs/models/gpt-5.5-pro, checked 2026-07-31
  'gpt-5.5-pro': { input: 0.00003, output: 0.00018 },
  // source: https://developers.openai.com/api/docs/models/gpt-5.4, checked 2026-07-31
  'gpt-5.4': { input: 0.0000025, output: 0.000015 },
  // source: https://developers.openai.com/api/docs/models/gpt-5.4-mini, checked 2026-07-31
  'gpt-5.4-mini': { input: 0.00000075, output: 0.0000045 },
  // source: https://developers.openai.com/api/docs/models/gpt-5.4-mini, checked 2026-07-31
  'gpt-5.4-mini-2026-03-17': { input: 0.00000015, output: 0.0000006 },
  // source: https://developers.openai.com/api/docs/pricing, checked 2026-07-31
  'gpt-5.4-nano': { input: 0.0000002, output: 0.00000125 },
  // source: https://developers.openai.com/api/docs/models/gpt-5.4-pro, checked 2026-07-31
  'gpt-5.4-pro': { input: 0.00003, output: 0.00018 },
  // source: https://developers.openai.com/api/docs/models/gpt-4o, checked 2026-07-31
  'gpt-4o': { input: 0.0000025, output: 0.00001 },
  // source: https://developers.openai.com/api/docs/models/gpt-4o-mini, checked 2026-07-31
  'gpt-4o-mini': { input: 0.00000015, output: 0.0000006 },
  // source: https://developers.openai.com/api/docs/models/o3, checked 2026-07-31
  'o3': { input: 0.00001, output: 0.00004 },
  // source: https://developers.openai.com/api/docs/models/o4-mini, checked 2026-07-31
  'o4-mini': { input: 0.0000011, output: 0.0000044 },
}

export const FALLBACK_PRICES: ModelPricing = { input: 0.000003, output: 0.000015 }

const DEFINITIONS: readonly ModelDefinition[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'Anthropic', base_url: ANTHROPIC_BASE_URL, context_window: 1_000_000, tags: ['reasoning', 'agentic'], ...MODEL_PRICES['claude-opus-5'] },
  { id: 'claude-fable-5', label: 'Claude Fable 5', provider: 'Anthropic', base_url: ANTHROPIC_BASE_URL, context_window: 1_000_000, tags: ['frontier', 'reasoning'], ...MODEL_PRICES['claude-fable-5'] },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'Anthropic', base_url: ANTHROPIC_BASE_URL, context_window: 1_000_000, tags: ['balanced', 'agentic'], ...MODEL_PRICES['claude-sonnet-5'] },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'Anthropic', base_url: ANTHROPIC_BASE_URL, context_window: 1_000_000, tags: ['reasoning', 'agentic'], ...MODEL_PRICES['claude-opus-4-8'] },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'Anthropic', base_url: ANTHROPIC_BASE_URL, context_window: 1_000_000, tags: ['balanced'], ...MODEL_PRICES['claude-sonnet-4-6'] },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'Anthropic', base_url: ANTHROPIC_BASE_URL, context_window: 200_000, tags: ['fast'], ...MODEL_PRICES['claude-haiku-4-5-20251001'] },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', provider: 'Anthropic', base_url: ANTHROPIC_BASE_URL, context_window: 200_000, tags: ['balanced', 'legacy'], ...MODEL_PRICES['claude-3-5-sonnet-20241022'] },
  { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku', provider: 'Anthropic', base_url: ANTHROPIC_BASE_URL, context_window: 200_000, tags: ['fast', 'legacy'], ...MODEL_PRICES['claude-3-haiku-20240307'] },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 1_050_000, tags: ['reasoning', 'frontier'], ...MODEL_PRICES['gpt-5.6-sol'] },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 1_050_000, tags: ['balanced', 'agentic'], ...MODEL_PRICES['gpt-5.6-terra'] },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 1_050_000, tags: ['fast', 'cost-efficient'], ...MODEL_PRICES['gpt-5.6-luna'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 1_050_000, tags: ['reasoning', 'frontier'], ...MODEL_PRICES['gpt-5.5'] },
  { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 1_050_000, tags: ['reasoning', 'pro'], ...MODEL_PRICES['gpt-5.5-pro'] },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 1_050_000, tags: ['reasoning', 'agentic'], ...MODEL_PRICES['gpt-5.4'] },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 400_000, tags: ['fast', 'agentic'], ...MODEL_PRICES['gpt-5.4-mini'] },
  { id: 'gpt-5.4-mini-2026-03-17', label: 'GPT-5.4 mini (2026-03-17)', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 400_000, tags: ['fast', 'legacy'], ...MODEL_PRICES['gpt-5.4-mini-2026-03-17'] },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 400_000, tags: ['fast', 'cost-efficient'], ...MODEL_PRICES['gpt-5.4-nano'] },
  { id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 1_050_000, tags: ['reasoning', 'pro'], ...MODEL_PRICES['gpt-5.4-pro'] },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 128_000, tags: ['multimodal', 'legacy'], ...MODEL_PRICES['gpt-4o'] },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 128_000, tags: ['fast', 'legacy'], ...MODEL_PRICES['gpt-4o-mini'] },
  { id: 'o3', label: 'o3', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 200_000, tags: ['reasoning'], ...MODEL_PRICES.o3 },
  { id: 'o4-mini', label: 'o4-mini', provider: 'OpenAI', base_url: OPENAI_BASE_URL, context_window: 200_000, tags: ['reasoning', 'fast'], ...MODEL_PRICES['o4-mini'] },
]

export const MODEL_REGISTRY: readonly ModelInfo[] = DEFINITIONS.map((model) => ({
  id: model.id,
  label: model.label,
  provider: model.provider,
  base_url: model.base_url,
  context_window: model.context_window,
  input_price: model.input,
  output_price: model.output,
  tags: [...model.tags],
  available: true,
}))

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function providerForBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized === ANTHROPIC_BASE_URL) return 'Anthropic'
  if (normalized === OPENAI_BASE_URL) return 'OpenAI'
  return 'custom provider'
}

function unknownModel(profile: Profile): ModelInfo {
  if (profile.model.auth === 'codex_oauth') throw new Error('Unknown Codex models are not available')
  return {
    id: profile.model.id,
    label: profile.model.id,
    provider: providerForBaseUrl(profile.model.base_url),
    base_url: profile.model.base_url,
    context_window: profile.context_window?.max_tokens ?? 0,
    input_price: FALLBACK_PRICES.input,
    output_price: FALLBACK_PRICES.output,
    tags: ['unknown'],
    available: true,
    reason: 'Unknown model; fallback pricing applies',
  }
}

export function listModels(profile: Profile): ModelInfo[] {
  if (profile.model.auth === 'codex_oauth') {
    return CODEX_MODELS.map(model => ({
      id: model.id, label: `${model.id} · Codex subscription`, provider: 'OpenAI Codex', base_url: '',
      context_window: model.contextWindow, input_price: MODEL_PRICES[model.id]?.input ?? FALLBACK_PRICES.input,
      output_price: MODEL_PRICES[model.id]?.output ?? FALLBACK_PRICES.output,
      tags: ['subscription', 'experimental'], available: true,
    }))
  }
  const activeBaseUrl = normalizeBaseUrl(profile.model.base_url)
  const models = MODEL_REGISTRY.map((model) => {
    const available = normalizeBaseUrl(model.base_url) === activeBaseUrl
    return {
      ...model,
      tags: [...model.tags],
      available,
      ...(available ? {} : { reason: `Requires ${model.provider} endpoint ${model.base_url}` }),
    }
  })

  if (!models.some((model) => model.id === profile.model.id)) {
    models.push(unknownModel(profile))
  }
  return models
}

// Reasoning-family models (o-series, GPT-5.x) reject `tools` on
// /v1/chat/completions unless reasoning_effort is explicitly 'none' — the
// API otherwise defaults to a nonzero effort that's incompatible with
// function tools on that endpoint. See agent-loop.ts's create() call.
const REASONING_EFFORT_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5.4', 'gpt-5.5', 'gpt-5.6']

export function requiresReasoningEffortNone(modelId: string): boolean {
  return REASONING_EFFORT_PREFIXES.some(prefix => modelId.startsWith(prefix))
}

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const prices = MODEL_PRICES[model]
  if (!prices) {
    console.warn(`[cost] unknown model "${model}" — using fallback pricing`)
  }
  const { input, output } = prices ?? FALLBACK_PRICES
  return tokensIn * input + tokensOut * output
}
