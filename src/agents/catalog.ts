import type { AgentCatalogEntry } from '../types.js'
import type { Profile } from '../profiles/schema.js'

/** Catalog is operator-facing metadata; it is never included in model tools. */
export function buildAgentCatalog(profile: Profile, discoverableProfiles: Profile[] = []): AgentCatalogEntry[] {
  const entries = new Map<string, AgentCatalogEntry>()
  for (const agent of profile.agents ?? []) {
    entries.set(agent.name, {
      name: agent.name,
      profile: agent.profile,
      input: agent.input,
      output: agent.output,
      ...agent.spawn,
    })
  }
  for (const candidate of discoverableProfiles) {
    if (entries.has(candidate.name) || candidate.name === profile.name) continue
    entries.set(candidate.name, {
      name: candidate.name,
      profile: candidate.name,
      input: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
      output: { type: 'string' },
      label: candidate.description ?? candidate.name,
      hint: `Delegate to ${candidate.name} profile`,
      prompt_field: 'task',
    })
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
}
