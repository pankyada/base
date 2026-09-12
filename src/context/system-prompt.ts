import type { MemoryProvider } from '../memory/interface.js'
import type { Profile } from '../profiles/schema.js'
import { loadProjectContext } from './project-context.js'
import { promptAssemblyDiagnostics, type PromptAssemblyDiagnostics } from './diagnostics.js'

export async function buildSystemPrompt(opts: {
  profile: Profile
  systemPromptBase: string
  skillIndex: string
  memory: MemoryProvider
  workingDir?: string
  onDiagnostics?: (value: PromptAssemblyDiagnostics) => void
}): Promise<string> {
  const projectContext = (opts.profile.context as { project_files?: boolean } | undefined)?.project_files === false
    ? ''
    : loadProjectContext({ cwd: opts.workingDir })
  const memSection = await opts.memory.buildSystemPromptSection()
  opts.onDiagnostics?.(promptAssemblyDiagnostics({ profile: opts.systemPromptBase, project: projectContext, skills: opts.skillIndex, memory: memSection }))
  return opts.systemPromptBase + projectContext + opts.skillIndex + memSection
}
