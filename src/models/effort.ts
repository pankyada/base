import type { EffortCapability, EffortOption } from '../types.js'

const MAX_VALUE_LENGTH = 64
const MAX_LABEL_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 240
const MAX_OPTIONS = 32

export const DEFAULT_EFFORT_LABEL = 'Default'

export function unknownEffortCapability(checkedAt = new Date().toISOString(), source: EffortCapability['source'] = 'live'): EffortCapability {
  return { status: 'unknown', options: [], source, checked_at: checkedAt, stale: false }
}

export function unsupportedEffortCapability(checkedAt = new Date().toISOString()): EffortCapability {
  return { status: 'unsupported', options: [], source: 'live', checked_at: checkedAt, stale: false }
}

export function normalizeEffortCapability(
  value: unknown,
  defaults: { source: EffortCapability['source']; checkedAt?: string; stale?: boolean } = { source: 'live' },
): EffortCapability {
  const checkedAt = defaults.checkedAt ?? new Date().toISOString()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unknownEffortCapability(checkedAt)
  const raw = value as Record<string, unknown>
  const rawOptions = raw.options
  if (!Array.isArray(rawOptions)) return unknownEffortCapability(checkedAt)
  const options: EffortOption[] = []
  const seen = new Set<string>()
  for (const item of rawOptions.slice(0, MAX_OPTIONS)) {
    const option = normalizeOption(item)
    if (!option || seen.has(option.value)) continue
    seen.add(option.value)
    options.push(option)
  }
  if (rawOptions.length > 0 && options.length === 0) return unknownEffortCapability(checkedAt)
  const providerDefault = cleanString(raw.provider_default, MAX_VALUE_LENGTH)
  const capability: EffortCapability = {
    status: raw.status === 'unsupported' || raw.status === 'unknown' ? raw.status : options.length ? 'supported' : 'unsupported',
    options,
    ...(providerDefault ? { provider_default: providerDefault } : {}),
    source: defaults.source,
    checked_at: checkedAt,
    stale: defaults.stale ?? false,
  }
  if (capability.status === 'supported' && !capability.options.some(option => option.selectable)) {
    capability.status = 'unsupported'
  }
  return capability
}

export function effortCapabilityFromValues(
  values: unknown,
  providerDefault: unknown,
  options: { source: EffortCapability['source']; checkedAt?: string; stale?: boolean } = { source: 'live' },
): EffortCapability {
  if (!Array.isArray(values)) return unknownEffortCapability(options.checkedAt)
  return normalizeEffortCapability({
    options: values,
    provider_default: providerDefault,
  }, options)
}

export function isExplicitEffort(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

export function validateEffortSelection(capability: EffortCapability | undefined, requested: string | null | undefined): void {
  if (!isExplicitEffort(requested)) return
  const option = capability?.options.find(item => item.value === requested)
  if (!capability || capability.status !== 'supported' || !option || !option.selectable) {
    throw new Error(`reasoning effort ${requested} is unavailable`)
  }
  if (capability.stale) throw new Error('reasoning effort capability is stale; refresh required')
}

export function resolveEffortSelection({
  capability,
  profileEffort,
  savedEffort,
}: {
  capability?: EffortCapability
  profileEffort?: string | null
  savedEffort?: string | null
}): string | null {
  for (const candidate of [savedEffort, profileEffort]) {
    if (candidate === null) return null
    if (isExplicitEffort(candidate) && capability?.status === 'supported' && capability.options.some(option => option.value === candidate && option.selectable)) return candidate
  }
  return null
}

function normalizeOption(value: unknown): EffortOption | undefined {
  if (typeof value === 'string') {
    const optionValue = cleanString(value, MAX_VALUE_LENGTH)
    return optionValue ? adapterOption(optionValue) : undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const optionValue = cleanString(raw.value, MAX_VALUE_LENGTH)
  if (!optionValue) return undefined
  const label = cleanString(raw.label, MAX_LABEL_LENGTH) ?? optionValue
  const description = cleanString(raw.description, MAX_DESCRIPTION_LENGTH)
  const unavailable = cleanString(raw.unavailable_reason, MAX_DESCRIPTION_LENGTH)
  const selectable = raw.selectable === undefined ? true : raw.selectable === true
  return { value: optionValue, label, ...(description ? { description } : {}), selectable, ...(unavailable ? { unavailable_reason: unavailable } : {}) }
}

function adapterOption(value: string): EffortOption {
  if (value === 'ultra') return { value, label: 'Ultra', selectable: false, unavailable_reason: 'Codex adapter compatibility not validated' }
  return { value, label: value[0].toUpperCase() + value.slice(1), selectable: true }
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  if (!result || result.length > maxLength || /[\u0000-\u001f\u007f]/.test(result)) return undefined
  return result
}
