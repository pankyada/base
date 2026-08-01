import matter from 'gray-matter'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { Stage, StageContract } from './types.js'

export interface ArtifactMeta {
  intensity: number
  tier: string
  model: string
  confidence?: number
  contract_ok: boolean
  attempt?: number
  task_id?: string
}

export function writeArtifact(profile: Profile, session: Session, stage: Stage, body: string, meta: ArtifactMeta): string {
  const dir = join(profile.artifact_dir, 'workflow', session.id)
  mkdirSync(dir, { recursive: true })
  const suffix = meta.attempt && meta.attempt > 1 ? `.${meta.attempt}` : ''
  const path = join(dir, `${stage}${suffix}.md`)
  writeFileSync(path, matter.stringify(body, { stage, ...meta }), 'utf8')
  return path
}

export function readArtifact(path: string): { body: string; data: Record<string, unknown> } | null {
  if (!existsSync(path)) return null
  const parsed = matter(readFileSync(path, 'utf8'))
  return { body: parsed.content.trim(), data: parsed.data }
}

export function validateArtifact(body: string, contract: StageContract): { ok: boolean; missing: string[] } {
  const missing = contract.required_sections.filter(section => !new RegExp(`^\\s{0,3}(?:#+\\s*)?${escapeRegExp(section)}\\s*:??`, 'im').test(body))
  return { ok: missing.length === 0, missing }
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export function buildStageContext(request: string, priorArtifacts: Array<{ stage: Stage; body: string }>, contract: StageContract, graphSlice = ''): string {
  const prior = priorArtifacts.map(a => `### ${a.stage}\n${a.body}`).join('\n\n') || '(none)'
  return [`Original request:\n${request}`, `Stage contract:\nRequired sections: ${contract.required_sections.join(', ') || '(none)'}\nExit criteria: ${contract.exit_criteria}\nInstructions: ${contract.prompt}`, `Prior artifacts:\n${prior}`, graphSlice ? `Project knowledge:\n${graphSlice}` : 'Project knowledge:\n(none)'].join('\n\n')
}
