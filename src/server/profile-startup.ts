import { existsSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { readUserConfig, resolveDefaultProfile } from '../config/user-config.js'
import { loadProfile } from '../profiles/loader.js'
import { loadProfileDirectory, type ProfileRegistry } from '../profiles/registry.js'

export interface LoadStartupProfilesOptions {
  configuredPath?: string
  explicitDefaultProfile?: string
  environment?: NodeJS.ProcessEnv
  homeDir?: string
}

/**
 * Resolve server startup through the shipped profile directory registry.
 * A config default is a profile name, never another profile path.
 */
export function loadStartupProfiles(options: LoadStartupProfilesOptions = {}): ProfileRegistry {
  const homeDir = options.homeDir ?? homedir()
  const config = readUserConfig(homeDir)
  const defaultName = resolveDefaultProfile({
    explicitProfile: options.explicitDefaultProfile,
    environment: options.environment,
    homeDir,
  })
  const configuredPath = options.configuredPath && resolve(options.configuredPath)
  const profilesDir = configuredPath
    ?? resolveConfigPath(config?.profiles_dir ?? join(homeDir, '.harness', 'profiles'), homeDir)
  const profilePath = directoryExists(profilesDir)
    ? profilesDir
    : configuredPath ?? join(homeDir, '.harness', 'profiles', 'coding.yaml')

  if (directoryExists(profilePath)) return loadProfileDirectory(profilePath, defaultName)
  const single = loadProfile(profilePath)
  return { profiles: new Map([[single.name, single]]), defaultProfile: single, errors: [] }
}

function directoryExists(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory()
}

function resolveConfigPath(path: string, homeDir: string): string {
  if (path === '~') return homeDir
  if (path.startsWith('~/')) return join(homeDir, path.slice(2))
  return resolve(path)
}
