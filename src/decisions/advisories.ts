import type {
  DecisionAnswer,
  DecisionEvaluateOptions,
  DecisionFeatureMode,
  DecisionOutcome,
  DecisionProvider,
  DecisionQuestion,
  JsonValue,
} from './types.js'

export type ResultAdvisoryLabel = 'sufficient' | 'needs-discovery' | 'needs-verification' | 'insufficient'
export type FailureAdvisoryLabel = 'retry' | 'rediscover' | 'escalate' | 'stop'

export type ObservedResult = {
  tool_call_id: string
  tool_name: string
  subgoal: string
  executor_result: string
  ok: boolean
  effect: 'read' | 'write' | 'outbound' | 'destructive' | 'unknown'
  tainted?: boolean
  signal?: AbortSignal
}

export type FailureKind = 'tool_error' | 'timeout' | 'network' | 'validation' | 'unknown' | 'denied' | 'cancelled' | 'parked' | 'approval_waiting' | 'stale' | 'provider_control' | 'budget_exhausted'

export type ObservedFailure = {
  tool_call_id: string
  tool_name: string
  error: string
  failure_kind: FailureKind
  effect: ObservedResult['effect']
  tainted?: boolean
  signal?: AbortSignal
}

export type AppliedAdvisory = {
  kind: 'advisory'
  feature: 'result_verification' | 'failure_guidance'
  label: ResultAdvisoryLabel | FailureAdvisoryLabel
  source: 'jev' | 'deterministic' | 'uncertain'
  mode: Exclude<DecisionFeatureMode, 'disabled'>
  applied: boolean
  tool_call_id: string
  confidence?: number
  tainted?: boolean
}

export type IgnoredAdvisory = {
  kind: 'ignored'
  reason: 'disabled' | 'not_failure'
  feature: 'result_verification' | 'failure_guidance'
  tool_call_id: string
}

export type AdvisoryUnavailable = {
  kind: 'unavailable'
  feature: 'result_verification' | 'failure_guidance'
  tool_call_id: string
  reason: Exclude<Extract<DecisionOutcome, { kind: 'unavailable' }>['reason'], 'cache_miss'>
  mode: Exclude<DecisionFeatureMode, 'disabled'>
}

export type AdvisoryControl = {
  kind: 'control'
  feature: 'result_verification' | 'failure_guidance'
  tool_call_id: string
  reason: Extract<DecisionOutcome, { kind: 'control' }>['reason']
}

export type AdvisoryOutcome = AppliedAdvisory | IgnoredAdvisory | AdvisoryUnavailable | AdvisoryControl

export type DecisionAdvisoryOptions = {
  provider?: DecisionProvider
  model?: string
  result_mode?: DecisionFeatureMode
  failure_mode?: DecisionFeatureMode
  threshold?: number
  evaluate_options?: Omit<DecisionEvaluateOptions, 'signal'>
}

const RESULT_CRITERIA: Record<ResultAdvisoryLabel, string> = {
  sufficient: 'The observed executor output directly answers the current subgoal with enough evidence.',
  'needs-discovery': 'The output indicates that another permitted capability or source is needed.',
  'needs-verification': 'The output may be relevant but requires an additional permitted verification step.',
  insufficient: 'The output does not answer the current subgoal.',
}

const FAILURE_CRITERIA: Record<FailureAdvisoryLabel, string> = {
  retry: 'A bounded retry may be useful for this observed failure; the caller must enforce all retry and effect gates.',
  rediscover: 'The failure suggests discovering another already-permitted capability.',
  escalate: 'The failure should be surfaced for user or operator intervention.',
  stop: 'Do not retry this failed action; preserve the original error and stop this path.',
}

function choiceQuestion(instructions: string, criteria: Record<string, string>): DecisionQuestion {
  return { type: 'choice', instructions, criteria }
}

function choice(outcome: Extract<DecisionOutcome, { kind: 'success' }>, id: string): { label: string; confidence: number } | undefined {
  const answer: DecisionAnswer | undefined = outcome.response.answers[id]
  if (!answer || answer.type !== 'choice') return undefined
  return { label: answer.choice, confidence: answer.confidence }
}

function fixedKeys(extra?: readonly string[]): string[] {
  return [...new Set(['request', 'subgoal', 'tool_call_id', 'tool_name', 'executor_result', 'ok', 'effect', 'tainted', 'error', 'failure_kind', ...extra ?? []])]
}

function stateForResult(input: ObservedResult): JsonValue {
  return { request: input.subgoal, subgoal: input.subgoal, tool_call_id: input.tool_call_id, tool_name: input.tool_name, executor_result: input.executor_result, ok: input.ok, effect: input.effect, tainted: input.tainted ?? false }
}

function stateForFailure(input: ObservedFailure): JsonValue {
  return { request: `Classify the observed failure from ${input.tool_name}.`, tool_call_id: input.tool_call_id, tool_name: input.tool_name, error: input.error, failure_kind: input.failure_kind, effect: input.effect, tainted: input.tainted ?? false }
}

function control(feature: AdvisoryControl['feature'], toolCallId: string, outcome: Extract<DecisionOutcome, { kind: 'control' }>): AdvisoryControl {
  return { kind: 'control', feature, tool_call_id: toolCallId, reason: outcome.reason }
}

export class DecisionAdvisoryService {
  private readonly threshold: number

  constructor(private readonly options: DecisionAdvisoryOptions = {}) {
    this.threshold = options.threshold ?? 0.5
  }

  async assessResult(input: ObservedResult): Promise<AdvisoryOutcome> {
    const mode = this.options.result_mode ?? 'disabled'
    if (mode === 'disabled') return { kind: 'ignored', reason: 'disabled', feature: 'result_verification', tool_call_id: input.tool_call_id }
    if (input.signal?.aborted) return { kind: 'control', feature: 'result_verification', tool_call_id: input.tool_call_id, reason: 'cancelled' }
    if (!this.options.provider || !this.options.model) return { kind: 'unavailable', feature: 'result_verification', tool_call_id: input.tool_call_id, reason: 'network_error', mode }
    const questions: Record<string, DecisionQuestion> = { assessment: choiceQuestion('Assess only this observed executor output against the current subgoal.', RESULT_CRITERIA) }
    const outcome = await this.options.provider.evaluate({ model: this.options.model, state: stateForResult(input), questions }, { ...this.options.evaluate_options, signal: input.signal, allowed_state_keys: fixedKeys(this.options.evaluate_options?.allowed_state_keys) })
    return this.mapSemantic('result_verification', input.tool_call_id, input.tainted, mode, outcome, 'assessment', RESULT_CRITERIA, 'needs-verification')
  }

  async classifyFailure(input: ObservedFailure): Promise<AdvisoryOutcome> {
    const mode = this.options.failure_mode ?? 'disabled'
    if (mode === 'disabled') return { kind: 'ignored', reason: 'disabled', feature: 'failure_guidance', tool_call_id: input.tool_call_id }
    const blocked: FailureKind[] = ['denied', 'cancelled', 'parked', 'approval_waiting', 'stale', 'provider_control', 'budget_exhausted']
    if (blocked.includes(input.failure_kind)) {
      return { kind: 'advisory', feature: 'failure_guidance', label: 'stop', source: 'deterministic', mode, applied: mode === 'enforce', tool_call_id: input.tool_call_id, tainted: input.tainted }
    }
    if (input.signal?.aborted) return { kind: 'control', feature: 'failure_guidance', tool_call_id: input.tool_call_id, reason: 'cancelled' }
    if (!this.options.provider || !this.options.model) return { kind: 'unavailable', feature: 'failure_guidance', tool_call_id: input.tool_call_id, reason: 'network_error', mode }
    const questions: Record<string, DecisionQuestion> = { guidance: choiceQuestion('Classify only this already observed failure. Do not authorize or replay an effect.', FAILURE_CRITERIA) }
    const outcome = await this.options.provider.evaluate({ model: this.options.model, state: stateForFailure(input), questions }, { ...this.options.evaluate_options, signal: input.signal, allowed_state_keys: fixedKeys(this.options.evaluate_options?.allowed_state_keys) })
    return this.mapSemantic('failure_guidance', input.tool_call_id, input.tainted, mode, outcome, 'guidance', FAILURE_CRITERIA, 'stop')
  }

  private mapSemantic(feature: AppliedAdvisory['feature'], toolCallId: string, tainted: boolean | undefined, mode: Exclude<DecisionFeatureMode, 'disabled'>, outcome: DecisionOutcome, questionId: string, criteria: Record<string, string>, uncertainLabel: ResultAdvisoryLabel | FailureAdvisoryLabel): AdvisoryOutcome {
    if (outcome.kind === 'control') return control(feature, toolCallId, outcome)
    if (outcome.kind === 'unavailable') return { kind: 'unavailable', feature, tool_call_id: toolCallId, reason: outcome.reason === 'cache_miss' ? 'network_error' : outcome.reason, mode }
    const selected = choice(outcome, questionId)
    if (!selected || !(selected.label in criteria)) return { kind: 'unavailable', feature, tool_call_id: toolCallId, reason: 'malformed_response', mode }
    const uncertain = selected.confidence < this.threshold
    return { kind: 'advisory', feature, label: uncertain ? uncertainLabel : selected.label as ResultAdvisoryLabel | FailureAdvisoryLabel, source: uncertain ? 'uncertain' : 'jev', mode, applied: mode === 'enforce', tool_call_id: toolCallId, confidence: selected.confidence, tainted }
  }
}

export const advisoryCriteria = { result: RESULT_CRITERIA, failure: FAILURE_CRITERIA }
