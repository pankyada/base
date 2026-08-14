import { existsSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import type { Profile } from './schema.js'
import { loadProfile } from './loader.js'

export interface ProfileRegistry {
  profiles: Map<string, Profile>
  defaultProfile: Profile
  errors: Array<{ path: string; error: string }>
}

export function loadProfileDirectory(path: string, defaultName?: string): ProfileRegistry {
  const dir = resolve(path)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`profile directory not found: ${dir}`)
  const profiles = new Map<string, Profile>()
  const errors: Array<{ path: string; error: string }> = []
  for (const file of readdirSync(dir).filter(item => item.endsWith('.yaml')).sort()) {
    const filePath = join(dir, file)
    try {
      const profile = loadProfile(filePath)
      if (profiles.has(profile.name)) throw new Error(`duplicate profile name "${profile.name}"`)
      profiles.set(profile.name, profile)
    } catch (error: any) {
      errors.push({ path: filePath, error: error.message })
    }
  }
  if (profiles.size === 0) throw new Error(`profile directory has no valid YAML profiles: ${dir}`)
  return { profiles, defaultProfile: selectProfile(profiles, defaultName), errors }
}

export function selectProfile(profiles: Map<string, Profile>, requested?: string): Profile {
  if (requested) {
    const selected = profiles.get(requested)
    if (selected) return selected
    throw new Error(`unknown profile "${requested}"; available: ${[...profiles.keys()].sort().join(', ')}`)
  }
  const coding = profiles.get('coding')
  if (coding) return coding
  const name = [...profiles.keys()].sort()[0]
  return profiles.get(name)!
}
