import type { ProviderTool } from '../types.js'
export interface CodexModelCapability { id: string; efforts: readonly string[]; contextWindow: number; maxOutputTokens: number; images: boolean; structuredOutput: boolean; sourceRevision: string; capabilitySource: string; sourceDerivedAt: string; evidence: 'source' | 'fixture' | 'live' }
export const CODEX_MODELS: readonly CodexModelCapability[] = [
  { id: 'gpt-5.4-mini', efforts: ['none', 'low', 'medium', 'high', 'xhigh'], contextWindow: 400_000, maxOutputTokens: 128_000, images: true, structuredOutput: false, sourceRevision: 'e2894562f8ba943d72172d10b727c24d5f650c16', capabilitySource: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini', sourceDerivedAt: '2026-09-06', evidence: 'source' },
]
function codexFallbackCapability(model: string): CodexModelCapability {
  return {
    id: model,
    efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    images: true,
    structuredOutput: false,
    sourceRevision: 'dynamic',
    capabilitySource: 'subscription model discovery',
    sourceDerivedAt: new Date().toISOString().slice(0, 10),
    evidence: 'live',
  }
}

function isLikelyCodexModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized.startsWith('gpt-') || /^o[1-4](?:\.|$|\d)/.test(normalized) || normalized === 'o4-mini' || normalized === 'o3'
}

export function codexCapability(model: string): CodexModelCapability | undefined {
  const catalog = CODEX_MODELS.find(item => item.id === model)
  if (catalog) return catalog
  if (!isLikelyCodexModel(model)) return undefined
  return codexFallbackCapability(model)
}
export function assertCodexModel(model: string): CodexModelCapability {
  const capability = codexCapability(model)
  if (!capability) throw new Error(`Codex model unavailable until validated: ${model}`)
  return capability
}
export function codexTool(tool: ProviderTool): Record<string, unknown> { return { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters } }
