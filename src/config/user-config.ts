import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export type UserSurface = 'tui' | 'cli' | 'web'

export interface UserConfig {
  version: 1
  default_profile: string
  profiles_dir: string
  surface: UserSurface
  initialised_at: string
  harness_version: string
  [key: string]: unknown
}

export interface ResolveDefaultProfileOptions {
  explicitProfile?: string
  environment?: NodeJS.ProcessEnv
  homeDir?: string
}

export function userConfigPath(homeDir = homedir()): string {
  return join(homeDir, '.harness', 'config.json')
}

export function readUserConfig(homeDir = homedir()): UserConfig | undefined {
  const path = userConfigPath(homeDir)
  if (!existsSync(path)) return undefined
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (!isUserConfig(value)) return undefined
    return value
  } catch {
    return undefined
  }
}

export function writeUserConfig(config: UserConfig, homeDir = homedir()): void {
  const path = userConfigPath(homeDir)
  mkdirSync(join(homeDir, '.harness'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
}

export function resolveDefaultProfile(options: ResolveDefaultProfileOptions = {}): string {
  if (options.explicitProfile) return options.explicitProfile
  const environment = options.environment ?? process.env
  if (environment.HARNESS_PROFILE) return environment.HARNESS_PROFILE
  return readUserConfig(options.homeDir)?.default_profile ?? 'coding'
}

function isUserConfig(value: unknown): value is UserConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const config = value as Record<string, unknown>
  return config.version === 1
    && typeof config.default_profile === 'string'
    && config.default_profile.length > 0
    && typeof config.profiles_dir === 'string'
    && typeof config.surface === 'string'
    && ['tui', 'cli', 'web'].includes(config.surface)
    && typeof config.initialised_at === 'string'
    && typeof config.harness_version === 'string'
}
