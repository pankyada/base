import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Profile } from '../profiles/schema.js'

/**
 * Opt-in store of requests the router could not place (roadmap #31 phase 6,
 * PT-081), consumed only by playbook mining. Deliberately a plain file under
 * the profile's artifact dir and NOT project memory: project memory is
 * rendered into every session's system prompt, and these are raw request
 * excerpts.
 */
export interface RoutingMiss { at: string; excerpt: string; max_domain_p: number }

export const MAX_ROUTING_MISSES = 200
export const MAX_MISS_EXCERPT = 500

export function routingMissesPath(profile: Pick<Profile, 'artifact_dir'>): string {
  return join(profile.artifact_dir, 'routing', 'misses.json')
}

export function readRoutingMisses(profile: Pick<Profile, 'artifact_dir'>): RoutingMiss[] {
  const path = routingMissesPath(profile)
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeRoutingMisses(profile: Pick<Profile, 'artifact_dir'>, misses: RoutingMiss[]): void {
  const path = routingMissesPath(profile)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(misses), 'utf8')
}

export function appendRoutingMiss(profile: Pick<Profile, 'artifact_dir'>, request: string, maxDomainP: number): void {
  const misses = readRoutingMisses(profile)
  misses.push({ at: new Date().toISOString(), excerpt: request.slice(0, MAX_MISS_EXCERPT), max_domain_p: maxDomainP })
  writeRoutingMisses(profile, misses.slice(-MAX_ROUTING_MISSES))
}

export function clearRoutingMisses(profile: Pick<Profile, 'artifact_dir'>): void {
  writeRoutingMisses(profile, [])
}
