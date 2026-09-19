import { z } from 'zod'

export const DecisionFeatureModeSchema = z.enum(['disabled', 'shadow', 'enforce'])
export type DecisionFeatureMode = z.infer<typeof DecisionFeatureModeSchema>

export const DecisionFeatureSchema = z.enum([
  'capability_selection',
  'memory_capture',
  'memory_recall',
  'memory_retention',
  'workflow_routing',
  'compaction',
  'result_verification',
  'failure_guidance',
])
export type DecisionFeature = z.infer<typeof DecisionFeatureSchema>

export const DecisionPriceSchema = z.object({
  input_usd_per_million_tokens: z.number().finite().nonnegative(),
  output_usd_per_million_tokens: z.number().finite().nonnegative(),
}).strict()

export const DecisionLimitsSchema = z.object({
  max_calls: z.number().int().positive().max(1024).default(8),
  max_request_bytes: z.number().int().positive().max(4_000_000).default(256_000),
  max_response_bytes: z.number().int().positive().max(4_000_000).default(256_000),
  max_input_tokens: z.number().int().positive().max(1_000_000).default(64_000),
  max_output_tokens: z.number().int().positive().max(1_000_000).default(16_000),
  max_wall_ms: z.number().int().positive().max(600_000).default(30_000),
  max_cost_usd: z.number().finite().nonnegative().optional(),
}).strict()

export const DecisionRetrySchema = z.object({
  max_attempts: z.number().int().min(1).max(3).default(2),
  base_delay_ms: z.number().int().min(0).max(5_000).default(50),
  max_delay_ms: z.number().int().min(0).max(30_000).default(1_000),
}).strict().superRefine((value, ctx) => {
  if (value.max_delay_ms < value.base_delay_ms) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['max_delay_ms'], message: 'max_delay_ms must be at least base_delay_ms' })
  }
})

export const DecisionCacheSchema = z.object({
  enabled: z.boolean().default(true),
  ttl_ms: z.number().int().positive().max(86_400_000).default(300_000),
  max_entries: z.number().int().positive().max(10_000).default(256),
}).strict()

const EnvNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'api_key_env must be an environment variable name')

export const DecisionLayerSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.literal('jev').default('jev'),
  endpoint: z.url().refine(value => {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname))
  }, 'endpoint must use HTTPS except for loopback test endpoints').default('https://api.typesafe.ai/v1/systemone'),
  model: z.string().trim().min(1).max(128).optional(),
  config_revision: z.string().trim().min(1).max(128).default('jev-v1'),
  api_key_env: EnvNameSchema.optional(),
  allow_remote_state: z.boolean().default(false),
  applicability_threshold: z.number().finite().min(0).max(1).default(0.5),
  features: z.object({
    capability_selection: DecisionFeatureModeSchema.optional(),
    memory_capture: DecisionFeatureModeSchema.optional(),
    memory_recall: DecisionFeatureModeSchema.optional(),
    memory_retention: DecisionFeatureModeSchema.optional(),
    workflow_routing: DecisionFeatureModeSchema.optional(),
    compaction: DecisionFeatureModeSchema.optional(),
    result_verification: DecisionFeatureModeSchema.optional(),
    failure_guidance: DecisionFeatureModeSchema.optional(),
  }).strict().default({}),
  limits: DecisionLimitsSchema.prefault({}),
  price: DecisionPriceSchema.optional(),
  retry: DecisionRetrySchema.prefault({}),
  cache: DecisionCacheSchema.prefault({}),
}).strict().superRefine((value, ctx) => {
  const activeFeature = Object.values(value.features).some(mode => mode !== 'disabled')
  if ((value.enabled || activeFeature) && !value.allow_remote_state) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['allow_remote_state'], message: 'decision layer requires allow_remote_state: true when enabled' })
  }
  if (value.enabled && !value.model) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['model'], message: 'enabled decision layer requires a pinned model' })
  }
  if (value.enabled && !value.api_key_env) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['api_key_env'], message: 'enabled decision layer requires api_key_env' })
  }
})

export type DecisionLayerConfig = z.infer<typeof DecisionLayerSchema>
export type DecisionPrice = z.infer<typeof DecisionPriceSchema>
export type DecisionLimits = z.infer<typeof DecisionLimitsSchema>
export type DecisionRetry = z.infer<typeof DecisionRetrySchema>
export type DecisionCache = z.infer<typeof DecisionCacheSchema>

export const DEFAULT_DECISION_FEATURES: Readonly<Record<DecisionFeature, DecisionFeatureMode>> = {
  capability_selection: 'disabled',
  memory_capture: 'disabled',
  memory_recall: 'disabled',
  memory_retention: 'disabled',
  workflow_routing: 'disabled',
  compaction: 'disabled',
  result_verification: 'disabled',
  failure_guidance: 'disabled',
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type NoulQuestion = {
  type: 'noul'
  instructions: string | Record<string, unknown> | unknown[]
  criteria?: { true?: string; false?: string }
}

export type ChoiceQuestion = {
  type: 'choice'
  instructions: string | Record<string, unknown> | unknown[]
  criteria: Record<string, string | null>
}

export type ScoreQuestion = {
  type: 'score'
  instructions: string | Record<string, unknown> | unknown[]
  criteria: string[]
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion

export type DecisionRequest = {
  state: JsonValue
  model: string
  questions: Record<string, DecisionQuestion>
}

export type NoulAnswer = { type: 'noul'; noul: number }
export type ChoiceAnswer = { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
export type ScoreAnswer = { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number }
export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer

export type DecisionUsage = {
  input_tokens: number
  output_tokens: number
}

export type DecisionResponse = {
  model: string
  answers: Record<string, DecisionAnswer>
  usage: DecisionUsage
}

export type DecisionCacheScope = {
  user: string
  profile: string
  project?: string
  session?: string
  run?: string
  stage?: string
}

export type DecisionReservationEstimate = {
  request_bytes: number
  response_bytes: number
  input_tokens: number
  output_tokens: number
  cost_usd?: number
}

export type DecisionSettlement = {
  request_bytes: number
  response_bytes: number
  usage?: DecisionUsage
  cost_usd?: number
  billed: boolean
}

export type DecisionReservation = {
  settle: (settlement: DecisionSettlement) => void | Promise<void>
  release?: () => void | Promise<void>
}

export type DecisionReservationResult =
  | { ok: true; reservation: DecisionReservation }
  | { ok: false; reason: 'budget_exhausted' | 'unknown_cost' | 'request_limit' | 'byte_limit' | 'token_limit' }

export type DecisionEvaluateOptions = {
  signal?: AbortSignal
  deadline_at?: number
  cache_scope?: DecisionCacheScope
  allowed_state_keys?: readonly string[]
  reservation?: (estimate: DecisionReservationEstimate) => Promise<DecisionReservationResult> | DecisionReservationResult
}

export type DecisionSuccess = {
  kind: 'success'
  response: DecisionResponse
  cached: boolean
  request_bytes: number
  response_bytes: number
  /** Camel-case aliases keep the runtime boundary ergonomic; snake-case fields are wire/telemetry names. */
  requestBytes: number
  responseBytes: number
  duration_ms: number
  durationMs: number
  cost_usd?: number
  costUsd?: number
}

export type DecisionUnavailableReason =
  | 'budget_exhausted'
  | 'unknown_cost'
  | 'request_limit'
  | 'byte_limit'
  | 'token_limit'
  | 'timeout'
  | 'http_error'
  | 'rate_limited'
  | 'overloaded'
  | 'malformed_response'
  | 'network_error'
  | 'cache_miss'

export type DecisionUnavailable = {
  kind: 'unavailable'
  reason: DecisionUnavailableReason
  retryable: boolean
  status?: number
}

export type DecisionControlReason = 'cancelled' | 'deadline_exceeded' | 'missing_credentials' | 'invalid_configuration' | 'policy_denied'

export type DecisionControl = {
  kind: 'control'
  reason: DecisionControlReason
}

export type DecisionOutcome = DecisionSuccess | DecisionUnavailable | DecisionControl

export type DecisionTelemetryRecord = {
  kind: 'decision'
  model: string
  outcome: DecisionOutcome['kind']
  reason?: string
  request_bytes: number
  response_bytes: number
  input_tokens?: number
  output_tokens?: number
  cost_usd?: number
  /** Aggregate basis across all attempts in this evaluate call. */
  cost_basis?: 'actual' | 'estimated' | 'mixed'
  duration_ms: number
  cached: boolean
}

export type DecisionProvider = {
  evaluate: (request: DecisionRequest, options?: DecisionEvaluateOptions) => Promise<DecisionOutcome>
}
