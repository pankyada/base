import type { Profile } from '../profiles/schema.js'
import { compileContract, validateAndBuildInput } from '../server/contract.js'

export type TriggerSource = 'cron' | 'watch' | 'poll'

/** Convert a trigger payload into the exact user message accepted by a profile. */
export function triggerUserMessage(profile: Profile, source: TriggerSource, input: unknown): string {
  if (source === 'cron' && input === undefined) return ''
  if (!profile.contract?.input) return JSON.stringify(input) ?? ''
  const check = validateAndBuildInput(input, compileContract(profile))
  if (!check.ok) throw new Error(`[${source}] profile '${profile.name}' trigger input is invalid: ${check.error}`)
  return check.userMessage
}
