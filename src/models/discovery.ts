import { homedir } from 'node:os'
import type { Profile } from '../profiles/schema.js'
import type { ModelInfo } from '../types.js'
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
    const ids = (response.data ?? []).map((model: any) => (typeof model?.id === 'string' ? model.id : '')).filter((id: string): id is string => !!id)
    if (!ids.length) throw new Error('Provider returned no models')
    return materializeModels({
      ids,
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
    const ids = extractModelIds(selectable)
    if (!ids.length) throw new Error('Provider returned no selectable models')
    return materializeModels({ ids, staticModels, providerLabel: 'OpenAI Codex subscription', baseUrl: '' })
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
      ids,
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

function materializeModels({
  ids,
  staticModels,
  providerLabel,
  baseUrl,
}: {
  ids: string[]
  staticModels: readonly ModelInfo[]
  providerLabel: string
  baseUrl: string
}): ModelInfo[] {
  const staticById = new Map(staticModels.map(model => [model.id, model]))
  const models: ModelInfo[] = []
  const seen = new Set<string>()
  const addModel = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    const known = staticById.get(id)
    if (known) {
      models.push({ ...known, available: true, reason: undefined })
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
      })
    }
  }
  for (const id of ids) addModel(id)
  return models
}

