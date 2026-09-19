import { createHash } from 'node:crypto'
import type { McpEntry } from '../mcp/client.js'
import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { RunBudget } from '../runs/budget.js'
import type { Skill, ToolDefinition } from '../tools/types.js'
import { createJevProvider } from './jev.js'
import { createMemoryDecisionAdvisor, MemoryCaptureService } from './memory.js'
import { DecisionAdvisoryService } from './advisories.js'
import {
  type DecisionCache,
  type DecisionFeatureMode,
  type DecisionLimits,
  type DecisionProvider,
  type DecisionQuestion,
  type DecisionOutcome,
  type DecisionEvaluateOptions,
  type DecisionPrice,
  type DecisionTelemetryRecord,
} from './types.js'

export interface DecisionCapability {
  name: string
  kind: 'tool' | 'skill'
  description: string
  parameters?: Record<string, unknown>
  mandatory?: boolean
}

export interface CapabilitySelectionInput {
  request: string
  profile: Profile
  skills: readonly Skill[]
  tools: readonly DecisionCapability[]
  mcpEntries: readonly McpEntry[]
  taskKey: string
  signal?: AbortSignal
}

export interface CapabilityDiscovery {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface CapabilitySelection {
  mode: DecisionFeatureMode
  selectedSkillNames: string[]
  selectedToolNames: string[]
  discovery?: CapabilityDiscovery
  fallback: 'disabled' | 'uncertain' | 'provider_error' | 'budget' | 'none'
  revision: string
}

export interface DecisionRuntime {
  selectCapabilities(input: CapabilitySelectionInput): Promise<CapabilitySelection>
}

/** A Jev control result is distinct from an unavailable semantic answer. */
export class DecisionRuntimeControlError extends Error {
  constructor(public readonly reason: 'cancelled' | 'deadline_exceeded' | 'missing_credentials' | 'invalid_configuration' | 'policy_denied') {
    super(`decision runtime control: ${reason}`)
    this.name = 'DecisionRuntimeControlError'
  }
}

export interface DecisionRuntimeOptions {
  mode?: DecisionFeatureMode
  provider?: DecisionProvider
  model?: string
  limits?: Partial<DecisionLimits>
  cache?: Partial<DecisionCache>
  /** Stable rubric/config revision. It participates in cache identity. */
  revision?: string
  /** Candidate applicability threshold. Keep configurable for calibration. */
  applicabilityThreshold?: number
  /** Used for bounded rediscovery after an uncertain selection. */
  discovery?: CapabilityDiscovery
  reservation?: DecisionEvaluateOptions['reservation']
  price?: DecisionPrice
  onTelemetry?: (record: DecisionTelemetryRecord) => void
}

type CacheEntry = { expiresAt: number; selection: CapabilitySelection }

const DEFAULT_LIMITS = {
  max_calls: 8,
  max_request_bytes: 256_000,
  max_response_bytes: 256_000,
  max_input_tokens: 64_000,
  max_output_tokens: 16_000,
  max_wall_ms: 30_000,
} satisfies Omit<DecisionLimits, 'max_cost_usd'>

const DEFAULT_CACHE = { enabled: true, ttl_ms: 300_000, max_entries: 256 } satisfies DecisionCache

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)
}

function bounded(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 4)
}

function outcomeRevision(outcome: Extract<DecisionOutcome, { kind: 'success' }>, fallback: string): string {
  return outcome.response.model ? `${fallback}:${outcome.response.model}` : fallback
}

/**
 * Per-run decision policy. It owns admission, cache identity and fallback;
 * it never executes tools or writes memory. The caller still owns ACLs and
 * keeps the complete permitted executor registry.
 */
export class DecisionRuntimeService implements DecisionRuntime {
  private calls = 0
  private readonly cache = new Map<string, CacheEntry>()
  private readonly mode: DecisionFeatureMode
  private readonly limits: typeof DEFAULT_LIMITS & { max_cost_usd?: number }
  private readonly cacheOptions: DecisionCache
  private readonly threshold: number
  private readonly revision: string
  private spentCost = 0

  constructor(private readonly options: DecisionRuntimeOptions = {}) {
    this.mode = options.mode ?? 'disabled'
    this.limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) }
    this.cacheOptions = { ...DEFAULT_CACHE, ...(options.cache ?? {}) }
    this.threshold = options.applicabilityThreshold ?? 0.5
    this.revision = options.revision ?? 'decision-rubric-v1'
  }

  get provider(): DecisionProvider | undefined { return this.options.provider }

  evaluateOptions(signal?: AbortSignal): DecisionEvaluateOptions {
    return { signal, reservation: this.options.reservation }
  }

  async selectCapabilities(input: CapabilitySelectionInput): Promise<CapabilitySelection> {
    const base = this.emptySelection()
    if (this.mode === 'disabled' || !this.options.provider || !this.options.model) return base
    if (input.signal?.aborted) throw new DecisionRuntimeControlError('cancelled')

    const candidates = input.tools.filter(candidate => !candidate.mandatory)
    const skills = input.skills.map(skill => ({ name: skill.name, kind: 'skill' as const, description: skill.description }))
    const catalog = [...candidates, ...skills]
    const state = {
      request: bounded(input.request, 12_000),
      profile: input.profile.name,
      task: input.taskKey,
      candidates: catalog.map(({ name, kind, description }) => ({ name, kind, description: bounded(description, 1_000) })),
      mcp: input.mcpEntries.map(entry => ({ server: entry.serverName, tools: entry.tools.map(tool => tool.name) })),
    }
    const requestBytes = Buffer.byteLength(JSON.stringify(state), 'utf8')
    if (requestBytes > this.limits.max_request_bytes || this.calls >= this.limits.max_calls) {
      return { ...base, fallback: 'budget' }
    }
    const cacheKey = hash({ revision: this.revision, model: this.options.model, mode: this.mode, state })
    const cached = this.cache.get(cacheKey)
    if (this.cacheOptions.enabled && cached && cached.expiresAt > Date.now()) return { ...cached.selection }
    if (this.cache.size >= this.cacheOptions.max_entries) this.cache.delete(this.cache.keys().next().value as string)

    const estimatedCost = this.options.price
      ? (estimateTokens(requestBytes) * this.options.price.input_usd_per_million_tokens + this.limits.max_output_tokens * this.options.price.output_usd_per_million_tokens) / 1_000_000
      : undefined
    if (this.limits.max_cost_usd !== undefined && this.options.reservation === undefined &&
      (estimatedCost === undefined || this.spentCost + estimatedCost > this.limits.max_cost_usd)) {
      return { ...base, fallback: 'budget' }
    }

    const questions: Record<string, DecisionQuestion> = {}
    for (const candidate of catalog) {
      questions[candidateKey(candidate)] = {
        type: 'noul',
        instructions: `Is the ${candidate.kind} named ${candidate.name} applicable to the current request? Return true only when its capability is needed.`,
      }
    }
    const deadline = Date.now() + this.limits.max_wall_ms
    this.calls += 1
    let outcome: DecisionOutcome
    try {
      outcome = await this.options.provider.evaluate({ state, model: this.options.model, questions }, { signal: input.signal, deadline_at: deadline, reservation: this.options.reservation })
    } catch (error) {
      if (error instanceof DecisionRuntimeControlError) throw error
      if (input.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw new DecisionRuntimeControlError('cancelled')
      return { ...base, fallback: 'provider_error' }
    }
    // A provider may ignore AbortSignal (test doubles and some adapters do),
    // so stale semantic answers never reach context assembly.
    if (input.signal?.aborted) throw new DecisionRuntimeControlError('cancelled')
    if (Date.now() >= deadline) throw new DecisionRuntimeControlError('deadline_exceeded')
    if (outcome.kind !== 'success') {
      if (outcome.kind === 'control') throw new DecisionRuntimeControlError(outcome.reason)
      return { ...base, fallback: outcome.kind === 'unavailable' && ['budget_exhausted', 'request_limit', 'byte_limit', 'token_limit'].includes(outcome.reason) ? 'budget' : 'provider_error' }
    }
    this.spentCost += outcome.cost_usd ?? estimatedCost ?? 0
    if (outcome.response_bytes > this.limits.max_response_bytes) return { ...base, fallback: 'provider_error' }
    const selectedSkillNames: string[] = []
    const selectedToolNames: string[] = []
    for (const candidate of catalog) {
      const answer = outcome.response.answers[candidateKey(candidate)]
      if (!answer || answer.type !== 'noul' || answer.noul < this.threshold) continue
      if (candidate.kind === 'skill') selectedSkillNames.push(candidate.name)
      else selectedToolNames.push(candidate.name)
    }
    const selection: CapabilitySelection = {
      mode: this.mode,
      selectedSkillNames,
      selectedToolNames,
      discovery: this.options.discovery,
      fallback: 'none',
      revision: outcomeRevision(outcome, this.revision),
    }
    if (this.cacheOptions.enabled) this.cache.set(cacheKey, { expiresAt: Date.now() + this.cacheOptions.ttl_ms, selection })
    return { ...selection, selectedSkillNames: [...selection.selectedSkillNames], selectedToolNames: [...selection.selectedToolNames] }
  }

  private emptySelection(): CapabilitySelection {
    return {
      mode: this.mode,
      selectedSkillNames: [],
      selectedToolNames: [],
      discovery: this.options.discovery,
      fallback: this.mode === 'disabled' ? 'disabled' : 'provider_error',
      revision: this.revision,
    }
  }
}

/** Build a child-profile service with the parent provider/budget seam only. */
export function createScopedDecisionRuntime(profile: Profile, parent?: DecisionRuntime): DecisionRuntime | undefined {
  const config = profile.decision_layer
  const mode = config?.features.capability_selection ?? 'disabled'
  const anyFeature = config ? Object.values(config.features).some(featureMode => featureMode !== 'disabled') : false
  if (!config || !anyFeature || !config.enabled || !config.model) return undefined
  const shared = parent instanceof DecisionRuntimeService ? parent : undefined
  return new DecisionRuntimeService({
    mode,
    model: config.model,
    provider: createJevProvider(config),
    revision: config.config_revision,
    limits: config.limits,
    cache: config.cache,
    price: config.price,
    applicabilityThreshold: config.applicability_threshold,
    discovery: { name: 'CapabilityDiscovery', description: 'List permitted capabilities and request fresh semantic selection for omitted tools.', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
    // The provider and cache are child-profile scoped. Only the parent's
    // reservation callback is shared so child calls remain inside the root
    // autonomy budget.
    reservation: shared?.evaluateOptions().reservation,
  })
}

/** Profile-bound runtime factory for server/TUI entry points. */
export interface DecisionRuntimeFactoryOptions {
  reservation?: DecisionEvaluateOptions['reservation']
  onTelemetry?: (record: DecisionTelemetryRecord) => void
}

export function createProfileDecisionRuntime(profile: Profile, options: DecisionRuntimeFactoryOptions = {}): DecisionRuntime | undefined {
  const config = profile.decision_layer
  const mode = config?.features.capability_selection ?? 'disabled'
  const anyFeature = config ? Object.values(config.features).some(featureMode => featureMode !== 'disabled') : false
  if (!config || !anyFeature || !config.enabled || !config.model) return undefined
  return new DecisionRuntimeService({
    mode,
    model: config.model,
    provider: createJevProvider(config, { onTelemetry: options.onTelemetry }),
    revision: config.config_revision,
    limits: config.limits,
    cache: config.cache,
    price: config.price,
    applicabilityThreshold: config.applicability_threshold,
    reservation: options.reservation,
    discovery: { name: 'CapabilityDiscovery', description: 'List permitted capabilities and request fresh semantic selection for omitted tools.', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
  })
}

/** Account every Jev attempt in the same session usage ledger as model calls. */
export function applyDecisionTelemetry(session: Session, record: DecisionTelemetryRecord): void {
  session.usage.input += record.input_tokens ?? 0
  session.usage.output += record.output_tokens ?? 0
  if (record.cost_usd !== undefined) {
    session.usage.cost_usd += record.cost_usd
    session.usage.api_estimate_usd = (session.usage.api_estimate_usd ?? 0) + record.cost_usd
    const nextBasis = record.cost_basis === 'mixed' ? 'mixed' : 'api_estimate'
    session.usage.cost_basis = session.usage.cost_basis === undefined || session.usage.cost_basis === nextBasis
      ? nextBasis
      : 'mixed'
    session.usage.billing_mode = session.usage.billing_mode ?? 'api'
  }
  if (!record.cached) session.usage.model_attempts = (session.usage.model_attempts ?? 0) + 1
  const nextStatus = record.cost_basis === 'estimated'
    ? 'estimated'
    : record.cost_basis === 'mixed'
      ? 'partial'
      : record.outcome === 'success' ? 'complete' : 'partial'
  const rank = { complete: 0, partial: 1, estimated: 2, unknown: 3 } as const
  if (session.usage.usage_status === undefined || rank[nextStatus] > rank[session.usage.usage_status]) session.usage.usage_status = nextStatus
}

/** Reserve Jev spend inside the same in-flight RunBudget as the main model. */
export function createDecisionReservation(budget?: RunBudget): DecisionEvaluateOptions['reservation'] {
  if (!budget) return undefined
  return estimate => {
    if (estimate.cost_usd === undefined) return { ok: false as const, reason: 'unknown_cost' as const }
    try {
      const allocation = budget.allocate(estimate.cost_usd)
      return {
        ok: true as const,
        reservation: {
          settle: settlement => {
            allocation.observeCost(settlement.cost_usd ?? estimate.cost_usd ?? 0)
            allocation.release()
          },
          release: () => allocation.release(),
        },
      }
    } catch {
      return { ok: false as const, reason: 'budget_exhausted' as const }
    }
  }
}

export function createProfileMemoryCapture(profile: Profile, runtime: DecisionRuntime | undefined, signal?: AbortSignal, feature: 'memory_capture' | 'memory_recall' | 'memory_retention' = 'memory_capture'): MemoryCaptureService | undefined {
  const config = profile.decision_layer
  const mode = config?.features[feature]
  if (!config || (mode !== 'shadow' && mode !== 'enforce') || !(runtime instanceof DecisionRuntimeService) || !runtime.provider || !config.model) return undefined
  return new MemoryCaptureService(createMemoryDecisionAdvisor({
    provider: runtime.provider,
    model: config.model,
    signal,
    threshold: config.applicability_threshold,
    evaluateOptions: runtime.evaluateOptions(signal),
  }), feature === 'memory_recall'
    ? { recallMode: mode }
    : feature === 'memory_capture'
      ? { captureMode: mode }
      : { retentionMode: mode })
}

export function createProfileAdvisories(profile: Profile, runtime: DecisionRuntime | undefined, signal?: AbortSignal): DecisionAdvisoryService | undefined {
  const config = profile.decision_layer
  if (!config || !(runtime instanceof DecisionRuntimeService) || !runtime.provider || !config.model) return undefined
  const resultMode = config.features.result_verification
  const failureMode = config.features.failure_guidance
  if (resultMode === 'disabled' && failureMode === 'disabled') return undefined
  return new DecisionAdvisoryService({
    provider: runtime.provider,
    model: config.model,
    result_mode: resultMode,
    failure_mode: failureMode,
    threshold: config.applicability_threshold,
    evaluate_options: runtime.evaluateOptions(signal),
  })
}

function candidateKey(candidate: Pick<DecisionCapability, 'kind' | 'name'>): string {
  return `${candidate.kind}:${candidate.name}`
}

export function toolCapabilities(tools: readonly ToolDefinition[]): DecisionCapability[] {
  return tools.map(tool => ({ name: tool.name, kind: 'tool', description: tool.description, parameters: tool.parameters }))
}
