import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { createInterface } from 'readline'
import { join } from 'path'
import { MODEL_REGISTRY } from '../models/registry.js'
import type { ModelInfo } from '../types.js'
import { loadProfile } from '../profiles/loader.js'
import { loadStartupProfiles } from '../server/profile-startup.js'
import { readUserConfig, writeUserConfig } from '../config/user-config.js'
import { loadUserEnv, userEnvPath, writeUserEnv } from '../config/user-env.js'
import { runDoctor, type DoctorResult } from './doctor.js'
import pkg from '../../package.json' with { type: 'json' }

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

export async function runInit(args: string[] = [], options: InitOptions = {}): Promise<number> {
  const flags = parseFlags(args)
  const homeDir = options.homeDir ?? homedir()
  const environment = options.environment ?? process.env
  const io = options.io ?? defaultIO()
  const close = io.close
  const now = options.now ?? (() => new Date())

  try {
    const existing = readUserConfig(homeDir)
    if (flags.reconfigure) {
      backupFile(userConfigPath(homeDir), now, io)
      backupFile(userEnvPath(homeDir), now, io)
    }

    const registry = loadStartupProfiles({ homeDir, environment, explicitDefaultProfile: flags.profile })
    const useCases = [...registry.profiles.values()]
      .filter(profile => profile.use_case)
      .sort((left, right) => (left.use_case!.rank - right.use_case!.rank) || left.name.localeCompare(right.name))
    if (!useCases.length) throw new Error('no profiles declare use_case metadata; add use_case: to a profile')

    const selected = flags.profile
      ? registry.profiles.get(flags.profile)
      : flags.yes
        ? useCases[0]
        : await chooseProfile(useCases, io)
    if (!selected) throw new Error(`unknown profile "${flags.profile}"; available: ${[...registry.profiles.keys()].sort().join(', ')}`)

    let profile = selected
    io.write(`\nSelected profile: ${profile.name}`)
    const defaultProvider = providerForBaseUrl(profile.model.base_url)
    const provider = flags.yes ? defaultProvider : await chooseProvider(defaultProvider, io)
    const baseUrl = provider === 'Other OpenAI-compatible' ? await ask(io, 'Base URL', profile.model.base_url) : baseUrlForProvider(provider, profile.model.base_url)
    const models = MODEL_REGISTRY.filter(model => model.provider === provider)
    const defaultModel = models.some(model => model.id === profile.model.id) ? profile.model.id : models[0]?.id ?? profile.model.id
    const model = flags.yes ? defaultModel : await chooseModel(models, defaultModel, io)
    const apiKeyEnv = provider === 'Anthropic' ? 'ANTHROPIC_API_KEY' : provider === 'OpenAI' ? 'OPENAI_API_KEY' : profile.model.api_key_env
    const ambientKey = environment[apiKeyEnv]
    loadUserEnv(homeDir, environment)
    let key = environment[apiKeyEnv]
    if (!ambientKey || flags.reconfigure) {
      if (flags.yes && !key) throw new Error(`API key required for ${apiKeyEnv}; rerun without --yes`)
      if (!flags.yes) {
        key = await io.readSecret(`\nAPI key for ${apiKeyEnv}: `)
        if (!key) throw new Error(`API key required for ${apiKeyEnv}`)
        if (!flags.reconfigure) backupFile(userEnvPath(homeDir), now, io, true)
        writeUserEnv(apiKeyEnv, key, homeDir)
        environment[apiKeyEnv] = key
      }
    }

    const selectedModel = { base_url: baseUrl, api_key_env: apiKeyEnv, id: model }
    if (profile.model.base_url !== selectedModel.base_url || profile.model.api_key_env !== selectedModel.api_key_env || profile.model.id !== selectedModel.id) {
      const applied = await confirmModelChange(profile.profile_path, selectedModel, flags, io, now)
      if (applied && profile.profile_path) profile = loadProfile(profile.profile_path)
      else io.write('model change declined; keeping the existing profile model')
    }

    const surface = flags.yes ? 'tui' : await chooseSurface(existing?.surface ?? 'tui', io)
    const config = {
      ...(existing ?? {}),
      version: 1 as const,
      default_profile: profile.name,
      profiles_dir: existing?.profiles_dir ?? '~/.harness/profiles',
      surface,
      initialised_at: now().toISOString(),
      harness_version: pkg.version,
    }
    writeUserConfig(config, homeDir)
    io.write(`\nWrote ${join(homeDir, '.harness', 'config.json')} (default profile: ${profile.name})`)
    if (existsSync(userEnvPath(homeDir))) io.write(`Wrote ${userEnvPath(homeDir)} (mode 0600)`)

    io.write(flags.offline ? 'Checking… skipped (--offline)' : 'Checking…')
    const result = await (options.doctor ?? runDoctor)({ homeDir, environment, offline: flags.offline })
    for (const check of result.checks) io.write(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}${check.ok ? '' : `; fix: ${check.fix}`}`)
    if (!result.ok) return 1
    io.write(`\nStart with: harness${surface === 'tui' ? '' : ` ${surface}`}`)
    return 0
  } catch (error: any) {
    io.write(`init failed: ${error?.message ?? String(error)}`)
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

async function chooseProfile(profiles: any[], io: InitIO): Promise<any> {
  io.write('\n1. What will you mostly use this for?')
  profiles.forEach((profile, index) => io.write(`  ${index + 1}. ${profile.use_case.label} — ${profile.use_case.blurb} (${profile.name})`))
  const answer = await io.readLine('Choose a use case [1]: ')
  return profiles[choiceIndex(answer, profiles.length, 0)]
}

async function chooseProvider(defaultProvider: string, io: InitIO): Promise<string> {
  const providers = ['Anthropic', 'OpenAI', 'Other OpenAI-compatible']
  io.write('\n2. Provider?')
  providers.forEach((provider, index) => io.write(`  ${index + 1}. ${provider}`))
  const answer = await io.readLine(`Choose provider [${defaultProvider}]: `)
  if (!answer.trim()) return defaultProvider
  const index = choiceIndex(answer, providers.length, providers.indexOf(defaultProvider))
  return providers[index]
}

async function chooseModel(models: readonly ModelInfo[], defaultModel: string, io: InitIO): Promise<string> {
  io.write('\n3. Model?')
  models.slice(0, 12).forEach((model, index) => io.write(`  ${index + 1}. ${model.label} (${model.id})`))
  const answer = await io.readLine(`Choose model [${defaultModel}]: `)
  if (!answer.trim()) return defaultModel
  const index = Number.parseInt(answer, 10)
  if (Number.isInteger(index) && index >= 1 && index <= Math.min(models.length, 12)) return models[index - 1].id
  return models.find(model => model.id === answer.trim())?.id ?? defaultModel
}

async function chooseSurface(defaultSurface: string, io: InitIO): Promise<typeof SURFACES[number]> {
  io.write('\n6. Preferred surface?  1. TUI  2. CLI  3. Web')
  const answer = await io.readLine(`Choose surface [${defaultSurface}]: `)
  if (!answer.trim()) return SURFACES.includes(defaultSurface as any) ? defaultSurface as typeof SURFACES[number] : 'tui'
  const index = choiceIndex(answer, SURFACES.length, SURFACES.indexOf(defaultSurface as any))
  return SURFACES[index]
}

function choiceIndex(answer: string, length: number, fallback: number): number {
  if (!answer.trim()) return fallback
  const numeric = Number.parseInt(answer, 10)
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= length ? numeric - 1 : fallback
}

async function ask(io: InitIO, label: string, fallback: string): Promise<string> {
  const answer = await io.readLine(`${label} [${fallback}]: `)
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

async function confirmModelChange(profilePath: string | undefined, model: { base_url: string; api_key_env: string; id: string }, flags: InitFlags, io: InitIO, now: () => Date): Promise<boolean> {
  if (!profilePath) return false
  const before = readFileSync(profilePath, 'utf-8')
  const after = replaceModelBlock(before, model)
  io.write(`\nProfile model diff (${profilePath}):\n- ${profileModelSummary(before)}\n+ ${model.base_url} / ${model.id} / ${model.api_key_env}`)
  if (flags.yes) return false
  const answer = await io.readLine('Apply this model change? [y/N]: ')
  if (answer.trim().toLowerCase() !== 'y') return false
  copyFileSync(profilePath, `${profilePath}.bak-${backupStamp(now())}`)
  writeFileSync(profilePath, after, 'utf-8')
  return true
}

function replaceModelBlock(content: string, model: { base_url: string; api_key_env: string; id: string }): string {
  const match = /^model:\r?\n(?:[ \t]+.*(?:\r?\n|$))*/m.exec(content)
  if (!match) throw new Error('profile has no model block')
  const fallback = `  fallback_id: ${model.id}\n`
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
