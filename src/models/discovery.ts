import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import type { Profile } from '../profiles/schema.js'
import type { EffortCapability, ModelInfo } from '../types.js'
import { FALLBACK_PRICES, MODEL_REGISTRY, listModels } from './registry.js'
import { readCodexAuth } from '../provider/auth/store.js'
import { createProviderClient } from '../provider/client.js'
import { CODEX_API_ENDPOINT } from '../provider/codex/adapter.js'
import pkg from '../../package.json' with { type: 'json' }

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
    const entries = extractModelEntries(response.data, {
      source: 'live', checkedAt: new Date().toISOString(),
      scope: providerScope(provider, baseUrl, key),
    })
    // Current API-key adapter has no verified effort payload contract. Keep
    // catalog metadata for diagnostics only; selection stays provider-default.
    for (const entry of entries) entry.effort = undefined
    if (!entries.length) throw new Error('Provider returned no models')
    return materializeModels({
      entries,
      staticModels,
      providerLabel: provider,
      baseUrl,
    })
  } catch {
    report('Model discovery unavailable: showing bundled models; custom model IDs accepted.')
    return [...staticModels]
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
    const entries = extractModelEntries(selectable, {
      source: 'live', checkedAt: new Date().toISOString(),
      scope: providerScope('codex_subscription', endpoint.origin + endpoint.pathname, record.credential.account_id),
      codex: true,
    })
    if (!entries.length) throw new Error('Provider returned no selectable models')
    return materializeModels({ entries, staticModels, providerLabel: 'OpenAI Codex subscription', baseUrl: '' })
  } catch (error) {
    // Do not print raw provider bodies or credentials.
    const detail = error instanceof Error && /^(HTTP \d{3}|Provider returned)/.test(error.message)
      ? error.message : 'Network request failed or timed out'
    report(`Codex model discovery unavailable (${detail}): showing bundled models.`)
    return [...staticModels]
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
    const ids: string[] = []
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
      ids.push(...extractModelIds(body))
      if (!body.has_more) break
      if (typeof body.last_id !== 'string' || !body.last_id || cursors.has(body.last_id)) throw new Error('Invalid models pagination cursor')
      cursors.add(body.last_id)
      endpoint.searchParams.set('after_id', body.last_id)
    }
    if (!ids.length) throw new Error('Provider returned no models')
    return materializeModels({
      entries: ids.map(id => ({ id })),
      staticModels,
      providerLabel,
      baseUrl,
    })
  } catch {
    report('Anthropic model discovery unavailable: showing bundled models; custom model IDs accepted.')
    return [...staticModels]
  }
}

function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const body = payload as { data?: unknown; models?: unknown }
  const entries = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : []
  return entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return []
    const id = entry.id ?? entry.slug
    return typeof id === 'string' && id.trim() ? [id] : []
  })
}

interface CatalogEntry { id: string; effort?: EffortCapability }

export function parseEffortCapability(entry: unknown, options: {
  source: EffortCapability['source']
  checkedAt: string
  scope: EffortCapability['scope']
  codex?: boolean
}): EffortCapability | undefined {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined
  const item = entry as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(item, 'supported_reasoning_levels')) return undefined
  const raw = item.supported_reasoning_levels
  if (!Array.isArray(raw)) return { status: 'unknown', options: [], source: options.source, checked_at: options.checkedAt, stale: true, scope: options.scope }
  const optionsOut: EffortCapability['options'] = []
  const seen = new Set<string>()
  for (const value of raw) {
    const record = typeof value === 'string' ? { effort: value } : value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
    const effort = typeof record?.effort === 'string' ? record.effort : undefined
    if (!effort || effort.length > 64 || effort.trim() !== effort || /[\u0000-\u001f\u007f]/.test(effort) || seen.has(effort)) continue
    seen.add(effort)
    const description = typeof record?.description === 'string' && record.description.length <= 256 && !/[\u0000-\u001f\u007f]/.test(record.description) ? record.description : undefined
    const unavailable = options.codex && effort === 'ultra' ? 'provider-managed delegation is not enabled by Base' : undefined
    optionsOut.push({ value: effort, label: effort === 'none' ? 'None' : effort, ...(description ? { description } : {}), selectable: !unavailable, ...(unavailable ? { unavailable_reason: unavailable } : {}) })
  }
  const providerDefault = typeof item.default_reasoning_level === 'string' && seen.has(item.default_reasoning_level) ? item.default_reasoning_level : undefined
  return {
    status: optionsOut.length ? 'supported' : 'unsupported', options: optionsOut,
    ...(providerDefault ? { provider_default: providerDefault } : {}), source: options.source,
    checked_at: options.checkedAt, stale: false, scope: options.scope,
  }
}

function extractModelEntries(payload: unknown, options: { source: EffortCapability['source']; checkedAt: string; scope: EffortCapability['scope']; codex?: boolean }): CatalogEntry[] {
  if (!payload || typeof payload !== 'object') return []
  const body = payload as { data?: unknown; models?: unknown }
  const entries = Array.isArray(payload) ? payload : Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : []
  return entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const item = entry as Record<string, unknown>
    const id = item.id ?? item.slug
    if (typeof id !== 'string' || !id.trim() || id.length > 256) return []
    return [{ id, effort: parseEffortCapability(item, options) }]
  })
}

function materializeModels({
  entries,
  staticModels,
  providerLabel,
  baseUrl,
}: {
  entries: CatalogEntry[]
  staticModels: readonly ModelInfo[]
  providerLabel: string
  baseUrl: string
}): ModelInfo[] {
  const staticById = new Map(staticModels.map(model => [model.id, model]))
  const models: ModelInfo[] = []
  const seen = new Set<string>()
  const addModel = (entry: CatalogEntry): void => {
    const id = entry.id
    if (seen.has(id)) return
    seen.add(id)
    const known = staticById.get(id)
    if (known) {
      models.push({ ...known, available: true, reason: undefined, ...(entry.effort ? { effort: entry.effort } : { effort: unknownEffort('live', providerLabel, baseUrl) }) })
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
        available: true, ...(entry.effort ? { effort: entry.effort } : { effort: unknownEffort('live', providerLabel, baseUrl) }),
      })
    }
  }
  for (const entry of entries) addModel(entry)
  return models
}

function unknownEffort(source: EffortCapability['source'], transport: string, endpoint: string): EffortCapability {
  return { status: 'unknown', options: [], source: source === 'live' ? 'cache' : source, checked_at: new Date(0).toISOString(), stale: true, scope: providerScope(transport, endpoint, '') }
}

function providerScope(transport: string, endpoint: string, account: string): { transport: string; endpoint: string; provider_scope: string } {
  const provider_scope = createHash('sha256').update(`${transport}\u0000${endpoint}\u0000${account}`).digest('hex').slice(0, 16)
  return { transport, endpoint, provider_scope }
}
