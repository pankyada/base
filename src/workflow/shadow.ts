import type { Profile } from '../profiles/schema.js'
import type { TaskPlan, Stage, Tier } from './types.js'
import { resolveRole } from '../profiles/schema.js'

export interface ShadowOptions {
  chosenTier?: Tier
  rng?: () => number
}

export interface ShadowResult {
  chosen: string
  shadow: string
  verdict?: string
  chosenTier: Tier
  shadowTier: 'cheap'
}

/** Run paired plan/design artifacts without exposing tier/model labels to judge. */
export async function maybeShadow(
  stage: Stage,
  plan: TaskPlan,
  profile: Profile,
  run: (modelId: string) => Promise<string>,
  judge: (input: string, modelId: string) => Promise<string>,
  options: ShadowOptions | (() => number) = {},
): Promise<ShadowResult | null> {
  if (stage !== 'plan' && stage !== 'design') return null
  const normalized = typeof options === 'function' ? { rng: options } : options
  const rng = normalized.rng ?? Math.random
  if (rng() >= (profile.workflow?.routing.shadow_rate ?? 0.05)) return null
  const chosenTier = normalized.chosenTier ?? 'balanced'
  const chosenModel = resolveRole(profile, chosenTier)
  const cheapModel = resolveRole(profile, 'cheap')
  try {
    const [chosen, shadow] = await Promise.all([run(chosenModel), run(cheapModel)])
    const order = rng() < 0.5 ? [chosen, shadow] : [shadow, chosen]
    const verdict = await judge(`Artifact A:\n${order[0]}\n\nArtifact B:\n${order[1]}`, resolveRole(profile, 'critic'))
    return { chosen, shadow, verdict, chosenTier, shadowTier: 'cheap' }
  } catch {
    return null
  }
}
