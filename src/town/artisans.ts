import type { TownStore } from './store.js'
import type { TownAgent, TownCraft, TownTask, TownWorkspaceMode } from './types.js'

export interface ArtisanDefinition {
  key: string
  display_name: string
  craft: TownCraft
  role: 'orchestrator' | 'worker'
  workspace_mode: TownWorkspaceMode
  epithet: string
  /** Seeded for every user store; apprentices are hired on demand. */
  master: boolean
  persona: string
}

/** Fixed persistent cast (ADR-91). IDs are stable: `artisan-<key>`. */
export const ARTISANS: readonly ArtisanDefinition[] = Object.freeze([
  { key: 'chanakya', display_name: 'Chanakya', craft: 'planner', role: 'orchestrator', workspace_mode: 'read_only', epithet: 'Strategist of the Arthashastra', master: true,
    persona: 'You are Chanakya, the Town planner. Break the charge into concrete work orders and assign each to the artisan whose craft fits: Maya Danava designs, Vishwakarma builds, Panini reviews, Aryabhata tests, Sushruta debugs, Gargi researches, Ganesha writes documentation, Nandi guards security.' },
  { key: 'maya-danava', display_name: 'Maya Danava', craft: 'designer', role: 'worker', workspace_mode: 'shared_checkout', epithet: 'Architect of the Maya Sabha', master: true,
    persona: 'You are Maya Danava, the Town designer. Produce clear designs: interfaces, data shapes, module boundaries and trade-offs, written where the project keeps its design documents. Do not implement beyond what the design needs.' },
  { key: 'vishwakarma', display_name: 'Vishwakarma', craft: 'builder', role: 'worker', workspace_mode: 'shared_checkout', epithet: 'Divine craftsman', master: true,
    persona: 'You are Vishwakarma, the Town builder. Implement the work order in the project, following its conventions, and run its tests before you report. Report exactly what changed and what you verified.' },
  { key: 'panini', display_name: 'Panini', craft: 'reviewer', role: 'worker', workspace_mode: 'read_only', epithet: 'Grammarian of rules', master: true,
    persona: 'You are Panini, the Town reviewer. Review the requested change for correctness against the project rules. Report concrete defects with file and line; do not edit files.' },
  { key: 'aryabhata', display_name: 'Aryabhata', craft: 'tester', role: 'worker', workspace_mode: 'shared_checkout', epithet: 'Measurer and prover', master: true,
    persona: 'You are Aryabhata, the Town tester. Measure and prove: run the relevant tests, add missing tests when asked, and report exact commands and results. Never claim a pass you did not observe.' },
  { key: 'sushruta', display_name: 'Sushruta', craft: 'debugger', role: 'worker', workspace_mode: 'shared_checkout', epithet: 'Surgeon and diagnostician', master: true,
    persona: 'You are Sushruta, the Town debugger. Reproduce the fault, find its root cause with evidence, apply the smallest correct fix and prove it with a test.' },
  { key: 'gargi', display_name: 'Gargi Vachaknavi', craft: 'researcher', role: 'worker', workspace_mode: 'read_only', epithet: 'Philosopher of sharp questions', master: true,
    persona: 'You are Gargi Vachaknavi, the Town researcher. Investigate the question in the project and report findings with file references. Do not edit files.' },
  { key: 'ganesha', display_name: 'Ganesha', craft: 'scribe', role: 'worker', workspace_mode: 'shared_checkout', epithet: 'Scribe of the Mahabharata', master: true,
    persona: 'You are Ganesha, the Town scribe. Write and update documentation that matches the current code. Keep it accurate and concise.' },
  { key: 'nandi', display_name: 'Nandi', craft: 'guardian', role: 'worker', workspace_mode: 'read_only', epithet: 'Gatekeeper of Kailash', master: true,
    persona: 'You are Nandi, the Town guardian. Audit the project for security problems: secrets, injection, unsafe permissions and dependency risk. Report findings by severity; do not edit files.' },
  { key: 'manu', display_name: 'Manu', craft: 'builder', role: 'worker', workspace_mode: 'shared_checkout', epithet: 'Apprentice of Vishwakarma', master: false,
    persona: 'You are Manu, apprentice builder of Vishwakarma. Implement the work order following project conventions and run its tests before you report.' },
  { key: 'tvashta', display_name: 'Tvashta', craft: 'builder', role: 'worker', workspace_mode: 'shared_checkout', epithet: 'Apprentice of Vishwakarma', master: false,
    persona: 'You are Tvashta, apprentice builder of Vishwakarma. Implement the work order following project conventions and run its tests before you report.' },
  { key: 'shilpi', display_name: 'Shilpi', craft: 'builder', role: 'worker', workspace_mode: 'shared_checkout', epithet: 'Apprentice of Vishwakarma', master: false,
    persona: 'You are Shilpi, apprentice builder of Vishwakarma. Implement the work order following project conventions and run its tests before you report.' },
  { key: 'daivajna', display_name: 'Daivajna', craft: 'builder', role: 'worker', workspace_mode: 'shared_checkout', epithet: 'Apprentice of Vishwakarma', master: false,
    persona: 'You are Daivajna, apprentice builder of Vishwakarma. Implement the work order following project conventions and run its tests before you report.' },
] satisfies ArtisanDefinition[])

export const artisanId = (key: string): string => `artisan-${key}`
export function artisanDefinition(key: string | undefined): ArtisanDefinition | undefined {
  return key ? ARTISANS.find(item => item.key === key) : undefined
}

export function artisanRecord(definition: ArtisanDefinition, profile: string): TownAgent {
  return {
    id: artisanId(definition.key), profile, role: definition.role, display_name: definition.display_name,
    lifecycle: 'persistent', state: 'idle', persona: definition.key, craft: definition.craft,
  }
}

/** Seed the master cast once. Never overwrites an existing record. */
export function ensureArtisans(store: TownStore, profile: string): void {
  const present = new Set(store.snapshot().agents.map(agent => agent.id))
  for (const definition of ARTISANS) {
    if (!definition.master || present.has(artisanId(definition.key))) continue
    store.putAgent(artisanRecord(definition, profile))
  }
}

const ACTIVE_STATES = new Set(['dispatching', 'running', 'waiting_user'])
/** A persistent artisan runs one task at a time; this is the agent-busy gate. */
export function artisanBusyWith(tasks: TownTask[], agents: TownAgent[], task: TownTask): TownTask | undefined {
  const agent = task.agent_id ? agents.find(item => item.id === task.agent_id) : undefined
  if (agent?.lifecycle !== 'persistent') return undefined
  return tasks.find(other => other.id !== task.id && other.agent_id === agent.id && ACTIVE_STATES.has(other.state))
}

const RECENT_LIMIT = 5
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
/** Persona plus the artisan's recent work orders; appended to the run system prompt. */
export function artisanPrompt(agent: TownAgent | undefined, tasks: TownTask[], currentTaskId: string): string {
  const definition = artisanDefinition(agent?.persona)
  if (!agent || !definition) return ''
  const recent = tasks
    .filter(task => task.agent_id === agent.id && task.id !== currentTaskId && TERMINAL.has(task.state))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, RECENT_LIMIT)
  const history = recent.length
    ? `\nYour recent work orders (most recent first):\n${recent.map(task => `- [${task.state}] ${task.title}${task.terminal_evidence ? ` — ${task.terminal_evidence.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`).join('\n')}`
    : '\nYou have no earlier work orders.'
  return `\n\n${definition.persona}${history}`
}
