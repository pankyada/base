import type { Session } from '../session/types.js'
import type { MemoryProvider } from '../memory/interface.js'

export interface ProposedSkill {
  name: string
  description: string
  content: string
}

export interface Improver {
  reflect(session: Session, memory: MemoryProvider): Promise<void>
  mineSkills(sessions: Session[]): Promise<ProposedSkill[]>
}
