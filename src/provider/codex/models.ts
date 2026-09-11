import { createHash } from 'node:crypto'
import type { ProviderTool } from '../types.js'
export interface CodexModelCapability { id: string; efforts: readonly string[]; contextWindow: number; maxOutputTokens: number; images: boolean; structuredOutput: boolean; sourceRevision: string; capabilitySource: string; sourceDerivedAt: string; evidence: 'source' | 'fixture' | 'live'; providerDefault?: string }
export const CODEX_MODELS: readonly CodexModelCapability[] = [
  { id: 'gpt-5.4-mini', efforts: ['none', 'low', 'medium', 'high', 'xhigh'], contextWindow: 400_000, maxOutputTokens: 128_000, images: true, structuredOutput: false, sourceRevision: 'e2894562f8ba943d72172d10b727c24d5f650c16', capabilitySource: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini', sourceDerivedAt: '2026-09-06', evidence: 'source', providerDefault: 'medium' },
]
function unknownCodexCapability(model: string): CodexModelCapability {
  return { id: model, efforts: [], contextWindow: 400_000, maxOutputTokens: 128_000, images: false, structuredOutput: false, sourceRevision: 'unknown', capabilitySource: 'provider default', sourceDerivedAt: new Date(0).toISOString(), evidence: 'fixture' }
}
export function codexCapability(model: string): CodexModelCapability | undefined {
  return CODEX_MODELS.find(item => item.id === model) ?? unknownCodexCapability(model)
}
export function assertCodexModel(model: string): CodexModelCapability {
  // Unknown IDs remain usable with provider default; explicit effort requires
  // a discovered/documented capability and is rejected by serialization.
  return codexCapability(model)!
}
/** Opaque account-bound scope used to validate live model catalog metadata. */
export function codexCatalogScope(transport: string, endpoint: string, account: string): string {
  return createHash('sha256').update(`${transport}\u0000${endpoint}\u0000${account}`).digest('hex').slice(0, 16)
}
export function codexTool(tool: ProviderTool): Record<string, unknown> { return { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters } }
