import type { Profile } from '../profiles/schema.js'
import { resolveRole } from '../profiles/schema.js'
import type { Stage, Tier, Reversibility } from './types.js'
import type { RoutingPolicyDoc } from './adaptive.js'

const ORDER: Tier[] = ['cheap', 'balanced', 'frontier']

export function resolveTier(profile: Profile, stage: Stage, taskClass?: string, adaptive?: RoutingPolicyDoc, playbook = profile.workflow?.playbook ?? 'generic'): { tier: Tier; modelId: string; explore: boolean } {
  const adaptiveTier = profile.workflow?.routing.policy === 'adaptive' && taskClass ? adaptive?.[playbook]?.[taskClass]?.[stage]?.tier : undefined
  const tier = adaptiveTier ?? profile.workflow?.routing.table?.[stage] ?? 'balanced'
  return { tier, modelId: resolveRole(profile, tier), explore: false }
}

export function promoteTier(tier: Tier): Tier {
  if (tier === 'cheap') return 'balanced'
  if (tier === 'balanced') return 'frontier'
  return tier
}

export function demoteTier(tier: Tier): Tier {
  if (tier === 'frontier') return 'balanced'
  if (tier === 'balanced') return 'cheap'
  return 'cheap'
}

export function chooseExploration(
  profile: Profile,
  tier: Tier,
  reversibility: Reversibility,
  remainingBudgetRatio: number,
  rng = Math.random,
): { tier: Tier; explore: boolean } {
  const rate = profile.workflow?.routing.explore_rate ?? 0.12
  if (rng() >= rate || reversibility === 'irreversible' || remainingBudgetRatio < 0.25) return { tier, explore: false }
  const idx = ORDER.indexOf(tier === 'critic' ? 'frontier' : tier)
  const direction = rng() < 0.5 ? -1 : 1
  const next = Math.max(0, Math.min(ORDER.length - 1, idx + direction))
  return { tier: ORDER[next], explore: next !== idx }
}

export function tierIndex(tier: Tier): number { return tier === 'cheap' ? 0 : tier === 'balanced' ? 1 : tier === 'frontier' ? 2 : 3 }
