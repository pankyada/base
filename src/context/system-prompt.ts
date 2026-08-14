import type { MemoryProvider } from '../memory/interface.js'
import type { Profile } from '../profiles/schema.js'
import { loadProjectContext } from './project-context.js'

export async function buildSystemPrompt(opts: {
  profile: Profile
  systemPromptBase: string
  skillIndex: string
  memory: MemoryProvider
}): Promise<string> {
  const projectContext = (opts.profile.context as { project_files?: boolean } | undefined)?.project_files === false
    ? ''
    : loadProjectContext()
  const memSection = await opts.memory.buildSystemPromptSection()
  return opts.systemPromptBase + projectContext + opts.skillIndex + memSection
}
