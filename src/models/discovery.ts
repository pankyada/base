import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import type { Profile } from '../profiles/schema.js'
import type { EffortCapability, ModelInfo } from '../types.js'
import { effortCapabilityFromValues, normalizeEffortCapability, unknownEffortCapability } from './effort.js'
import { FALLBACK_PRICES, MODEL_REGISTRY, listModels } from './registry.js'
import { readCodexAuth } from '../provider/auth/store.js'
import { createProviderClient } from '../provider/client.js'
import { CODEX_API_ENDPOINT } from '../provider/codex/adapter.js'
import pkg from '../../package.json' with { type: 'json' }

const MODEL_CACHE_TTL_MS = 5 * 60_000
const MODEL_CACHE_LIMIT = 32
const modelCache = new Map<string, { models: ModelInfo[]; expiresAt: number }>()

export function clearModelDiscoveryCache(): void {
  modelCache.clear()
}

export async function discoverProfileModels(profile: Profile, options: { homeDir?: string; environment?: NodeJS.ProcessEnv; report?: (message: string) => void } = {}): Promise<ModelInfo[]> {
  const report = options.report ?? (() => {})
  if (profile.model.auth === 'codex_oauth') {
    return resolveCodexModels({ homeDir: options.homeDir ?? homedir(), offline: false, staticModels: listModels(profile), report })
  }
  const environment = options.environment ?? process.env
  const baseUrl = profile.model.base_url
  const normalized = baseUrl.replace(/\/+$/, '')
  const provider = normalized === 'https://api.openai.com/v1' ? 'OpenAI' : normalized === 'https://api.anthropic.com/v1' ? 'Anthropic' : 'Other OpenAI-compatible'
  return resolveLiveModels({ provider, profile, baseUrl, environment, offline: false,
    staticModels: listModels(profile).filter(model => model.available),
    key: environment[profile.model.api_key_env] ?? '', apiKeyEnv: profile.model.api_key_env, report })
}

export function getStaticModelsForProvider(provider: string): readonly ModelInfo[] {
  const lookup = provider === 'Other OpenAI-compatible' ? 'OpenAI' : provider
  return MODEL_REGISTRY.filter(model => model.provider === lookup)
}

export async function resolveLiveModels({
  provider,
  profile,
  baseUrl,
  environment,
  offline,
  staticModels,
  key,
  apiKeyEnv,
  report,
}: {
  provider: string
  profile: Profile
  baseUrl: string
  environment: NodeJS.ProcessEnv
  offline: boolean
  staticModels: readonly ModelInfo[]
  key: string
  apiKeyEnv: string
  report: (message: string) => void
}): Promise<ModelInfo[]> {
  if (!key || offline) {
    report(offline ? 'Offline: showing bundled models; custom model IDs accepted.' : 'No API key: showing bundled models.')
    return [...staticModels]
  }
  const cacheKey = opaqueProviderScope('api_key', baseUrl, key)
  report(`Fetching models from ${provider}…`)
  if (provider === 'Anthropic') {
    return resolveAnthropicModels({
      baseUrl,
      apiKey: key,
      staticModels,
      providerLabel: provider,
      report,
    })
  }
  try {
    const client = createProviderClient({
      ...profile,
      model: {
        ...profile.model,
        auth: 'api_key',
        id: profile.model.id,
        base_url: baseUrl,
        api_key_env: apiKeyEnv,
      },
    }, environment)
    const response = await client.models.list({ timeout: 10000, maxRetries: 0 })
    const entries = (Array.isArray(response.data) ? response.data : []) as unknown as Array<Record<string, unknown> & { id: string }>
    const ids = extractModelIds({ data: entries })
    if (!ids.length) throw new Error('Provider returned no models')
    const models = materializeModels({
      ids,
      staticModels,
      providerLabel: provider,
      baseUrl,
      entries,
      providerScope: opaqueProviderScope('api_key', baseUrl, key),
    })
    rememberModels(cacheKey, models)
    return models
  } catch {
    report('Model discovery unavailable: showing bundled models; custom model IDs accepted.')
    return cachedModels(cacheKey) ?? [...staticModels]
  }
}

export async function resolveCodexModels({
  homeDir,
  offline,
  staticModels,
  report,
}: {
  homeDir: string
  offline: boolean
  staticModels: readonly ModelInfo[]
  report: (message: string) => void
}): Promise<ModelInfo[]> {
  if (offline) report('Offline: showing bundled Codex models.')
  if (offline) return [...staticModels]
  const record = readCodexAuth(homeDir)
  if (!record?.credential) return [...staticModels]
  // Codex catalog protocol version, independent of Base's package version.
  // Source: openai/codex rust-v0.153.4, codex-api/src/endpoint/models.rs.
  const endpoint = new URL(`${CODEX_API_ENDPOINT.replace(/\/responses$/, '')}/models`)
  endpoint.searchParams.set('client_version', '0.153.4')
  report('Fetching models from OpenAI Codex subscription…')
  try {
    const response = await fetch(endpoint.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
      headers: {
        authorization: `Bearer ${record.credential.access_token}`,
        'chatgpt-account-id': record.credential.account_id,
        originator: 'base',
        'user-agent': `base/${pkg.version}`,
        accept: 'application/json',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    const body = await response.json()
    const selectable = Array.isArray(body.models)
      ? { models: body.models.filter((model: any) => model?.visibility !== 'hide') }
      : body
    const entries = extractModelEntries(selectable)
    const ids = entries.map(entry => entry.id)
    if (!ids.length) throw new Error('Provider returned no selectable models')
    const cacheKey = opaqueProviderScope('codex_oauth', CODEX_API_ENDPOINT, record.credential.account_id)
    const models = materializeModels({ ids, entries, staticModels, providerLabel: 'OpenAI Codex subscription', baseUrl: '', providerScope: cacheKey })
    rememberModels(cacheKey, models)
    return models
  } catch (error) {
    // Do not print raw provider bodies or credentials.
    const detail = error instanceof Error && /^(HTTP \d{3}|Provider returned)/.test(error.message)
      ? error.message : 'Network request failed or timed out'
    report(`Codex model discovery unavailable (${detail}): showing bundled models.`)
    return cachedModels(opaqueProviderScope('codex_oauth', CODEX_API_ENDPOINT, record.credential.account_id)) ?? [...staticModels]
  }
}

async function resolveAnthropicModels({
  baseUrl,
  apiKey,
  staticModels,
  providerLabel,
  report,
}: {
  baseUrl: string
  apiKey: string
  staticModels: readonly ModelInfo[]
  providerLabel: string
  report: (message: string) => void
}): Promise<ModelInfo[]> {
  try {
    const endpoint = new URL(`${baseUrl.replace(/\/+$/, '')}/models`)
    const entries: Array<Record<string, unknown> & { id: string }> = []
    const cursors = new Set<string>()
    const signal = AbortSignal.timeout(10000)
    while (true) {
      const response = await fetch(endpoint.toString(), {
        method: 'GET',
        signal,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          accept: 'application/json',
        },
      })
      if (!response.ok) throw new Error(`Models request failed: HTTP ${response.status}`)
      const body = await response.json()
      entries.push(...extractModelEntries(body))
      if (!body.has_more) break
      if (typeof body.last_id !== 'string' || !body.last_id || cursors.has(body.last_id)) throw new Error('Invalid models pagination cursor')
      cursors.add(body.last_id)
      endpoint.searchParams.set('after_id', body.last_id)
    }
    const ids = entries.map(entry => entry.id)
    if (!ids.length) throw new Error('Provider returned no models')
    const cacheKey = opaqueProviderScope('api_key', baseUrl, apiKey)
    const models = materializeModels({
      ids,
      staticModels,
      providerLabel,
      baseUrl,
      entries,
      providerScope: opaqueProviderScope('api_key', baseUrl, apiKey),
    })
    rememberModels(cacheKey, models)
    return models
  } catch {
    report('Anthropic model discovery unavailable: showing bundled models; custom model IDs accepted.')
    return cachedModels(opaqueProviderScope('api_key', baseUrl, apiKey)) ?? [...staticModels]
  }
}

function extractModelIds(payload: unknown): string[] {
  return extractModelEntries(payload).map(entry => entry.id)
}

function extractModelEntries(payload: unknown): Array<Record<string, unknown> & { id: string }> {
  if (!payload || typeof payload !== 'object') return []
  const body = payload as { data?: unknown; models?: unknown }
  const entries = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : []
  return entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const id = record.id ?? record.slug
    return typeof id === 'string' && id.trim() ? [{ ...record, id: id.trim() }] : []
  })
}

function materializeModels({
  ids,
  entries,
  staticModels,
  providerLabel,
  baseUrl,
  providerScope,
}: {
  ids: string[]
  entries?: Array<Record<string, unknown> & { id: string }>
  staticModels: readonly ModelInfo[]
  providerLabel: string
  baseUrl: string
  providerScope?: string
}): ModelInfo[] {
  const staticById = new Map(staticModels.map(model => [model.id, model]))
  const entryById = new Map((entries ?? []).map(entry => [entry.id, entry]))
  const models: ModelInfo[] = []
  const seen = new Set<string>()
  const addModel = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    const known = staticById.get(id)
    const liveEffort = extractEffortCapability(entryById.get(id))
    if (known) {
      models.push({ ...known, available: true, reason: undefined, ...(liveEffort ? { effort: liveEffort } : {}), ...(providerScope ? { provider_scope: providerScope } : {}) })
    } else {
      models.push({
        id,
        label: id,
        provider: providerLabel,
        base_url: baseUrl,
        context_window: 0,
        input_price: FALLBACK_PRICES.input,
        output_price: FALLBACK_PRICES.output,
        tags: ['available'],
        available: true,
        ...(liveEffort ? { effort: liveEffort } : { effort: unknownEffortCapability() }),
        ...(providerScope ? { provider_scope: providerScope } : {}),
      })
    }
  }
  for (const id of ids) addModel(id)
  return models
}

function extractEffortCapability(entry: Record<string, unknown> | undefined): EffortCapability | undefined {
  if (!entry) return undefined
  const effortObject = [entry.effort, entry.reasoning, entry.reasoning_effort].find(value => value && typeof value === 'object' && !Array.isArray(value)) as Record<string, unknown> | undefined
  const values = firstArray(entry, effortObject, ['supported_reasoning_efforts', 'reasoning_efforts', 'supported_reasoning_levels', 'supported_efforts', 'efforts', 'options', 'reasoning_effort'])
  const defaultValue = firstValue(entry, effortObject, ['provider_default', 'default_reasoning_effort', 'reasoning_effort_default', 'default_effort', 'default'])
  if (!values && !effortObject && defaultValue === undefined) return undefined
  if (effortObject?.options !== undefined) return normalizeEffortCapability({ ...effortObject, status: 'supported' }, { source: 'live' })
  return effortCapabilityFromValues(values, defaultValue, { source: 'live' })
}

function firstArray(entry: Record<string, unknown>, nested: Record<string, unknown> | undefined, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    if (Array.isArray(entry[key])) return entry[key]
    if (nested && Array.isArray(nested[key])) return nested[key]
  }
  return undefined
}

function firstValue(entry: Record<string, unknown>, nested: Record<string, unknown> | undefined, keys: string[]): unknown {
  for (const key of keys) {
    if (entry[key] !== undefined) return entry[key]
    if (nested?.[key] !== undefined) return nested[key]
  }
  return undefined
}

function opaqueProviderScope(transport: string, endpoint: string, accountIdentity: string): string {
  return `scope_${createHash('sha256').update(`${transport}\n${endpoint.replace(/\/+$/, '')}\n${accountIdentity}`).digest('hex').slice(0, 32)}`
}

function rememberModels(key: string, models: ModelInfo[]): void {
  modelCache.delete(key)
  modelCache.set(key, { models: models.map(model => structuredClone(model)), expiresAt: Date.now() + MODEL_CACHE_TTL_MS })
  while (modelCache.size > MODEL_CACHE_LIMIT) modelCache.delete(modelCache.keys().next().value!)
}

function cachedModels(key: string): ModelInfo[] | undefined {
  const entry = modelCache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    modelCache.delete(key)
    return undefined
  }
  modelCache.delete(key)
  modelCache.set(key, entry)
  return entry.models.map(model => ({
    ...structuredClone(model),
    effort: model.effort ? { ...structuredClone(model.effort), source: 'cache', stale: true } : undefined,
  }))
}
