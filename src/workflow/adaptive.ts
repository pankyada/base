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
export type RoutingPolicyDoc = Record<string, Record<string, Partial<Record<Stage, RoutingCell>>>>

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

export function parseRoutingPolicy(raw: string | undefined): RoutingPolicyDoc | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const tiers = new Set<Tier>(['cheap', 'balanced', 'frontier', 'critic'])
    for (const playbook of Object.values(parsed as Record<string, unknown>)) {
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
    return parsed as RoutingPolicyDoc
  } catch {
    return undefined
  }
}
