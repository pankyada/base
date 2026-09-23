export const STAGES = ['recon', 'plan', 'design', 'build', 'verify', 'review'] as const
export type Stage = typeof STAGES[number]
export type Intensity = 0 | 1 | 2 | 3
export type Tier = 'cheap' | 'balanced' | 'frontier' | 'critic'
export type BlastRadius = 'single-file' | 'module' | 'cross-module' | 'systemic'
export type Reversibility = 'easy' | 'hard' | 'irreversible'

export interface StageContract {
  required_sections: string[]
  exit_criteria: string
  prompt: string
}

export interface IntensityMap {
  recon: Intensity
  plan: Intensity
  design: Intensity
  build: Intensity
  verify: Intensity
  review: Intensity
}

export interface Playbook {
  name: string
  description?: string
  stages: Stage[]
  task_classes: string[]
  defaults: Record<string, Partial<IntensityMap>>
  contract(stage: Stage, intensity: Intensity): StageContract
}

export interface TaskPlan {
  task_class: string
  blast_radius: BlastRadius
  reversibility: Reversibility
  intensity: IntensityMap
  confidence: number
  why: string
}

export interface StageTag {
  task_id: string
  stage_id: string
  stage: Stage | 'triage'
  attempt: number
  intensity: Intensity
  tier: Tier
  task_class?: string
  blast_radius?: BlastRadius
  playbook?: string
  escalated_from?: Tier
  explore?: boolean
}

export interface StageResult {
  stage: Stage
  intensity: Intensity
  tier: Tier
  modelId: string
  attempt: number
  body: string
  contract_ok: boolean
  missing: string[]
  confidence?: number
  failed_back_to?: Stage
  high_findings?: number
  tool_error_rate?: number
  edit_rewrites?: number
}

export function newTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function newStageId(): string {
  return randomUUID()
}
import { randomUUID } from 'node:crypto'
