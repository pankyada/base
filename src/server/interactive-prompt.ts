import { readFileSync } from 'fs'
import type { MemoryProvider } from '../memory/interface.js'
import type { Profile } from '../profiles/schema.js'
import { systemPromptFor } from '../profiles/loader.js'
import { buildSystemPrompt } from '../context/system-prompt.js'
import type { MemoryCaptureService } from '../decisions/memory.js'

export function buildInteractiveSystemPrompt(
  profile: Profile,
  audioCapable: boolean,
  skillIndex: string,
  memory: MemoryProvider,
  workingDir = profile.working_dir,
  memoryRecall?: MemoryCaptureService,
  memoryRecallQuery = '',
  memoryProject = 'inbox',
): Promise<string> {
  return buildSystemPrompt({
    profile,
    systemPromptBase: readFileSync(systemPromptFor(profile, audioCapable), 'utf-8'),
    skillIndex,
    memory,
    memoryRecall,
    memoryRecallQuery,
    memoryProject,
    workingDir,
  })
}
