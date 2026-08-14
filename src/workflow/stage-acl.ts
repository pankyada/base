import type { AclValue } from '../types.js'
import type { Stage } from './types.js'

export type StageAclOverlay = Partial<Record<string, AclValue>>

const READ_ONLY_TOOLS: StageAclOverlay = {
  Write: 'deny',
  Edit: 'deny',
  Bash: 'deny',
  ExecuteCode: 'deny',
  Delegate: 'deny',
  MemoryDelete: 'deny',
}

/** Planning stages may inspect, but must not mutate the workspace. */
export function stageAcl(stage: Stage): StageAclOverlay {
  return stage === 'recon' || stage === 'plan' || stage === 'design'
    ? { ...READ_ONLY_TOOLS }
    : {}
}
