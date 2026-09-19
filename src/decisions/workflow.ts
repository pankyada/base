import type { DecisionAnswer, DecisionEvaluateOptions, DecisionOutcome, DecisionProvider, DecisionQuestion } from './types.js'
import type { Intensity, IntensityMap, Playbook, Stage } from '../workflow/types.js'
import { STAGES } from '../workflow/types.js'

export interface WorkflowDecisionAdvisor {
  mode?: 'shadow' | 'enforce'
  chooseTriage(request: string, playbook: Playbook): Promise<{ task_class: string; recon_intensity: Intensity } | undefined>
  choosePlan?(request: string, reconArtifact: string, playbook: Playbook, taskClass: string): Promise<{ task_class?: string; intensity?: Partial<IntensityMap> } | undefined>
}

export class WorkflowDecisionControlError extends Error {
  constructor(readonly reason: string) { super(`workflow decision control: ${reason}`); this.name = 'WorkflowDecisionControlError' }
}

function choice(outcome: Extract<DecisionOutcome, { kind: 'success' }>, key: string): string | undefined {
  const answer: DecisionAnswer | undefined = outcome.response.answers[key]
  return answer?.type === 'choice' && typeof answer.choice === 'string' ? answer.choice : undefined
}

function bounded(value: string, max: number): string { return value.length > max ? value.slice(0, max) : value }

function outcomeOrThrow(outcome: DecisionOutcome): Extract<DecisionOutcome, { kind: 'success' }> {
  if (outcome.kind === 'control') throw new WorkflowDecisionControlError(outcome.reason)
  if (outcome.kind !== 'success') throw new Error(`workflow decision unavailable: ${outcome.reason}`)
  return outcome
}

export function createWorkflowDecisionAdvisor(options: { provider: DecisionProvider; model: string; signal?: AbortSignal; evaluateOptions?: Omit<DecisionEvaluateOptions, 'signal'>; mode?: 'shadow' | 'enforce' }): WorkflowDecisionAdvisor {
  const evaluate = async (state: Record<string, unknown>, questions: Record<string, DecisionQuestion>) => outcomeOrThrow(await options.provider.evaluate({ model: options.model, state: state as any, questions }, { ...options.evaluateOptions, signal: options.signal }))
  return {
    mode: options.mode ?? 'enforce',
    async chooseTriage(request, playbook) {
      const classes = [...new Set(playbook.task_classes)]
      const outcome = await evaluate({ request: bounded(request, 12_000), playbook: playbook.name, allowed_task_classes: classes }, {
        task_class: { type: 'choice', instructions: 'Choose the single best configured task class for this request. Do not invent a class.', criteria: Object.fromEntries(classes.map(taskClass => [taskClass, taskClass])) },
        recon_intensity: { type: 'choice', instructions: 'Choose recon intensity from the configured values.', criteria: { '1': 'minimal recon', '2': 'normal recon', '3': 'deep recon' } },
      })
      const taskClass = choice(outcome, 'task_class')
      const recon = choice(outcome, 'recon_intensity')
      if (!taskClass || !recon || !classes.includes(taskClass) || !['1', '2', '3'].includes(recon)) return undefined
      return { task_class: taskClass, recon_intensity: Number(recon) as Intensity }
    },
    async choosePlan(request, reconArtifact, playbook, taskClass) {
      const allowedClasses = [...new Set(playbook.task_classes)]
      const questions: Record<string, DecisionQuestion> = {
        task_class: { type: 'choice', instructions: 'Choose the configured task class that best fits the request and recon. Do not invent one.', criteria: Object.fromEntries(allowedClasses.map(value => [value, value])) },
      }
      for (const stage of STAGES) questions[`intensity_${stage}`] = { type: 'choice', instructions: `Choose the configured intensity for ${stage}.`, criteria: { '0': 'off', '1': 'light', '2': 'normal', '3': 'deep' } }
      const outcome = await evaluate({ request: bounded(request, 8_000), recon: bounded(reconArtifact, 8_000), playbook: playbook.name, configured_task_class: taskClass, allowed_task_classes: allowedClasses, stages: STAGES }, questions)
      const selectedClass = choice(outcome, 'task_class')
      const intensity = Object.fromEntries(STAGES.flatMap((stage: Stage) => {
        const value = choice(outcome, `intensity_${stage}`)
        return value && ['0', '1', '2', '3'].includes(value) ? [[stage, Number(value) as Intensity]] : []
      })) as Partial<IntensityMap>
      return { task_class: selectedClass && allowedClasses.includes(selectedClass) ? selectedClass : taskClass, intensity }
    },
  }
}
