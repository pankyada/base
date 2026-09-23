import type { Session } from '../session/types.js'
import type { MemoryProvider } from '../memory/interface.js'

export interface ProposedSkill {
  name: string
  description: string
  content: string
}

export interface ProposedPlaybook {
  name: string
  path: string
}

export interface Improver {
  reflect(session: Session, memory: MemoryProvider): Promise<void>
  mineSkills(sessions: Session[]): Promise<ProposedSkill[]>
  /**
   * Roadmap #31 phase 6 (PT-081, spec §6 item 4). Optional: proposes at most
   * one new playbook from clustered low-confidence routing misses, or
   * returns `null` when mining is disabled, there isn't enough data yet, or
   * no coherent proposal could be made. Never auto-installs — writes only
   * under the caller's `_proposed` playbooks directory.
   */
  minePlaybooks?(): Promise<ProposedPlaybook | null>
}
