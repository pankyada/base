import { createHash } from 'node:crypto'
import type {
  DecisionAnswer,
  DecisionCacheScope,
  DecisionEvaluateOptions,
  DecisionLayerConfig,
  DecisionOutcome,
  DecisionQuestion,
  DecisionRequest,
  DecisionReservation,
  DecisionReservationEstimate,
  DecisionResponse,
  DecisionSuccess,
  DecisionTelemetryRecord,
  DecisionUsage,
  JsonValue,
} from './types.js'
import type { DecisionProvider } from './types.js'

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

type JevProviderOptions = {
  fetch?: FetchLike
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  onTelemetry?: (record: DecisionTelemetryRecord) => void
}

type CacheEntry = { response: DecisionResponse; created_at: number; response_bytes: number }

const SECRET_KEYS = new Set([
  'apikey', 'api_key', 'authorization', 'cookie', 'credential', 'credentials', 'password',
  'privatekey', 'refresh_token', 'secret', 'set-cookie', 'token', 'access_token', 'providerstate',
  'environment', 'env', 'tool_input', 'tool_output',
])
const SAFE_TOOL_KEYS = new Set(['id', 'type', 'label', 'description', 'tags', 'mandatory', 'schema_summary', 'content_size'])
const SECRET_PATTERNS = [
  /\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
]

const DEFAULT_SLEEP = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('The operation was aborted', 'AbortError'))
    return
  }
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(new DOMException('The operation was aborted', 'AbortError'))
  }, { once: true })
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

// Provider tokenization is model-specific and JSON byte count is only an
// estimate. Use a deliberately conservative bound for admission/cost checks;
// the usage reported by Jev remains authoritative for settlement.
function conservativeTokenEstimate(bytes: number): number {
  // A byte-level upper bound is intentionally conservative. The adapter does
  // not claim to know Jev's tokenizer; response usage remains authoritative.
  return bytes
}

function redactString(value: string, configuredSecret?: string): string {
  const redacted = SECRET_PATTERNS.reduce((result, pattern) => result.replace(pattern, '[REDACTED]'), value)
  return configuredSecret && configuredSecret.length > 0 ? redacted.split(configuredSecret).join('[REDACTED]') : redacted
}

function safeKey(key: string): boolean {
  return !SECRET_KEYS.has(key.toLowerCase().replace(/[-_]/g, '')) && !SECRET_KEYS.has(key.toLowerCase())
}

function sanitizeValue(value: unknown, path: readonly string[], allowedTopLevelKeys?: readonly string[], configuredSecret?: string): JsonValue {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return redactString(value, configuredSecret)
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, path, undefined, configuredSecret))
  if (!isRecord(value)) return null
  const result: Record<string, JsonValue> = {}
  for (const [key, child] of Object.entries(value)) {
    if (path.length === 0 && allowedTopLevelKeys && !allowedTopLevelKeys.includes(key)) continue
    if (!safeKey(key)) continue
    const normalized = key.toLowerCase()
    if ((normalized === 'tool' || normalized === 'tools') && isRecord(child)) {
      const filtered: Record<string, unknown> = {}
      for (const [toolKey, toolValue] of Object.entries(child)) {
        if (SAFE_TOOL_KEYS.has(toolKey)) filtered[toolKey] = toolValue
      }
      result[key] = sanitizeValue(filtered, [...path, key], undefined, configuredSecret)
      continue
    }
    if ((normalized === 'tool' || normalized === 'tools') && Array.isArray(child)) {
      result[key] = child.map(tool => {
        if (!isRecord(tool)) return null
        const filtered = Object.fromEntries(Object.entries(tool).filter(([toolKey]) => SAFE_TOOL_KEYS.has(toolKey)))
        return sanitizeValue(filtered, [...path, key], undefined, configuredSecret)
      })
      continue
    }
    result[key] = sanitizeValue(child, [...path, key], undefined, configuredSecret)
  }
  return result
}

/** Redacts known credentials and provider state before any size truncation. */
export function sanitizeDecisionState(state: JsonValue, allowedTopLevelKeys?: readonly string[], configuredSecret?: string): JsonValue {
  return sanitizeValue(state, [], allowedTopLevelKeys, configuredSecret)
}

function truncateValue(value: JsonValue, maxBytes: number): JsonValue {
  const encoded = JSON.stringify(value)
  if (byteLength(encoded) <= maxBytes) return value
  if (maxBytes < 24) return '[TRUNCATED]'
  if (typeof value === 'string') {
    let low = 0
    let high = value.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (byteLength(JSON.stringify(value.slice(0, mid))) <= maxBytes - 2) low = mid
      else high = mid - 1
    }
    return value.slice(0, low)
  }
  if (Array.isArray(value)) {
    const items: JsonValue[] = []
    for (const item of value) {
      const candidate = [...items, item]
      if (byteLength(JSON.stringify(candidate)) > maxBytes) break
      items.push(item)
    }
    return items.length ? items : '[TRUNCATED]'
  }
  if (isRecord(value)) {
    const entries: Record<string, JsonValue> = {}
    for (const [key, child] of Object.entries(value)) {
      const candidate = { ...entries, [key]: child }
      if (byteLength(JSON.stringify(candidate)) > maxBytes) break
      entries[key] = child
    }
    if (Object.keys(entries).length) return entries
  }
  return '[TRUNCATED]'
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function finiteProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function validDistribution(probabilities: unknown, expectedKeys: readonly string[]): probabilities is Record<string, number> {
  if (!isRecord(probabilities)) return false
  const keys = Object.keys(probabilities).sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== [...expectedKeys].sort()[index])) return false
  const values = Object.values(probabilities)
  if (!values.every(finiteProbability)) return false
  const sum = values.reduce((total, value) => total + value, 0)
  return Math.abs(sum - 1) <= 1e-6
}

function validateAnswer(question: DecisionQuestion, raw: unknown): DecisionAnswer | undefined {
  if (!isRecord(raw) || raw.type !== question.type) return undefined
  if (question.type === 'noul') {
    if ('confidence' in raw || !finiteProbability(raw.noul)) return undefined
    return { type: 'noul', noul: raw.noul }
  }
  if (question.type === 'choice') {
    const expected = Object.keys(question.criteria)
    if (typeof raw.choice !== 'string' || !expected.includes(raw.choice) || !validDistribution(raw.probabilities, expected) || !finiteProbability(raw.confidence)) return undefined
    return { type: 'choice', choice: raw.choice, probabilities: raw.probabilities, confidence: raw.confidence }
  }
  const levels = question.criteria.map((_, index) => String(index))
  if (!validDistribution(raw.probabilities, levels) || !finiteProbability(raw.confidence) || !isRecord(raw.legend)) return undefined
  const legend = raw.legend
  const legendKeys = Object.keys(legend).sort()
  if (legendKeys.length !== levels.length || legendKeys.some((key, index) => key !== [...levels].sort()[index] || legend[key] !== question.criteria[Number(key)])) return undefined
  if (typeof raw.score !== 'number' || !Number.isFinite(raw.score) || raw.score < 0 || raw.score > levels.length - 1) return undefined
  return { type: 'score', score: raw.score, legend: legend as Record<string, string>, probabilities: raw.probabilities, confidence: raw.confidence }
}

function validateResponse(raw: unknown, request: DecisionRequest): DecisionResponse | undefined {
  if (!isRecord(raw) || raw.model !== request.model || !isRecord(raw.answers) || !isRecord(raw.usage)) return undefined
  const usage = raw.usage
  if (!Number.isInteger(usage.input_tokens) || (usage.input_tokens as number) < 0 || !Number.isInteger(usage.output_tokens) || (usage.output_tokens as number) < 0) return undefined
  const answers: Record<string, DecisionAnswer> = {}
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = validateAnswer(question, raw.answers[id])
    if (!answer) return undefined
    answers[id] = answer
  }
  return { model: request.model, answers, usage: { input_tokens: usage.input_tokens as number, output_tokens: usage.output_tokens as number } }
}

function validateRequest(request: DecisionRequest): boolean {
  if (!request.model || !isRecord(request.questions) || Object.keys(request.questions).length === 0) return false
  for (const question of Object.values(request.questions)) {
    if (!question || typeof question.instructions !== 'string' && !isRecord(question.instructions) && !Array.isArray(question.instructions)) return false
    if (question.type === 'choice' && (!isRecord(question.criteria) || Object.keys(question.criteria).length === 0)) return false
    if (question.type === 'score' && (!Array.isArray(question.criteria) || question.criteria.length < 2)) return false
  }
  return true
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<{ text?: string; tooLarge: boolean }> {
  if (!response.body) {
    const text = await response.text()
    return byteLength(text) > maxBytes ? { tooLarge: true } : { text, tooLarge: false }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        await reader.cancel('response exceeds configured byte limit')
        return { tooLarge: true }
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength }
  return { text: new TextDecoder().decode(merged), tooLarge: false }
}

function cacheKey(request: DecisionRequest, scope: DecisionCacheScope, allowedTopLevelKeys: readonly string[] | undefined, configRevision: string, configuredSecret: string): string {
  return digest({ scope, config_revision: configRevision, model: request.model, questions: request.questions, state: sanitizeDecisionState(request.state, allowedTopLevelKeys, configuredSecret) })
}

export class JevProvider implements DecisionProvider {
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  private readonly cache = new Map<string, CacheEntry>()
  private calls = 0
  /** Settled plus in-flight local cost reservations, shared by all features. */
  private costSpent = 0
  private costReserved = 0

  constructor(private readonly config: DecisionLayerConfig, private readonly options: JevProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? DEFAULT_SLEEP
  }

  async evaluate(request: DecisionRequest, evaluateOptions: DecisionEvaluateOptions = {}): Promise<DecisionOutcome> {
    const started = this.now()
    // Emit one logical decision record. Retry costs are aggregated; token
    // fields contain only usage reported by Jev, never tokenizer estimates.
    let aggregateInputTokens = 0
    let aggregateOutputTokens = 0
    let aggregateCost = 0
    let aggregateHadCost = false
    let aggregateHadActualCost = false
    let aggregateHadEstimatedCost = false
    const emit = (outcome: DecisionOutcome, requestBytes = 0, responseBytes = 0, usage?: DecisionUsage, cost?: number, cached = false) => {
      const reportedCost = aggregateHadCost ? aggregateCost : cost
      this.options.onTelemetry?.({
        kind: 'decision', model: request.model, outcome: outcome.kind, reason: outcome.kind === 'success' ? undefined : outcome.reason,
        request_bytes: requestBytes, response_bytes: responseBytes,
        input_tokens: aggregateInputTokens > 0 ? aggregateInputTokens : usage?.input_tokens,
        output_tokens: aggregateOutputTokens > 0 ? aggregateOutputTokens : usage?.output_tokens,
        cost_usd: reportedCost,
        cost_basis: aggregateHadCost
          ? aggregateHadActualCost && aggregateHadEstimatedCost ? 'mixed' : aggregateHadEstimatedCost ? 'estimated' : 'actual'
          : cost === undefined ? undefined : 'actual',
        duration_ms: Math.max(0, this.now() - started), cached,
      })
    }
    if (evaluateOptions.signal?.aborted) {
      const result: DecisionOutcome = { kind: 'control', reason: 'cancelled' }; emit(result); return result
    }
    if (!this.config.enabled || !this.config.allow_remote_state) {
      const result: DecisionOutcome = { kind: 'control', reason: 'policy_denied' }; emit(result); return result
    }
    if (!this.config.model || request.model !== this.config.model || !this.config.api_key_env || !validateRequest(request)) {
      const result: DecisionOutcome = { kind: 'control', reason: 'invalid_configuration' }; emit(result); return result
    }
    const apiKey = process.env[this.config.api_key_env]
    if (!apiKey) {
      const result: DecisionOutcome = { kind: 'control', reason: 'missing_credentials' }; emit(result); return result
    }
    const scope = evaluateOptions.cache_scope
    const cacheEnabled = this.config.cache.enabled && scope?.user && scope.profile
    const key = cacheEnabled ? cacheKey(request, scope, evaluateOptions.allowed_state_keys, this.config.config_revision, apiKey) : undefined
    if (key) {
      const hit = this.cache.get(key)
      if (hit && this.now() - hit.created_at <= this.config.cache.ttl_ms) {
        const duration = Math.max(0, this.now() - started)
        const result: DecisionSuccess = { kind: 'success', response: hit.response, cached: true, request_bytes: 0, response_bytes: hit.response_bytes, requestBytes: 0, responseBytes: hit.response_bytes, duration_ms: duration, durationMs: duration, cost_usd: 0, costUsd: 0 }
        // Cache hits have no new provider usage or spend. Keep the cached
        // response available to the caller without double-counting telemetry.
        emit(result, 0, hit.response_bytes, undefined, 0, true)
        return result
      }
      if (hit) this.cache.delete(key)
    }
    if (this.calls >= this.config.limits.max_calls) {
      const result: DecisionOutcome = { kind: 'unavailable', reason: 'request_limit', retryable: false }; emit(result); return result
    }
    const safeState = sanitizeDecisionState(request.state, evaluateOptions.allowed_state_keys, apiKey)
    let bodyState = safeState
    let body = JSON.stringify({ model: request.model, state: bodyState, questions: request.questions })
    if (byteLength(body) > this.config.limits.max_request_bytes) {
      const envelope = byteLength(JSON.stringify({ model: request.model, state: null, questions: request.questions }))
      bodyState = truncateValue(safeState, Math.max(24, this.config.limits.max_request_bytes - envelope))
      body = JSON.stringify({ model: request.model, state: bodyState, questions: request.questions })
    }
    const requestBytes = byteLength(body)
    if (requestBytes > this.config.limits.max_request_bytes) {
      const result: DecisionOutcome = { kind: 'unavailable', reason: 'byte_limit', retryable: false }; emit(result, requestBytes); return result
    }
    const estimatedInput = conservativeTokenEstimate(requestBytes)
    if (estimatedInput > this.config.limits.max_input_tokens) {
      const result: DecisionOutcome = { kind: 'unavailable', reason: 'token_limit', retryable: false }; emit(result, requestBytes); return result
    }
    if (this.config.limits.max_cost_usd !== undefined && !this.config.price) {
      const result: DecisionOutcome = { kind: 'unavailable', reason: 'unknown_cost', retryable: false }; emit(result, requestBytes); return result
    }
    const estimateCost = this.config.price ? (estimatedInput * this.config.price.input_usd_per_million_tokens + this.config.limits.max_output_tokens * this.config.price.output_usd_per_million_tokens) / 1_000_000 : undefined
    if (estimateCost !== undefined && this.config.limits.max_cost_usd !== undefined && estimateCost > this.config.limits.max_cost_usd) {
      // Admission failed before dispatch; this estimate is not a billed cost.
      const result: DecisionOutcome = { kind: 'unavailable', reason: 'budget_exhausted', retryable: false }; emit(result, requestBytes); return result
    }
    const deadline = Math.min(evaluateOptions.deadline_at ?? Infinity, started + this.config.limits.max_wall_ms)
    const reservations: DecisionReservation[] = []
    const localReservations: number[] = []
    const reserveLocal = (): DecisionOutcome | undefined => {
      if (this.config.limits.max_cost_usd === undefined || estimateCost === undefined) return undefined
      if (this.costSpent + this.costReserved + estimateCost > this.config.limits.max_cost_usd) {
        return { kind: 'unavailable', reason: 'budget_exhausted', retryable: false }
      }
      // This mutation happens before the first await in an attempt, so
      // concurrent evaluations cannot both pass the same local cost gate.
      this.costReserved += estimateCost
      localReservations.push(estimateCost)
      return undefined
    }
    const releaseLocal = (): void => {
      const estimate = localReservations.pop()
      if (estimate !== undefined) this.costReserved = Math.max(0, this.costReserved - estimate)
    }
    const settleLocal = (settlement: { cost_usd?: number; billed: boolean }): void => {
      const estimate = localReservations.shift()
      if (estimate === undefined) return
      this.costReserved = Math.max(0, this.costReserved - estimate)
      // A billed attempt without usage/cost is charged its full reservation.
      // This covers transient responses and transport failures conservatively.
      const charge = settlement.cost_usd ?? (settlement.billed ? estimate : 0)
      this.costSpent += Math.max(0, charge)
    }
    const reserve = async (): Promise<DecisionOutcome | undefined> => {
      const localOutcome = reserveLocal()
      if (localOutcome) return localOutcome
      if (!evaluateOptions.reservation) return undefined
      const reservationEstimate: DecisionReservationEstimate = { request_bytes: requestBytes, response_bytes: this.config.limits.max_response_bytes, input_tokens: estimatedInput, output_tokens: this.config.limits.max_output_tokens, cost_usd: estimateCost }
      let result
      try {
        result = await evaluateOptions.reservation(reservationEstimate)
      } catch {
        releaseLocal()
        return { kind: 'unavailable', reason: 'budget_exhausted', retryable: false }
      }
      if (!result.ok) {
        releaseLocal()
        return { kind: 'unavailable', reason: result.reason === 'unknown_cost' ? 'unknown_cost' : result.reason === 'request_limit' ? 'request_limit' : result.reason === 'byte_limit' ? 'byte_limit' : result.reason === 'token_limit' ? 'token_limit' : 'budget_exhausted', retryable: false }
      }
      reservations.push(result.reservation)
      return undefined
    }
    const settle = async (settlement: { response_bytes: number; usage?: DecisionUsage; cost_usd?: number; billed: boolean }) => {
      const pending = reservations.splice(0, reservations.length)
      aggregateInputTokens += settlement.usage?.input_tokens ?? 0
      aggregateOutputTokens += settlement.usage?.output_tokens ?? 0
      const attemptCost = settlement.cost_usd ?? (settlement.billed ? estimateCost : undefined)
      if (attemptCost !== undefined) {
        aggregateCost += Math.max(0, attemptCost)
        aggregateHadCost = true
        if (settlement.cost_usd === undefined) aggregateHadEstimatedCost = true
        else aggregateHadActualCost = true
      }
      try {
        await Promise.all(pending.map(reservation => reservation.settle({ request_bytes: requestBytes, response_bytes: settlement.response_bytes, usage: settlement.usage, cost_usd: settlement.cost_usd, billed: settlement.billed })))
      } finally {
        settleLocal(settlement)
      }
    }
    const releasePending = async () => {
      const pending = reservations.splice(0, reservations.length)
      await Promise.allSettled(pending.map(reservation => reservation.release?.()))
      while (localReservations.length > 0) releaseLocal()
    }
    const abortController = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; abortController.abort() }, Math.max(0, deadline - this.now()))
    const onAbort = () => abortController.abort()
    evaluateOptions.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      for (let attempt = 0; attempt < this.config.retry.max_attempts; attempt++) {
        if (this.now() >= deadline) {
          const result: DecisionOutcome = { kind: 'control', reason: evaluateOptions.deadline_at !== undefined ? 'deadline_exceeded' : 'deadline_exceeded' }; emit(result, requestBytes); return result
        }
        if (this.calls >= this.config.limits.max_calls) {
          const result: DecisionOutcome = { kind: 'unavailable', reason: 'request_limit', retryable: false }; emit(result, requestBytes); return result
        }
        // Reserve the local attempt slot before awaiting an external budget
        // hook. This keeps max_calls bounded when evaluate() is concurrent.
        this.calls++
        const reservationOutcome = await reserve()
        if (reservationOutcome) { emit(reservationOutcome, requestBytes); return reservationOutcome }
        let response: Response
        try {
          response = await this.fetchImpl(this.config.endpoint, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body,
            signal: abortController.signal,
          })
        } catch (error) {
          await settle({ response_bytes: 0, billed: true })
          if (evaluateOptions.signal?.aborted) { const result: DecisionOutcome = { kind: 'control', reason: 'cancelled' }; emit(result, requestBytes); return result }
          if (timedOut || this.now() >= deadline) { const result: DecisionOutcome = { kind: 'control', reason: 'deadline_exceeded' }; emit(result, requestBytes); return result }
          if (attempt + 1 < this.config.retry.max_attempts) {
            try { await this.sleep(this.retryDelay(attempt), abortController.signal) } catch {
              const result: DecisionOutcome = { kind: 'control', reason: evaluateOptions.signal?.aborted ? 'cancelled' : 'deadline_exceeded' }; emit(result, requestBytes); return result
            }
            continue
          }
          const result: DecisionOutcome = { kind: 'unavailable', reason: 'network_error', retryable: true }; emit(result, requestBytes); return result
        }
        let text: string
        let responseTooLarge = false
        try {
          const boundedResponse = await readBoundedResponse(response, this.config.limits.max_response_bytes)
          responseTooLarge = boundedResponse.tooLarge
          text = boundedResponse.text ?? ''
        } catch {
          await settle({ response_bytes: 0, billed: true })
          if (evaluateOptions.signal?.aborted) { const result: DecisionOutcome = { kind: 'control', reason: 'cancelled' }; emit(result, requestBytes); return result }
          if (timedOut || this.now() >= deadline) { const result: DecisionOutcome = { kind: 'control', reason: 'deadline_exceeded' }; emit(result, requestBytes); return result }
          const result: DecisionOutcome = { kind: 'unavailable', reason: 'network_error', retryable: true }; emit(result, requestBytes); return result
        }
        const responseBytes = responseTooLarge ? this.config.limits.max_response_bytes + 1 : byteLength(text)
        if (evaluateOptions.signal?.aborted) { await settle({ response_bytes: responseBytes, billed: true }); const result: DecisionOutcome = { kind: 'control', reason: 'cancelled' }; emit(result, requestBytes, responseBytes); return result }
        if (timedOut || this.now() >= deadline) { await settle({ response_bytes: responseBytes, billed: true }); const result: DecisionOutcome = { kind: 'control', reason: 'deadline_exceeded' }; emit(result, requestBytes, responseBytes); return result }
        const retryableStatus = response.status === 429 || response.status === 529 || [500, 502, 503, 504].includes(response.status)
        if (!response.ok) {
          await settle({ response_bytes: responseBytes, billed: true })
          if ((response.status === 401 || response.status === 403 || response.status === 422) && !retryableStatus) { const result: DecisionOutcome = { kind: 'control', reason: 'invalid_configuration' }; emit(result, requestBytes, responseBytes); return result }
          if (attempt + 1 < this.config.retry.max_attempts && retryableStatus) {
            try { await this.sleep(this.retryDelay(attempt, response.headers.get('retry-after')), abortController.signal) } catch {
              const result: DecisionOutcome = { kind: 'control', reason: evaluateOptions.signal?.aborted ? 'cancelled' : 'deadline_exceeded' }; emit(result, requestBytes, responseBytes); return result
            }
            continue
          }
          const reason = response.status === 429 ? 'rate_limited' : response.status === 529 ? 'overloaded' : 'http_error'
          const result: DecisionOutcome = { kind: 'unavailable', reason, retryable: retryableStatus, status: response.status }; emit(result, requestBytes, responseBytes); return result
        }
        if (responseBytes > this.config.limits.max_response_bytes) {
          await settle({ response_bytes: responseBytes, billed: true })
          const result: DecisionOutcome = { kind: 'unavailable', reason: 'byte_limit', retryable: false }; emit(result, requestBytes, responseBytes); return result
        }
        let raw: unknown
        try { raw = JSON.parse(text) } catch {
          await settle({ response_bytes: responseBytes, billed: true })
          const result: DecisionOutcome = { kind: 'unavailable', reason: 'malformed_response', retryable: false }; emit(result, requestBytes, responseBytes); return result
        }
        const parsed = validateResponse(raw, request)
        if (!parsed) {
          await settle({ response_bytes: responseBytes, billed: true })
          const result: DecisionOutcome = { kind: 'unavailable', reason: 'malformed_response', retryable: false }; emit(result, requestBytes, responseBytes); return result
        }
        if (evaluateOptions.signal?.aborted) {
          await settle({ response_bytes: responseBytes, usage: parsed.usage, billed: true })
          const result: DecisionOutcome = { kind: 'control', reason: 'cancelled' }; emit(result, requestBytes, responseBytes, parsed.usage); return result
        }
        if (timedOut || this.now() >= deadline) {
          await settle({ response_bytes: responseBytes, usage: parsed.usage, billed: true })
          const result: DecisionOutcome = { kind: 'control', reason: 'deadline_exceeded' }; emit(result, requestBytes, responseBytes, parsed.usage); return result
        }
        if (parsed.usage.input_tokens > this.config.limits.max_input_tokens || parsed.usage.output_tokens > this.config.limits.max_output_tokens) {
          await settle({ response_bytes: responseBytes, usage: parsed.usage, billed: true })
          const result: DecisionOutcome = { kind: 'unavailable', reason: 'token_limit', retryable: false }; emit(result, requestBytes, responseBytes, parsed.usage); return result
        }
        const cost = this.config.price ? (parsed.usage.input_tokens * this.config.price.input_usd_per_million_tokens + parsed.usage.output_tokens * this.config.price.output_usd_per_million_tokens) / 1_000_000 : undefined
        if (cost !== undefined && this.config.limits.max_cost_usd !== undefined && cost > this.config.limits.max_cost_usd) {
          await settle({ response_bytes: responseBytes, usage: parsed.usage, cost_usd: cost, billed: true })
          const result: DecisionOutcome = { kind: 'unavailable', reason: 'budget_exhausted', retryable: false }; emit(result, requestBytes, responseBytes, parsed.usage, cost); return result
        }
        await settle({ response_bytes: responseBytes, usage: parsed.usage, cost_usd: cost, billed: true })
        if (evaluateOptions.signal?.aborted) {
          const result: DecisionOutcome = { kind: 'control', reason: 'cancelled' }; emit(result, requestBytes, responseBytes, parsed.usage, cost); return result
        }
        if (timedOut || this.now() >= deadline) {
          const result: DecisionOutcome = { kind: 'control', reason: 'deadline_exceeded' }; emit(result, requestBytes, responseBytes, parsed.usage, cost); return result
        }
        if (key && this.config.cache.enabled) {
          this.cache.set(key, { response: parsed, created_at: this.now(), response_bytes: responseBytes })
          while (this.cache.size > this.config.cache.max_entries) this.cache.delete(this.cache.keys().next().value as string)
        }
        const duration = Math.max(0, this.now() - started)
        const result: DecisionSuccess = { kind: 'success', response: parsed, cached: false, request_bytes: requestBytes, response_bytes: responseBytes, requestBytes, responseBytes, duration_ms: duration, durationMs: duration, cost_usd: cost, costUsd: cost }
        emit(result, requestBytes, responseBytes, parsed.usage, cost)
        return result
      }
      const result: DecisionOutcome = { kind: 'unavailable', reason: 'http_error', retryable: true }; emit(result, requestBytes); return result
    } finally {
      clearTimeout(timeout)
      evaluateOptions.signal?.removeEventListener('abort', onAbort)
      await releasePending()
    }
  }

  private retryDelay(attempt: number, retryAfter?: string | null): number {
    const parsed = retryAfter ? Number(retryAfter) : NaN
    const requested = Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000 : this.config.retry.base_delay_ms * Math.pow(2, attempt)
    return Math.min(this.config.retry.max_delay_ms, requested)
  }
}

export function createJevProvider(config: DecisionLayerConfig, options?: JevProviderOptions): JevProvider {
  return new JevProvider(config, options)
}

export type { JevProviderOptions }
