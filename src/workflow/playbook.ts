import matter from 'gray-matter'
import { existsSync, readFileSync } from 'fs'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { join, resolve } from 'path'
import type { Intensity, Playbook, Stage, StageContract } from './types.js'
import { STAGES } from './types.js'

// dirs() spawns a synchronous `git` subprocess to find the repo root. The
// working directory is fixed for the life of the process, so the result is
// cached — otherwise every stage of every workflow task (loadPlaybook is
// called once per stage) would block the event loop on a fresh subprocess.
let dirsCache: string[] | undefined

function dirs(): string[] {
  if (dirsCache) return dirsCache
  const candidates = [join(homedir(), '.agents', 'playbooks')]
  try { candidates.push(join(execSync('git rev-parse --show-toplevel', { stdio: 'pipe', timeout: 3000 }).toString().trim(), '.agents', 'playbooks')) } catch { /* not a git checkout */ }
  candidates.push(join(resolve(process.cwd(), '..'), '.agents', 'playbooks'))
  candidates.push(join(process.cwd(), '.agents', 'playbooks'))
  dirsCache = [...new Set(candidates)]
  return dirsCache
}

export function resolvePlaybookDirs(): string[] { return dirs() }

export function clearPlaybookCache(): void {
  dirsCache = undefined
  playbookCache.clear()
}

const genericContracts: Record<Stage, StageContract> = {
  recon: { required_sections: ['Files touched', 'Prior knowledge', 'Open questions'], exit_criteria: 'Current state inspected before planning.', prompt: 'Establish current state and explicitly record project knowledge.' },
  plan: { required_sections: ['Plan', 'Risks'], exit_criteria: 'A sequence and risks are explicit.', prompt: 'Choose a concise sequence and identify risks.' },
  design: { required_sections: ['Design'], exit_criteria: 'Output shape is explicit.', prompt: 'Define the contract before producing the artifact.' },
  build: { required_sections: ['Result'], exit_criteria: 'The requested artifact is produced.', prompt: 'Produce the requested artifact.' },
  verify: { required_sections: ['Verification'], exit_criteria: 'Artifact is checked against reality.', prompt: 'Check the result and report evidence.' },
  review: { required_sections: ['Review'], exit_criteria: 'A second opinion is recorded.', prompt: 'Review the result adversarially.' },
}

function generic(): Playbook {
  return { name: 'generic', description: 'Safe generic workflow', stages: ['recon', 'plan', 'build', 'verify'], task_classes: ['general'], defaults: { general: { recon: 1, plan: 1, design: 0, build: 2, verify: 1, review: 0 } }, contract: (stage, intensity) => intensity === 0 ? { required_sections: [], exit_criteria: 'Skipped.', prompt: '' } : genericContracts[stage] }
}

function parseContracts(body: string): Map<Stage, Map<Intensity, StageContract>> {
  const result = new Map<Stage, Map<Intensity, StageContract>>()
  let currentStage: Stage | undefined
  let currentIntensity: Intensity | undefined
  let buf: string[] = []
  const flush = () => {
    if (!currentStage || currentIntensity === undefined) return
    const text = buf.join('\n')
    const required = text.match(/Required artifact sections?:\s*([^\n]+)/i)?.[1]
    const exit = text.match(/Exit criteria:\s*([^\n]+)/i)?.[1]
    const stageMap = result.get(currentStage) ?? new Map<Intensity, StageContract>()
    stageMap.set(currentIntensity, {
      required_sections: required ? [...required.matchAll(/`([^`]+)`/g)].map(m => m[1]).concat(required.includes('`') ? [] : required.split(',').map(s => s.trim()).filter(Boolean)) : [],
      exit_criteria: exit?.trim() ?? 'Contract satisfied.',
      prompt: text.trim(),
    })
    result.set(currentStage, stageMap)
    buf = []
  }
  for (const line of body.split('\n')) {
    const stage = line.match(/^##\s+(recon|plan|design|build|verify|review)\s*$/i)?.[1]?.toLowerCase() as Stage | undefined
    const level = line.match(/^###\s+L([0-3])\s*$/i)
    if (stage) { flush(); currentStage = stage; currentIntensity = undefined; continue }
    if (level) { flush(); currentIntensity = Number(level[1]) as Intensity; continue }
    if (currentStage && currentIntensity !== undefined) buf.push(line)
  }
  flush()
  return result
}

function parsePlaybook(raw: string, fallbackName: string): Playbook {
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>
  const stages = Array.isArray(data.stages) ? data.stages.filter((s): s is Stage => typeof s === 'string' && (STAGES as readonly string[]).includes(s as Stage)) : [...STAGES]
  const taskClasses = Array.isArray(data.task_classes) ? data.task_classes.filter((s): s is string => typeof s === 'string') : ['general']
  const defaults = (data.defaults && typeof data.defaults === 'object' ? data.defaults : {}) as Record<string, Partial<Record<Stage, Intensity>>>
  const contracts = parseContracts(parsed.content)
  return {
    name: typeof data.name === 'string' ? data.name : fallbackName,
    description: typeof data.description === 'string' ? data.description : undefined,
    stages,
    task_classes: taskClasses,
    defaults,
    contract(stage, intensity) {
      if (intensity === 0) return { required_sections: [], exit_criteria: 'Skipped.', prompt: '' }
      const byLevel = contracts.get(stage)
      if (byLevel) {
        const exact = byLevel.get(intensity)
        if (exact) return exact
        for (let i = intensity; i >= 1; i--) if (byLevel.has(i as Intensity)) return byLevel.get(i as Intensity)!
      }
      return genericContracts[stage]
    },
  }
}

const playbookCache = new Map<string, Playbook>()

function resolvePlaybook(name: string): Playbook {
  for (const root of resolvePlaybookDirs().slice().reverse()) {
    const path = join(root, name, 'PLAYBOOK.md')
    if (!existsSync(path)) continue
    try { return parsePlaybook(readFileSync(path, 'utf8'), name) } catch (error) { console.warn(`[workflow] malformed playbook '${name}', using generic`, error) }
  }
  return generic()
}

export function loadPlaybook(name = 'generic'): Playbook {
  const cached = playbookCache.get(name)
  if (cached) return cached
  const playbook = resolvePlaybook(name)
  playbookCache.set(name, playbook)
  return playbook
}
