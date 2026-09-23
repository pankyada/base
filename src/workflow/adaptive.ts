import type { Tier, Stage } from './types.js'
import { demoteTier, promoteTier, tierIndex } from './policy.js'

export interface RoutingCell {
  tier: Tier
  n: number
  first_try: number
  rework_rate: number
  consecutive_escalations?: number
  reversibility?: string
}

// playbook -> task class -> stage -> routing cell
export type RoutingPolicyDoc = Record<string, Record<string, Partial<Record<Stage, RoutingCell>>>> & { router?: RouterOverrides }

// Roadmap #31 phase 6 (PT-081, spec §6): tuned router thresholds, read only
// when `workflow.routing.policy === 'adaptive'` and only ever written by a
// human/operator reviewing `harness stats routing --suggest` output — nothing
// in this codebase writes the `router` key automatically.
export interface RouterOverrides {
  ask_threshold?: number
  domain_thresholds?: Record<string, number>
}

function floorFor(floor: Tier | Partial<Record<Stage, Tier>>, stage: Stage): Tier {
  return typeof floor === 'string' ? floor : floor[stage] ?? 'cheap'
}

export function updateRoutingPolicy(
  report: { cells: Record<string, RoutingCell> },
  current: RoutingPolicyDoc,
  floor: Tier | Partial<Record<Stage, Tier>> = 'cheap',
  playbook = 'coding',
): RoutingPolicyDoc {
  const next = structuredClone(current)
  const playbookDoc = next[playbook] ?? (next[playbook] = {})
  for (const [key, cell] of Object.entries(report.cells)) {
    if (cell.n < 8 || cell.reversibility === 'irreversible') continue
    const [taskClass, stage] = key.split('|') as [string, Stage]
    if (!taskClass || !stage) continue
    const taskDoc = playbookDoc[taskClass] ?? (playbookDoc[taskClass] = {})
    const existing = taskDoc[stage] ?? cell
    const floorTier = floorFor(floor, stage)
    let tier = existing.tier
    if (cell.first_try >= 0.85 && cell.rework_rate <= 0.1 && tierIndex(tier) > tierIndex(floorTier)) {
      tier = demoteTier(tier)
      if (tierIndex(tier) < tierIndex(floorTier)) tier = floorTier
    }
    if ((cell.consecutive_escalations ?? 0) >= 2) tier = promoteTier(tier)
    taskDoc[stage] = { ...existing, ...cell, tier }
  }
  return next
}

// A value in [0, 1], the only shape `ask_threshold` / a `domain_thresholds`
// entry may take.
function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

// Invalid per spec §6 item 3 ("validated 0-1; invalid ignored"): a malformed
// `router` block is dropped rather than failing the whole doc, so an
// operator's typo in tuned thresholds can't silently break the unrelated
// per-stage tier policy that shares this same memory document.
function parseRouterOverrides(value: unknown): RouterOverrides | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as { ask_threshold?: unknown; domain_thresholds?: unknown }
  const result: RouterOverrides = {}
  if (candidate.ask_threshold !== undefined) {
    if (!isUnitInterval(candidate.ask_threshold)) return undefined
    result.ask_threshold = candidate.ask_threshold
  }
  if (candidate.domain_thresholds !== undefined) {
    if (!candidate.domain_thresholds || typeof candidate.domain_thresholds !== 'object' || Array.isArray(candidate.domain_thresholds)) return undefined
    const thresholds: Record<string, number> = {}
    for (const [name, threshold] of Object.entries(candidate.domain_thresholds as Record<string, unknown>)) {
      if (!isUnitInterval(threshold)) return undefined
      thresholds[name] = threshold
    }
    result.domain_thresholds = thresholds
  }
  return result
}

export function parseRoutingPolicy(raw: string | undefined): RoutingPolicyDoc | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const tiers = new Set<Tier>(['cheap', 'balanced', 'frontier', 'critic'])
    let router: RouterOverrides | undefined
    for (const [key, playbook] of Object.entries(parsed as Record<string, unknown>)) {
      if (key === 'router') { router = parseRouterOverrides(playbook); continue }
      if (!playbook || typeof playbook !== 'object' || Array.isArray(playbook)) return undefined
      for (const task of Object.values(playbook as Record<string, unknown>)) {
        if (!task || typeof task !== 'object' || Array.isArray(task)) return undefined
        for (const cell of Object.values(task as Record<string, unknown>)) {
          if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return undefined
          const tier = (cell as { tier?: unknown }).tier
          if (tier !== undefined && (typeof tier !== 'string' || !tiers.has(tier as Tier))) return undefined
        }
      }
    }
    const result = parsed as RoutingPolicyDoc
    if (router !== undefined) result.router = router
    else delete result.router
    return result
  } catch {
    return undefined
  }
}
