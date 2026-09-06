import type { ProviderTool } from '../types.js'
import type { EffortCapability } from '../../types.js'
import { unknownEffortCapability } from '../../models/effort.js'
export interface CodexModelCapability { id: string; effort: EffortCapability; contextWindow: number; maxOutputTokens: number; images: boolean; structuredOutput: boolean; sourceRevision: string; capabilitySource: string; sourceDerivedAt: string; evidence: 'source' | 'fixture' | 'live' }
export const CODEX_MODELS: readonly CodexModelCapability[] = [
  { id: 'gpt-5.4-mini', effort: unknownEffortCapability('2026-09-06T00:00:00.000Z', 'documented'), contextWindow: 400_000, maxOutputTokens: 128_000, images: true, structuredOutput: false, sourceRevision: 'e2894562f8ba943d72172d10b727c24d5f650c16', capabilitySource: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini', sourceDerivedAt: '2026-09-06', evidence: 'source' },
]

export function codexCapability(model: string): CodexModelCapability | undefined {
  return CODEX_MODELS.find(item => item.id === model)
}
export function assertCodexModel(model: string): CodexModelCapability {
  const capability = codexCapability(model)
  if (!capability) throw new Error(`Codex model unavailable until validated: ${model}`)
  return capability
}
export function codexTool(tool: ProviderTool): Record<string, unknown> { return { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters } }
