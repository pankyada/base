import type { EffortCapability } from '../types.js'

export type ProviderKind = 'api_key' | 'codex_oauth'
export type BillingMode = 'api' | 'subscription'
export type CostBasis = 'api_estimate' | 'api_equivalent' | 'legacy_estimate'

export interface UsageMetadata {
  billing_mode?: BillingMode | 'mixed'
  cost_basis?: CostBasis | 'mixed'
  billed_cost_usd?: number | null
  usage_status?: ProviderUsage['status']
  api_estimate_usd?: number
  api_equivalent_usd?: number
  cached_input_tokens?: number
  reasoning_output_tokens?: number
  model_attempts?: number
}

export interface ProviderTool { name: string; description?: string; parameters: Record<string, unknown> }
export type ProviderToolCallMessage =
  | { id: string; name: string; arguments: string }
  | { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ProviderMessage { role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'; content: unknown; tool_call_id?: string; tool_calls?: ProviderToolCallMessage[]; providerState?: unknown }
export interface ProviderRequest {
  model: string
  instructions?: string
  messages: ProviderMessage[]
  tools?: ProviderTool[]
  signal?: AbortSignal
  reasoningEffort?: string | null
  effortCapability?: EffortCapability
  stream?: boolean
  maxTokens?: number
  maxCompletionTokens?: number
  temperature?: number
  topP?: number
  responseFormat?: Record<string, unknown>
}
export interface ProviderToolCall { id: string; name: string; arguments: string }
export interface ProviderUsage { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; reasoningOutputTokens?: number; status: 'complete' | 'partial' | 'estimated' | 'unknown' }
export interface ProviderResult { text: string; toolCalls: ProviderToolCall[]; usage?: ProviderUsage; continuation?: unknown; finishReason: 'stop' | 'tool_calls' | 'refusal' | 'incomplete' | 'error' }
export type ProviderEvent = { type: 'text'; delta: string } | { type: 'tool_delta'; id: string; name?: string; argumentsDelta?: string } | { type: 'usage'; usage: ProviderUsage } | { type: 'done'; result: ProviderResult }
export interface ModelAttemptLedger { reserve(): void; finalize(result: { usage?: ProviderUsage; error?: unknown }): void }
export interface ModelUsageSink { record(usage: ProviderUsage): void }
export interface ModelCallContext { rootRunId?: string; sessionId?: string; profileName?: string; purpose?: string; signal?: AbortSignal; deadline?: number; credentialGeneration?: string; attemptLedger?: ModelAttemptLedger; usageSink?: ModelUsageSink; beforeAttempt?: () => void }
export interface ProviderClient { kind: ProviderKind; model: string; accountsUsage?: boolean; generate(request: ProviderRequest, context?: ModelCallContext): Promise<ProviderResult>; stream(request: ProviderRequest, context?: ModelCallContext): AsyncIterable<ProviderEvent>; assertCredentialGeneration?: (expectedGeneration?: string) => Promise<void> }
