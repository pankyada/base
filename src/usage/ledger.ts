import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { harnessStatePath } from '../config/state-paths.js'
import type { UsageMetadata } from '../provider/types.js'

export interface UsageDelta extends Partial<UsageMetadata> {
  input: number
  output: number
  cost_usd: number
}

export interface MonthBucket extends UsageDelta {}

export interface UserUsage {
  user: string
  total: UsageDelta
  by_month: Record<string, MonthBucket>
  updated_at: string
}

const metadataKeys: Array<keyof UsageMetadata> = [
  'billing_mode', 'cost_basis', 'billed_cost_usd', 'usage_status',
  'api_estimate_usd', 'api_equivalent_usd', 'cached_input_tokens',
  'reasoning_output_tokens', 'model_attempts',
]

/** Copy only usage metadata from a session into an additive ledger delta. */
export function usageDeltaFromSession(before: UsageDelta, after: UsageDelta): UsageDelta {
  const delta: UsageDelta = {
    input: after.input - before.input,
    output: after.output - before.output,
    cost_usd: after.cost_usd - before.cost_usd,
  }
  for (const key of ['api_estimate_usd', 'api_equivalent_usd', 'cached_input_tokens', 'reasoning_output_tokens', 'model_attempts'] as const) {
    if (before[key] !== undefined || after[key] !== undefined) delta[key] = (after[key] ?? 0) - (before[key] ?? 0)
  }
  if (after.billed_cost_usd !== undefined) delta.billed_cost_usd = after.billed_cost_usd === null
    ? null
    : after.billed_cost_usd - (before.billed_cost_usd ?? 0)
  for (const key of ['billing_mode', 'cost_basis', 'usage_status'] as const) if (after[key] !== undefined) (delta as unknown as Record<string, unknown>)[key] = after[key]
  return delta
}

function mergeEnum<T extends string>(current: T | 'mixed' | undefined, next: T | 'mixed' | undefined): T | 'mixed' | undefined {
  if (next === undefined) return current
  if (current === undefined || current === next) return next
  return 'mixed'
}

function mergeStatus(current: UsageMetadata['usage_status'], next: UsageMetadata['usage_status']): UsageMetadata['usage_status'] {
  const rank = { complete: 0, partial: 1, unknown: 2, estimated: 3 }
  if (next === undefined) return current
  if (current === undefined) return next
  return rank[next] > rank[current] ? next : current
}

export function mergeUsageDelta(target: UsageDelta, delta: UsageDelta): void {
  const previousCost = target.cost_usd
  const existingBasis = target.cost_basis ?? (previousCost > 0 ? 'legacy_estimate' : undefined)
  target.input += delta.input
  target.output += delta.output
  target.cost_usd += delta.cost_usd
  target.billing_mode = mergeEnum(target.billing_mode, delta.billing_mode)
  target.cost_basis = mergeEnum(existingBasis, delta.cost_basis ?? (delta.cost_usd > 0 ? 'legacy_estimate' : undefined))
  target.usage_status = mergeStatus(target.usage_status, delta.usage_status)
  if (target.billed_cost_usd === null || delta.billed_cost_usd === null) {
    target.billed_cost_usd = null
  } else if (target.billed_cost_usd === undefined && delta.billed_cost_usd === undefined) {
    // Keep unknown billing unknown. Zero is a real amount and must not be
    // fabricated when neither side reported billed cost.
    target.billed_cost_usd = undefined
  } else if (target.billed_cost_usd === undefined) {
    target.billed_cost_usd = delta.billed_cost_usd
  } else if (delta.billed_cost_usd !== undefined) {
    target.billed_cost_usd += delta.billed_cost_usd
  }
  for (const key of ['api_estimate_usd', 'api_equivalent_usd', 'cached_input_tokens', 'reasoning_output_tokens', 'model_attempts'] as const) {
    if (delta[key] !== undefined) target[key] = (target[key] ?? 0) + delta[key]!
  }
}

function usageDir(overrideDir?: string): string {
  return overrideDir ?? harnessStatePath('usage')
}

function usageFilePath(user: string, overrideDir?: string): string {
  return join(usageDir(overrideDir), `${user}.json`)
}

function emptyLedger(user: string): UserUsage {
  return {
    user,
    total: { input: 0, output: 0, cost_usd: 0 },
    by_month: {},
    updated_at: new Date().toISOString(),
  }
}

export function recordUsage(user: string, delta: UsageDelta, overrideDir?: string): void {
  const dir = usageDir(overrideDir)
  mkdirSync(dir, { recursive: true })
  const path = usageFilePath(user, overrideDir)

  let ledger: UserUsage
  try {
    ledger = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf-8')) as UserUsage)
      : emptyLedger(user)
  } catch {
    ledger = emptyLedger(user)
  }

  mergeUsageDelta(ledger.total, delta)

  const month = new Date().toISOString().slice(0, 7)
  if (!ledger.by_month[month]) {
    ledger.by_month[month] = { input: 0, output: 0, cost_usd: 0 }
  }
  mergeUsageDelta(ledger.by_month[month], delta)

  ledger.updated_at = new Date().toISOString()
  writeFileSync(path, JSON.stringify(ledger, null, 2), 'utf-8')
}

export function readUsage(user: string, overrideDir?: string): UserUsage | null {
  const path = usageFilePath(user, overrideDir)
  try {
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf-8')) as UserUsage)
      : null
  } catch {
    return null
  }
}
