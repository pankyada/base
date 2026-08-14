import { readFileSync } from 'fs'
import type { MemoryProvider } from '../memory/interface.js'
import type { Profile } from '../profiles/schema.js'
import { systemPromptFor } from '../profiles/loader.js'
import { buildSystemPrompt } from '../context/system-prompt.js'

export function buildInteractiveSystemPrompt(
  profile: Profile,
  audioCapable: boolean,
  skillIndex: string,
  memory: MemoryProvider,
): Promise<string> {
  return buildSystemPrompt({
    profile,
    systemPromptBase: readFileSync(systemPromptFor(profile, audioCapable), 'utf-8'),
    skillIndex,
    memory,
  })
}
