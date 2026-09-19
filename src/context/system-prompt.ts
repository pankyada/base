import type { MemoryProvider } from '../memory/interface.js'
import type { Profile } from '../profiles/schema.js'
import type { Skill } from '../tools/types.js'
import { loadProjectContext } from './project-context.js'
import { promptAssemblyDiagnostics, type PromptAssemblyDiagnostics } from './diagnostics.js'
import type { MemoryCaptureService } from '../decisions/memory.js'
import { buildSkillIndex } from '../skills/indexer.js'

export const MEMORY_PROMPT_START = '\n\n<!-- harness-memory-start -->\n'
export const MEMORY_PROMPT_END = '\n<!-- harness-memory-end -->'

export async function buildSystemPrompt(opts: {
  profile: Profile
  systemPromptBase: string
  skillIndex: string
  memory: MemoryProvider
  /** Optional per-turn semantic memory projection. Disabled profiles keep the provider baseline. */
  memoryRecall?: MemoryCaptureService
  memoryRecallQuery?: string
  memoryProject?: string
  workingDir?: string
  onDiagnostics?: (value: PromptAssemblyDiagnostics) => void
}): Promise<string> {
  const projectContext = (opts.profile.context as { project_files?: boolean } | undefined)?.project_files === false
    ? ''
    : loadProjectContext({ cwd: opts.workingDir })
  const memSection = opts.memoryRecall
    ? await opts.memoryRecall.buildPromptSection(opts.memory, opts.memoryRecallQuery ?? '', opts.memoryProject ?? 'inbox')
    : await opts.memory.buildSystemPromptSection()
  opts.onDiagnostics?.(promptAssemblyDiagnostics({ profile: opts.systemPromptBase, project: projectContext, skills: opts.skillIndex, memory: memSection }))
  return opts.memoryRecall
    ? opts.systemPromptBase + projectContext + opts.skillIndex + MEMORY_PROMPT_START + memSection + MEMORY_PROMPT_END
    : opts.systemPromptBase + projectContext + opts.skillIndex + memSection
}

/** Refresh only the dynamic memory component while preserving static prompt bytes. */
export async function refreshMemoryPrompt(opts: {
  session: { messages: unknown[]; project?: string }
  memory: MemoryProvider
  memoryRecall: MemoryCaptureService
  query: string
}): Promise<void> {
  const system = opts.session.messages[0] as { role?: string; content?: unknown } | undefined
  if (!system || system.role !== 'system' || typeof system.content !== 'string') return
  const start = system.content.indexOf(MEMORY_PROMPT_START)
  const end = system.content.indexOf(MEMORY_PROMPT_END, start + MEMORY_PROMPT_START.length)
  if (start < 0 || end < 0) return
  const memory = await opts.memoryRecall.buildPromptSection(opts.memory, opts.query, opts.session.project ?? 'inbox')
  system.content = `${system.content.slice(0, start)}${MEMORY_PROMPT_START}${memory}${MEMORY_PROMPT_END}${system.content.slice(end + MEMORY_PROMPT_END.length)}`
}

/** Remove a prior semantic projection when a session resumes with the feature disabled. */
export async function restoreBaselineMemoryPrompt(opts: { session: { messages: unknown[] }; memory: MemoryProvider }): Promise<void> {
  const system = opts.session.messages[0] as { role?: string; content?: unknown } | undefined
  if (!system || system.role !== 'system' || typeof system.content !== 'string') return
  const start = system.content.indexOf(MEMORY_PROMPT_START)
  const end = system.content.indexOf(MEMORY_PROMPT_END, start + MEMORY_PROMPT_START.length)
  if (start < 0 || end < 0) return
  system.content = `${system.content.slice(0, start)}${await opts.memory.buildSystemPromptSection()}${system.content.slice(end + MEMORY_PROMPT_END.length)}`
}

/** Build the additive skill body section selected for one request. */
export function buildSelectedSkillSection(skills: readonly Skill[], names: readonly string[]): string {
  const selected = skills.filter(skill => names.includes(skill.name))
  if (selected.length === 0) return ''
  return `\n\n## Selected skills\n${selected.map(skill => `### ${skill.name}\n${skill.content}`).join('\n\n')}`
}

export function buildDecisionSkillIndex(profile: Profile, skills: readonly Skill[]): string {
  const mode = profile.decision_layer?.enabled
    ? profile.decision_layer.features.capability_selection
    : undefined
  return mode === 'enforce' ? '' : buildSkillIndex(skills as Skill[])
}

/** Keep only selected skill metadata in an enforce-mode request. */
