import OpenAI from 'openai'
import { z } from 'zod'
import type { Profile } from '../profiles/schema.js'
import { resolveRole } from '../profiles/schema.js'
import type { Intensity, Playbook, TaskPlan, Stage } from './types.js'
import { STAGES } from './types.js'
import { logEvent } from '../telemetry/logger.js'
import type { ProviderClient } from '../provider/types.js'
import { isProviderControlFailure } from '../provider/errors.js'
import { WorkflowDecisionControlError } from '../decisions/workflow.js'
import type { WorkflowDecisionAdvisor } from '../decisions/workflow.js'

const TRIAGE_A_TTL_MS = 5 * 60_000
const triageACache = new Map<string, { expires: number; value: { task_class: string; recon_intensity: Intensity } }>()

const PlanSchema = z.object({
  task_class: z.string(),
  blast_radius: z.enum(['single-file', 'module', 'cross-module', 'systemic']),
  reversibility: z.enum(['easy', 'hard', 'irreversible']),
  intensity: z.record(z.enum(STAGES), z.number().int().min(0).max(3)),
  confidence: z.number().min(0).max(1),
  why: z.string(),
})
const jsonOnly = (content: string): string => content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()

function defaultsFor(playbook: Playbook, taskClass: string): TaskPlan {
  const raw = playbook.defaults[taskClass] ?? playbook.defaults[playbook.task_classes[0]] ?? {}
  return { task_class: taskClass, blast_radius: 'module', reversibility: 'easy', intensity: Object.fromEntries(STAGES.map(stage => [stage, (raw[stage] ?? (stage === 'recon' ? 1 : 0)) as Intensity])) as unknown as TaskPlan['intensity'], confidence: 0.25, why: 'playbook defaults' }
}

export function defaultTaskPlan(playbook: Playbook, taskClass: string, workflow?: Profile['workflow']): TaskPlan {
  return clampIntensity(defaultsFor(playbook, taskClass), workflow)
}

function requestFingerprint(request: string): string {
  return request.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 2_000)
}

export function clearTriageCache(): void { triageACache.clear() }

export async function triageA(request: string, playbook: Playbook, openai: OpenAI | undefined, profile: Profile, provider?: ProviderClient, decision?: WorkflowDecisionAdvisor): Promise<{ task_class: string; recon_intensity: Intensity }> {
  const fallbackClass = playbook.task_classes.includes('general') ? 'general' : playbook.task_classes[0] ?? 'general'
  const cacheKey = `${playbook.name}:${requestFingerprint(request)}`
  const cached = triageACache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.value
  if (cached) triageACache.delete(cacheKey)
  if (decision) {
    try {
      const selected = await decision.chooseTriage(request, playbook)
      if (decision.mode !== 'shadow' && selected && playbook.task_classes.includes(selected.task_class)) {
        const value = { task_class: selected.task_class, recon_intensity: Math.max(1, Math.min(3, selected.recon_intensity)) as Intensity }
        triageACache.set(cacheKey, { expires: Date.now() + TRIAGE_A_TTL_MS, value })
        return value
      }
    } catch (error) {
      if (error instanceof WorkflowDecisionControlError) throw error
      // Ordinary Jev failures use the existing provider triage below.
    }
  }
  try {
    const prompt = `Classify request for playbook ${playbook.name}. Return ONLY JSON {"task_class":"...","recon_intensity":1|2|3}. Classes: ${playbook.task_classes.join(', ')}. Request: ${request}`
    const content = await helperText(provider, openai, resolveRole(profile, 'cheap'), prompt, 120)
    const parsed = z.object({ task_class: z.string(), recon_intensity: z.number().int().min(0).max(3) }).parse(JSON.parse(jsonOnly(content)))
    const taskClass = playbook.task_classes.includes(parsed.task_class) ? parsed.task_class : fallbackClass
    const recon = Math.max(1, Math.min(3, parsed.recon_intensity)) as Intensity
    logEvent({ session: 'triage', profile: profile.name, kind: 'llm', model: resolveRole(profile, 'cheap'), stage: 'triage', task_class: taskClass, intensity: recon })
    const value = { task_class: taskClass, recon_intensity: recon }
    triageACache.set(cacheKey, { expires: Date.now() + TRIAGE_A_TTL_MS, value })
    return value
  } catch (error) {
    if (isProviderControlFailure(error)) throw error
    return { task_class: fallbackClass, recon_intensity: 1 }
  }
}

export async function triageB(request: string, reconArtifact: string, playbook: Playbook, openai: OpenAI | undefined, profile: Profile, taskClass?: string, provider?: ProviderClient, decision?: WorkflowDecisionAdvisor): Promise<TaskPlan> {
  const fallback = defaultsFor(playbook, taskClass ?? playbook.task_classes[0] ?? 'general')
  if (decision?.choosePlan) {
    try {
      const selected = await decision.choosePlan(request, reconArtifact, playbook, taskClass ?? fallback.task_class)
      if (decision.mode !== 'shadow' && selected) {
        const chosenClass = selected.task_class && playbook.task_classes.includes(selected.task_class) ? selected.task_class : fallback.task_class
        const plan = { ...fallback, task_class: chosenClass, intensity: { ...fallback.intensity, ...(selected.intensity ?? {}) } }
        return clampIntensity(plan, profile.workflow)
      }
    } catch (error) {
      if (error instanceof WorkflowDecisionControlError) throw error
      // Ordinary Jev failures use the existing provider triage below.
    }
  }
  try {
    const prompt = `Return ONLY JSON matching this schema: {"task_class":"string","blast_radius":"single-file|module|cross-module|systemic","reversibility":"easy|hard|irreversible","intensity":{"recon":1,"plan":0,"design":0,"build":1,"verify":0,"review":0},"confidence":0.0,"why":"string"}. Playbook: ${playbook.name}. Request: ${request}. Recon artifact:\n${reconArtifact}`
    const content = await helperText(provider, openai, resolveRole(profile, 'cheap'), prompt, 240)
    const parsed = PlanSchema.parse(JSON.parse(jsonOnly(content)))
    const plan = { ...fallback, ...parsed, intensity: { ...fallback.intensity, ...parsed.intensity } } as unknown as TaskPlan
    logEvent({ session: 'triage', profile: profile.name, kind: 'llm', model: resolveRole(profile, 'cheap'), stage: 'triage', task_class: plan.task_class, intensity: plan.intensity.recon, blast_radius: plan.blast_radius })
    return clampIntensity(plan, profile.workflow)
  } catch (error) {
    if (isProviderControlFailure(error)) throw error
    return clampIntensity(fallback, profile.workflow)
  }
}

async function helperText(provider: ProviderClient | undefined, openai: OpenAI | undefined, model: string, prompt: string, maxTokens: number): Promise<string> {
  if (provider) return (await provider.generate({ model, stream: false, maxTokens, temperature: 0, messages: [{ role: 'user', content: prompt }] }, { purpose: 'workflow-triage' })).text
  if (!openai) throw new Error('workflow provider unavailable')
  const response = await (openai.chat.completions as any).create({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0 })
  return String(response.choices?.[0]?.message?.content ?? '{}')
}

export function clampIntensity(plan: TaskPlan, workflow?: Profile['workflow']): TaskPlan {
  const min = workflow?.min_intensity ?? {}
  const max = workflow?.max_intensity ?? {}
  const intensity = Object.fromEntries(STAGES.map(stage => {
    const floor = stage === 'recon' ? Math.max(1, min[stage] ?? 0) : min[stage] ?? 0
    const ceiling = max[stage] ?? 3
    return [stage, Math.max(floor, Math.min(ceiling, plan.intensity[stage] ?? floor))]
  })) as unknown as TaskPlan['intensity']
  return { ...plan, intensity }
}
