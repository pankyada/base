import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { createInterface } from 'readline'
import { join } from 'path'
import { FALLBACK_PRICES, MODEL_REGISTRY, listModels } from '../models/registry.js'
import type { ModelInfo } from '../types.js'
import { loadProfile } from '../profiles/loader.js'
import { ProfileSchema, type Profile } from '../profiles/schema.js'
import { codexAuthStatus, readCodexAuth } from '../provider/auth/store.js'
import { runAuthCommand } from './auth.js'
import { createProviderClient } from '../provider/client.js'
import { load as loadYaml } from 'js-yaml'
import { loadStartupProfiles } from '../server/profile-startup.js'
import { readUserConfig, writeUserConfig } from '../config/user-config.js'
import { loadUserEnv, userEnvPath, writeUserEnv } from '../config/user-env.js'
import { runDoctor, type DoctorResult } from './doctor.js'
import pkg from '../../package.json' with { type: 'json' }
import { CODEX_API_ENDPOINT } from '../provider/codex/adapter.js'

export interface InitIO {
  write(line: string): void
  readLine(prompt: string): Promise<string>
  readSecret(prompt: string): Promise<string>
  close?(): void
}

export type InitDoctor = (options: { homeDir: string; environment: NodeJS.ProcessEnv; offline: boolean }) => Promise<DoctorResult>

export interface InitOptions {
  homeDir?: string
  environment?: NodeJS.ProcessEnv
  io?: InitIO
  doctor?: InitDoctor
  now?: () => Date
}

interface InitFlags { yes: boolean; offline: boolean; reconfigure: boolean; profile?: string }

const SURFACES = ['tui', 'cli', 'web'] as const

const WIZARD_STEPS = ['Use case', 'Provider', 'Model', 'Credentials', 'Surface', 'Health'] as const
const WIZARD_TOTAL_STEPS = WIZARD_STEPS.length

const THEME = {
  dim: '\u001b[90m',
  accent: '\u001b[38;5;81m',
  ok: '\u001b[32m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
  bold: '\u001b[1m',
  reset: '\u001b[0m',
}

interface InitWizardUI {
  step: (index: number, label: string) => void
  panel: (title: string, lines: string[]) => void
  status: (label: string, value: string) => void
  prompt: (label: string, fallback: string) => Promise<string>
  readSecret: (label: string) => Promise<string>
  check: (name: string, ok: boolean, detail: string, fix?: string) => void
  done: (surface: string) => void
  plain: (line: string) => void
}

export async function runInit(args: string[] = [], options: InitOptions = {}): Promise<number> {
  const flags = parseFlags(args)
  const homeDir = options.homeDir ?? homedir()
  const environment = options.environment ?? process.env
  const io = options.io ?? defaultIO()
  const close = io.close
  const now = options.now ?? (() => new Date())
  const ui = createInitUI(io)

  try {
    ui.plain('')
    ui.plain(`${THEME.accent}${THEME.bold}[Harness Setup]${THEME.reset}`)
    ui.plain(`${THEME.dim}Guided first-run onboarding in terminal${THEME.reset}`)
    ui.step(0, 'Start')

    const existing = readUserConfig(homeDir)
    if (flags.reconfigure) {
      backupFile(userConfigPath(homeDir), now, io)
      backupFile(userEnvPath(homeDir), now, io)
    }

    const registry = loadStartupProfiles({ homeDir, environment, explicitDefaultProfile: flags.profile })
    const useCases = [...registry.profiles.values()]
      .sort((left, right) => ((left.use_case?.rank ?? Number.MAX_SAFE_INTEGER) - (right.use_case?.rank ?? Number.MAX_SAFE_INTEGER)) || left.name.localeCompare(right.name))
    if (!useCases.length) throw new Error('no valid profiles found; install or configure a profile')

    const selected = flags.profile
      ? registry.profiles.get(flags.profile)
      : flags.yes
        ? useCases[0]
        : await chooseProfile(useCases, ui)
    if (!selected) throw new Error(`unknown profile "${flags.profile}"; available: ${[...registry.profiles.keys()].sort().join(', ')}`)

    let profile = selected
    ui.step(1, 'Use case')
    ui.status('Profile', profile.name)
    const isCodex = profile.model.auth === 'codex_oauth'
    const defaultProvider = isCodex ? 'OpenAI Codex subscription' : providerForBaseUrl(profile.model.base_url!)
    ui.step(2, 'Provider')
    const provider = flags.yes ? defaultProvider : await chooseProvider(defaultProvider, ui)
    let selectedModel: Profile['model']
    if (provider === 'OpenAI Codex subscription') {
      const catalogProfile = { ...profile, model: { auth: 'codex_oauth' as const, id: profile.model.id, codex: { max_model_calls_per_run: 64, request_timeout_ms: 120000 } } }
      const baselineModels = listModels(catalogProfile)
      await ensureCodexAuthentication({
        homeDir,
        offline: flags.offline,
        flags,
        io,
      })
      const models = await resolveCodexModels({
        homeDir,
        offline: flags.offline,
        staticModels: baselineModels,
        report: message => ui.plain(message),
      })
      const defaultModel = models.some(item => item.id === profile.model.id) ? profile.model.id : models[0].id
      const model = flags.yes ? defaultModel : await chooseModel(models, defaultModel, ui)
      selectedModel = { auth: 'codex_oauth', id: model, codex: { max_model_calls_per_run: 64, request_timeout_ms: 120000 } }
      const status = codexAuthStatus(homeDir)
      ui.step(3, 'Model')
      ui.status('Model', model)
      ui.status('Codex subscription', status.status)
    } else {
      const currentUrl = profile.model.base_url ?? 'https://api.openai.com/v1'
      const baseUrl = provider === 'Other OpenAI-compatible' ? await ask('Base URL', currentUrl, ui) : baseUrlForProvider(provider, currentUrl)
      ui.step(3, 'Model')
      ui.status('Provider', provider)
      ui.status('Base URL', baseUrl)
      const apiKeyEnv = provider === 'Anthropic' ? 'ANTHROPIC_API_KEY' : provider === 'OpenAI' ? 'OPENAI_API_KEY' : profile.model.api_key_env ?? 'OPENAI_API_KEY'
      const ambientKey = environment[apiKeyEnv]
      loadUserEnv(homeDir, environment)
      let key = environment[apiKeyEnv]
      if (!ambientKey || flags.reconfigure) {
        if (flags.yes && !key) throw new Error(`API key required for ${apiKeyEnv}; rerun without --yes`)
        if (!flags.yes) {
          key = await ui.readSecret(`API key for ${apiKeyEnv}`)
          if (!key) throw new Error(`API key required for ${apiKeyEnv}`)
          if (!flags.reconfigure) backupFile(userEnvPath(homeDir), now, io, true)
          writeUserEnv(apiKeyEnv, key, homeDir)
          environment[apiKeyEnv] = key
          ui.status('API key', `${apiKeyEnv} (saved)`)
        }
      }
      const staticModels = getStaticModelsForProvider(provider)
      const models = await resolveLiveModels({
        provider,
        profile,
        baseUrl,
        environment,
        offline: flags.offline,
        staticModels,
        key: key ?? '',
        apiKeyEnv,
        report: message => ui.plain(message),
      })
      const defaultModel = models.some(model => model.id === profile.model.id) ? profile.model.id : models[0]?.id ?? profile.model.id
      const model = flags.yes ? defaultModel : await chooseModel(models, defaultModel, ui)
      ui.step(4, 'Credentials')
      ui.status('Model', `${model} on ${baseUrl}`)
      ui.status('API key source', ambientKey ? `${apiKeyEnv} (environment)` : `${apiKeyEnv} (saved)`)
      selectedModel = { auth: 'api_key', base_url: baseUrl, api_key_env: apiKeyEnv, id: model }
    }
    if ((profile.model.auth ?? 'api_key') !== selectedModel.auth || profile.model.base_url !== selectedModel.base_url || profile.model.api_key_env !== selectedModel.api_key_env || profile.model.id !== selectedModel.id) {
      const applied = await confirmModelChange(profile.profile_path, selectedModel, flags, io, now)
      if (applied && profile.profile_path) profile = loadProfile(profile.profile_path)
      else io.write('model change declined; keeping the existing profile model')
    }

    const surface = flags.yes ? 'tui' : await chooseSurface(existing?.surface ?? 'tui', ui)
    ui.step(5, 'Surface')
    ui.status('Surface', surface)
    const config = {
      ...(existing ?? {}),
      version: 1 as const,
      default_profile: profile.name,
      profiles_dir: existing?.profiles_dir ?? '~/.harness/profiles',
      surface,
      initialised_at: now().toISOString(),
      harness_version: pkg.version,
    }
    ui.panel('Runtime summary', [
      `Profile: ${profile.name}`,
      `Surface: ${surface}`,
      `Provider: ${provider}`,
      `Model: ${profile.model.id}`,
    ])
    writeUserConfig(config, homeDir)
    ui.status('Config', `Wrote ${join(homeDir, '.harness', 'config.json')}`)
    if (existsSync(userEnvPath(homeDir))) io.write(`Wrote ${userEnvPath(homeDir)} (mode 0600)`)

    ui.step(6, 'Health checks')
    ui.plain(flags.offline ? 'Checking… skipped (--offline)' : 'Checking…')
    const result = await (options.doctor ?? runDoctor)({ homeDir, environment, offline: flags.offline })
    for (const check of result.checks) ui.check(check.name, check.ok, check.detail, check.fix)
    if (!result.ok) return 1
    ui.done(surface)
    return 0
  } catch (error: any) {
    uiError(io, `init failed: ${error?.message ?? String(error)}`)
    return 1
  } finally {
    close?.()
  }
}

function parseFlags(args: string[]): InitFlags {
  const flags: InitFlags = { yes: false, offline: false, reconfigure: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--yes') flags.yes = true
    else if (arg === '--offline') flags.offline = true
    else if (arg === '--reconfigure') flags.reconfigure = true
    else if (arg === '--profile') {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('usage: harness init [--yes] [--profile <name>] [--offline] [--reconfigure]')
      flags.profile = value
    } else throw new Error(`unknown init flag: ${arg}`)
  }
  return flags
}

async function chooseProfile(profiles: any[], ui: InitWizardUI): Promise<any> {
  const entries = profiles.map((profile, index) => `  ${index + 1}. ${profile.use_case?.label ?? profile.name} — ${profile.use_case?.blurb ?? profile.description ?? 'Existing profile'} (${profile.name})`)
  ui.panel('Use case', entries)
  const answer = await ui.prompt('Choose a use case', '')
  return profiles[choiceIndex(answer, profiles.length, 0)]
}

async function chooseProvider(defaultProvider: string, ui: InitWizardUI): Promise<string> {
  const providers = ['Anthropic', 'OpenAI', 'Other OpenAI-compatible', 'OpenAI Codex subscription']
  ui.panel('Provider', providers.map((provider, index) => `  ${index + 1}. ${provider}`))
  const answer = await ui.prompt(`Choose provider [${defaultProvider}]`, '')
  if (!answer.trim()) return defaultProvider
  const index = choiceIndex(answer, providers.length, providers.indexOf(defaultProvider))
  return providers[index]
}

function getStaticModelsForProvider(provider: string): readonly ModelInfo[] {
  const lookup = provider === 'Other OpenAI-compatible' ? 'OpenAI' : provider
  return MODEL_REGISTRY.filter(model => model.provider === lookup)
}

async function resolveLiveModels({
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

async function resolveCodexModels({
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

async function ensureCodexAuthentication({
  homeDir,
  offline,
  flags,
  io,
}: {
  homeDir: string
  offline: boolean
  flags: InitFlags
  io: InitIO
}): Promise<void> {
  if (offline) return
  let status = codexAuthStatus(homeDir)
  if (status.status === 'active') return
  if (flags.yes) {
    throw new Error('Codex subscription login required; run `harness auth login openai --method browser`')
  }
  const answer = await io.readLine('Authenticate OpenAI Codex subscription now? [Y/n]: ')
  if (answer.trim().toLowerCase() === 'n') throw new Error('Codex subscription login required; run `harness auth login openai --method browser`')
  const code = await runAuthCommand(['login', 'openai', '--method', 'browser'], { homeDir, io: { ...io, error: io.write } })
  if (code !== 0) throw new Error('Codex subscription login failed')
  status = codexAuthStatus(homeDir)
  if (status.status !== 'active') throw new Error('Codex subscription login incomplete')
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

async function chooseModel(models: readonly ModelInfo[], defaultModel: string, ui: InitWizardUI): Promise<string> {
  ui.plain(`Available models (${models.length}):`)
  models.forEach((model, index) => ui.plain(`  ${index + 1}. ${model.id}${model.label !== model.id ? ` — ${model.label}` : ''}`))
  ui.plain('Choose a number or enter a custom model ID.')
  while (true) {
    const answer = (await ui.prompt(`Choose model [${defaultModel}]`, '')).trim()
    if (!answer) return defaultModel
    if (/^\d+$/.test(answer)) {
      const index = Number(answer)
      if (index >= 1 && index <= models.length) return models[index - 1].id
      ui.plain(`Choose a number from 1 to ${models.length}, or enter a model ID.`)
      continue
    }
    if (/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/.test(answer)) return answer
    ui.plain('Invalid model ID. Enter a model ID without spaces or control characters.')
  }
}

async function chooseSurface(defaultSurface: string, ui: InitWizardUI): Promise<typeof SURFACES[number]> {
  ui.panel('Surface', ['1. TUI', '2. CLI', '3. Web'])
  const answer = await ui.prompt(`Choose surface [${defaultSurface}]`, '')
  if (!answer.trim()) return SURFACES.includes(defaultSurface as any) ? defaultSurface as typeof SURFACES[number] : 'tui'
  const index = choiceIndex(answer, SURFACES.length, SURFACES.indexOf(defaultSurface as any))
  return SURFACES[index]
}

function choiceIndex(answer: string, length: number, fallback: number): number {
  if (!answer.trim()) return fallback
  const numeric = Number.parseInt(answer, 10)
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= length ? numeric - 1 : fallback
}

async function ask(label: string, fallback: string, ui: InitWizardUI): Promise<string> {
  const answer = await ui.prompt(`${label} [${fallback}]`, '')
  return answer.trim() || fallback
}

function providerForBaseUrl(baseUrl: string): string {
  if (baseUrl.replace(/\/+$/, '') === 'https://api.anthropic.com/v1') return 'Anthropic'
  if (baseUrl.replace(/\/+$/, '') === 'https://api.openai.com/v1') return 'OpenAI'
  return 'Other OpenAI-compatible'
}

function baseUrlForProvider(provider: string, current: string): string {
  if (provider === 'Anthropic') return 'https://api.anthropic.com/v1'
  if (provider === 'OpenAI') return 'https://api.openai.com/v1'
  return current
}

async function confirmModelChange(profilePath: string | undefined, model: Profile['model'], flags: InitFlags, io: InitIO, now: () => Date): Promise<boolean> {
  if (!profilePath) return false
  const before = readFileSync(profilePath, 'utf-8')
  let after = replaceModelBlock(before, model)
  const helperChanges: string[] = []
  if (model.auth === 'codex_oauth') {
    after = after.replace(/^(models|safety|context|context_window|improvement):[^\n]*\n(?:[ \t]+.*(?:\n|$)|\n)*/gm, block => block.replace(/^(\s+(?:cheap|balanced|frontier|critic|classifier_model_id|digest_model_id|model_id):)\s*[^\n]+/gm, (line, key: string) => {
      const replacement = `${key} ${model.id}`
      if (line !== replacement) helperChanges.push(`- ${line.trim()}\n+ ${replacement.trim()}`)
      return replacement
    }))
  }
  ProfileSchema.parse(loadYaml(after))
  io.write(`\nProfile model diff (${profilePath}):\n- ${profileModelSummary(before)}\n+ ${model.auth === 'codex_oauth' ? 'Codex subscription' : model.base_url} / ${model.id} / ${model.api_key_env ?? 'OAuth'}`)
  if (helperChanges.length) io.write(`Helper model changes:\n${helperChanges.join('\n')}`)
  if (flags.yes) return false
  const answer = await io.readLine('Apply this model change? [y/N]: ')
  if (answer.trim().toLowerCase() !== 'y') return false
  copyFileSync(profilePath, `${profilePath}.bak-${backupStamp(now())}`)
  writeFileSync(profilePath, after, 'utf-8')
  return true
}

function replaceModelBlock(content: string, model: Profile['model']): string {
  const match = /^model:\r?\n(?:[ \t]+.*(?:\r?\n|$))*/m.exec(content)
  if (!match) throw new Error('profile has no model block')
  const fallback = `  fallback_id: ${model.id}\n`
  if (model.auth === 'codex_oauth') return content.replace(match[0], `model:\n  auth: codex_oauth\n  id: ${model.id}\n${fallback}  codex:\n    max_model_calls_per_run: 64\n    request_timeout_ms: 120000\n`)
  const replacement = `model:\n  base_url: ${model.base_url}\n  api_key_env: ${model.api_key_env}\n  id: ${model.id}\n${fallback}`
  return content.replace(match[0], replacement)
}

function profileModelSummary(content: string): string {
  const match = /^model:\r?\n(?:[ \t]+.*(?:\r?\n|$))*/m.exec(content)
  return match?.[0].trim().replace(/\s+/g, ' ') ?? 'unknown model'
}

function userConfigPath(homeDir: string): string { return join(homeDir, '.harness', 'config.json') }

function backupStamp(now: Date): string { return now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) }

function backupFile(path: string, now: () => Date, io: InitIO, quiet = false): void {
  if (!existsSync(path)) return
  const backup = `${path}.bak-${backupStamp(now())}`
  mkdirSync(join(path, '..'), { recursive: true })
  copyFileSync(path, backup)
  if (path.endsWith('/env')) chmodSync(backup, 0o600)
  if (!quiet) io.write(`Backed up ${path} → ${backup}`)
}

function defaultIO(): InitIO {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const readLine = (prompt: string) => new Promise<string>(resolve => rl.question(prompt, resolve))
  const readSecret = async (prompt: string): Promise<string> => {
    const input = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void }
    if (!input.isTTY || !input.setRawMode) throw new Error('API key input requires an interactive TTY')
    process.stdout.write(prompt)
    rl.pause()
    input.setRawMode(true)
    input.resume()
    return new Promise(resolve => {
      let value = ''
      const finish = () => {
        input.off('data', onData)
        input.setRawMode?.(false)
        input.pause()
        rl.resume()
        process.stdout.write('\n')
        resolve(value)
      }
      const onData = (chunk: Buffer | string) => {
        for (const char of String(chunk)) {
          if (char === '\u0003') { value = ''; finish(); return }
          if (char === '\r' || char === '\n') { finish(); return }
          if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue }
          value += char
          process.stdout.write('*')
        }
      }
      input.on('data', onData)
    })
  }
  return { write: line => console.log(line), readLine, readSecret, close: () => rl.close() }
}

function uiError(io: InitIO, message: string): void {
  io.write(`${THEME.error}[x]${THEME.reset} ${message}`)
}

function createInitUI(io: InitIO): InitWizardUI {
  const ansi =
    process.stdout?.isTTY === true &&
    process.stderr?.isTTY !== false &&
    process.env.TERM !== 'dumb'
  const width = 64
  const muted = (value: string) => ansi ? `${THEME.dim}${value}${THEME.reset}` : value
  const accent = (value: string) => ansi ? `${THEME.accent}${value}${THEME.reset}` : value
  const bright = (value: string) => ansi ? `${THEME.bold}${value}${THEME.reset}` : value
  const bar = (step: number, total: number) => {
    const safeStep = Math.max(0, Math.min(total, step))
    const done = '#'.repeat(safeStep)
    const remain = '.'.repeat(total - safeStep)
    return `${done}${remain}`
  }
  const pad = (value: string, total: number) => value.length >= total ? value.slice(0, total) : `${value}${' '.repeat(total - value.length)}`
  const frame = (title: string, body: string[]) => {
    const top = `+${'-'.repeat(width - 2)}+`
    const bottom = `+${'-'.repeat(width - 2)}+`
    const middle = body.map(line => `| ${pad(line, width - 4)} |`)
    return [accent(top), ...middle, accent(bottom)].join('\n')
  }

  return {
    step: (index, label) => {
      io.write('')
      const resolved = WIZARD_STEPS[index - 1] ?? label
      const title = index === 0 ? label : `${index}. ${resolved}`
      io.write(frame(`${title}`, [
        `${muted(`[${index}/${WIZARD_TOTAL_STEPS}]`)} ${bright(`${bar(index, WIZARD_TOTAL_STEPS)} ${label}`)}`,
        '',
      ]))
      io.write('')
    },
    panel: (title, lines) => {
      io.write('')
      io.write(frame(`${title}`, [bright(title), ...lines]))
      io.write('')
    },
    status: (label, value) => io.write(`${muted(label)}: ${accent(value)}`),
    prompt: async (label, fallback) => {
      const prompt = fallback ? `${label} [${fallback}]` : label
      return io.readLine(`${muted(prompt)}: `)
    },
    readSecret: async (label) => io.readSecret(`${label}: `),
    check: (name, ok, detail, fix) => io.write(`${ok ? `${THEME.ok}[ok]` : `${THEME.error}[x]`}${THEME.reset} ${name}: ${detail}${ok ? '' : ` ${THEME.warn}; fix: ${fix}${THEME.reset}`}`),
    done: (surface) => {
      io.write('')
      io.write(bright(`Setup complete`))
      io.write(`${muted('Launch:')} ${THEME.ok}harness${surface === 'tui' ? '' : ` ${surface}`}${THEME.reset}`)
      io.write(muted(`Tip: for the full UI, run "harness tui"`))
    },
    plain: (line) => io.write(line),
  }
}
