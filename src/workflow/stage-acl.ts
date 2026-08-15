import type { AclValue } from '../types.js'
import { EFFECTS, effectFor, isMutatingEffect } from '../tools/effects.js'
import type { Stage } from './types.js'

export type StageAclOverlay = Partial<Record<string, AclValue>>

// Fixed tools come from EFFECTS; named sub-agents inherit this overlay through
// their sub-loop context instead of being duplicated as profile-specific names.
const READ_ONLY_TOOLS: StageAclOverlay = Object.fromEntries(
  Object.keys(EFFECTS)
    .filter(tool => isMutatingEffect(effectFor(tool)))
    .map(tool => [tool, 'deny']),
) as StageAclOverlay

/** Planning stages may inspect, but must not mutate the workspace. */
export function stageAcl(stage: Stage): StageAclOverlay {
  return stage === 'recon' || stage === 'plan' || stage === 'design'
    ? { ...READ_ONLY_TOOLS }
    : {}
}
