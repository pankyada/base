import type { BillingMode, CostBasis, ModelAttemptLedger, ModelUsageSink, ProviderUsage } from './types.js'
import { ProviderError } from './errors.js'
export interface UsageAccounting {
  billingMode: BillingMode; costBasis: CostBasis; billedCostUsd: number | null
  usageStatus: ProviderUsage['status']; inputTokens: number; outputTokens: number
  cachedInputTokens: number; reasoningOutputTokens: number
}
export function normalizeUsage(usage?: ProviderUsage): UsageAccounting {
  return { billingMode: 'api', costBasis: 'api_estimate', billedCostUsd: null, usageStatus: usage?.status ?? 'unknown',
    inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
    cachedInputTokens: usage?.cachedInputTokens ?? 0, reasoningOutputTokens: usage?.reasoningOutputTokens ?? 0 }
}
export function codexUsage(usage?: ProviderUsage): UsageAccounting {
  return { ...normalizeUsage(usage), billingMode: 'subscription', costBasis: 'api_equivalent' }
}
export interface AttemptBudgetOptions {
  inputEstimate?: number
  outputCeiling?: number
  estimateUncertain?: boolean
  usageSink?: ModelUsageSink
}

/** Shared across every helper and child in one root run. */
export class SharedAttemptBudget {
  attempts = 0
  constructor(readonly maxAttempts = 64) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1024) throw new Error('invalid model attempt limit')
  }
  beginCall(options: AttemptBudgetOptions = {}): ModelAttemptLedger {
    let finalized = false
    let reserved = 0
    return {
      reserve: () => {
        if (this.attempts >= this.maxAttempts) throw new ProviderError('model attempt limit exceeded', { code: 'max_model_calls' })
        this.attempts++
        reserved++
      },
      finalize: result => {
        if (finalized || reserved === 0) return
        finalized = true
        const reported = result.usage
        const complete = reported?.status === 'complete' && validCount(reported.inputTokens) && validCount(reported.outputTokens)
        const usage: ProviderUsage = complete ? reported : isExplicitRejection(result.error)
          ? { inputTokens: 0, outputTokens: 0, status: 'complete' }
          : options.estimateUncertain
            ? { inputTokens: Math.max(reported?.inputTokens ?? 0, options.inputEstimate ?? 0),
              outputTokens: Math.max(reported?.outputTokens ?? 0, options.outputCeiling ?? 128000), status: 'estimated' }
            : { inputTokens: reported?.inputTokens ?? 0, outputTokens: reported?.outputTokens ?? 0, status: 'unknown' }
        options.usageSink?.record(usage)
      },
    }
  }
}
export function isExplicitRejection(error: unknown): boolean {
  return error instanceof ProviderError && error.options.ambiguous !== true &&
    error.status !== undefined && error.status >= 400 && error.status !== 408
}
function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
