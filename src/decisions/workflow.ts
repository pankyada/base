import type { DecisionAnswer, DecisionEvaluateOptions, DecisionOutcome, DecisionProvider, DecisionQuestion, NoulAnswer, ScoreAnswer } from './types.js'
import type { Intensity, IntensityMap, Playbook, Stage } from '../workflow/types.js'
import { STAGES } from '../workflow/types.js'
import { SCALES, type RouteSignals, type Scale, type SessionRoute } from '../workflow/route.js'

export interface RouteCandidate { name: string; description?: string }

/** Phase 4 (roadmap #31, PT-079), spec §5.4. `failed_back` is `undefined` for 'none'. `drift` is empty when no drift candidates were passed. */
export interface EdgeJudgment {
  next: 'continue' | 'promote' | 'reroute' | 'stuck' | 'done'
  failed_back?: Stage
  drift: Record<string, number>
}

export interface WorkflowDecisionAdvisor {
  mode?: 'shadow' | 'enforce'
  chooseTriage(request: string, playbook: Playbook): Promise<{ task_class: string; recon_intensity: Intensity } | undefined>
  choosePlan?(request: string, reconArtifact: string, playbook: Playbook, taskClass: string): Promise<{ task_class?: string; intensity?: Partial<IntensityMap> } | undefined>
  /** Request routing graph (roadmap #31 phase 2, spec §5.1). One `evaluate` call fanning out domain/scale/ambiguity/existing-work/continuity questions. */
  chooseRoute?(request: string, candidates: RouteCandidate[], sessionRoute?: SessionRoute, lastAssistantMessage?: string): Promise<RouteSignals | undefined>
  /** Request routing graph (roadmap #31 phase 4, spec §5.4). One `evaluate` call per non-recon stage completion. */
  judgeEdge?(request: string, stage: Stage, artifact: string, playbook: string, remainingStages: Stage[], earlierStages: Stage[], driftCandidates?: RouteCandidate[]): Promise<EdgeJudgment | undefined>
}

export class WorkflowDecisionControlError extends Error {
  constructor(readonly reason: string) { super(`workflow decision control: ${reason}`); this.name = 'WorkflowDecisionControlError' }
}

function choice(outcome: Extract<DecisionOutcome, { kind: 'success' }>, key: string): string | undefined {
  const answer: DecisionAnswer | undefined = outcome.response.answers[key]
  return answer?.type === 'choice' && typeof answer.choice === 'string' ? answer.choice : undefined
}

function noul(outcome: Extract<DecisionOutcome, { kind: 'success' }>, key: string): number | undefined {
  const answer: DecisionAnswer | undefined = outcome.response.answers[key]
  return answer?.type === 'noul' && typeof (answer as NoulAnswer).noul === 'number' ? (answer as NoulAnswer).noul : undefined
}

function score(outcome: Extract<DecisionOutcome, { kind: 'success' }>, key: string): ScoreAnswer | undefined {
  const answer: DecisionAnswer | undefined = outcome.response.answers[key]
  return answer?.type === 'score' ? (answer as ScoreAnswer) : undefined
}

// Question keys sent to Jev must be safe identifiers; playbook names are
// operator-controlled but not guaranteed to be. Sanitize to [a-z0-9_] and
// keep a reverse map so answers route back to the real candidate name.
export function sanitizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'candidate'
}

export function domainKeyMap(candidates: RouteCandidate[]): Map<string, string> {
  const map = new Map<string, string>()
  const seen = new Set<string>()
  for (const candidate of candidates) {
    let key = sanitizeKey(candidate.name)
    while (seen.has(key)) key = `${key}_`
    seen.add(key)
    map.set(key, candidate.name)
  }
  return map
}

const SCALE_LEVEL_DESCRIPTIONS: Record<Scale, string> = {
  trivial: 'trivial: a one-line answer, a single small edit, or a question that needs no real work.',
  small: 'small: a single focused change confined to one file or a narrow area, completable in one pass.',
  medium: 'medium: a multi-file change or a feature with several moving parts needing planning.',
  large: 'large: a new multi-component system, a migration, or multi-day effort spanning many files.',
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
    async chooseRoute(request, candidates, sessionRoute, lastAssistantMessage) {
      const keyMap = domainKeyMap(candidates)
      const questions: Record<string, DecisionQuestion> = {}
      for (const [key, name] of keyMap) {
        const candidate = candidates.find(c => c.name === name)
        questions[`domain_${key}`] = {
          type: 'noul',
          instructions: `This request needs the ${name} workflow${candidate?.description ? ` (${candidate.description})` : ''}.`,
        }
      }
      questions.scale = {
        type: 'score',
        instructions: 'How large is the effort this request needs? Choose the level that best fits.',
        criteria: SCALES.map(level => SCALE_LEVEL_DESCRIPTIONS[level]),
      }
      questions.has_existing_work = {
        type: 'noul',
        instructions: 'This request operates on existing files, data, or an existing project rather than starting from scratch.',
      }
      questions.ambiguous = {
        type: 'noul',
        instructions: 'A competent assistant could not start this request without first asking one clarifying question.',
      }
      if (sessionRoute) {
        questions.continues_previous = {
          type: 'noul',
          instructions: 'This request is a follow-up continuation of the previous task in this session, rather than a new, unrelated request.',
        }
      }
      const state: Record<string, unknown> = { request: bounded(request, 8_000), candidates: candidates.map(c => ({ name: c.name, description: c.description ?? '' })) }
      if (sessionRoute) state.session_route = sessionRoute
      if (lastAssistantMessage) state.last_assistant_message = bounded(lastAssistantMessage, 2_000)

      const outcome = await evaluate(state, questions)

      const domain: Record<string, number> = {}
      for (const [key, name] of keyMap) {
        const value = noul(outcome, `domain_${key}`)
        if (value === undefined) return undefined
        domain[name] = value
      }
      const scaleAnswer = score(outcome, 'scale')
      if (!scaleAnswer) return undefined
      const scaleDistribution: Partial<Record<Scale, number>> = {}
      for (const [index, label] of Object.entries(scaleAnswer.legend)) {
        const level = SCALES.find(candidate => SCALE_LEVEL_DESCRIPTIONS[candidate] === label)
        const probability = scaleAnswer.probabilities[index]
        if (level && typeof probability === 'number') scaleDistribution[level] = probability
      }
      if (SCALES.some(level => scaleDistribution[level] === undefined)) return undefined

      const hasExistingWork = noul(outcome, 'has_existing_work')
      const ambiguous = noul(outcome, 'ambiguous')
      if (hasExistingWork === undefined || ambiguous === undefined) return undefined

      const signals: RouteSignals = {
        domain,
        scale: scaleDistribution as Record<Scale, number>,
        has_existing_work: hasExistingWork,
        ambiguous,
      }
      if (sessionRoute) {
        const continuesPrevious = noul(outcome, 'continues_previous')
        if (continuesPrevious === undefined) return undefined
        signals.continues_previous = continuesPrevious
      }
      return signals
    },
    async judgeEdge(request, stage, artifact, playbook, remainingStages, earlierStages, driftCandidates) {
      const questions: Record<string, DecisionQuestion> = {
        next: {
          type: 'choice',
          instructions: 'Judge the edge right after this workflow stage completed. Choose what should happen next.',
          criteria: {
            continue: 'The work is on track with the plan; proceed to the next stage as planned.',
            promote: 'The work is turning out bigger than what was planned; the remaining stages need more intensity, restarting from planning.',
            reroute: 'The remaining work no longer belongs to this workflow; it belongs to a different one entirely.',
            stuck: 'Progress cannot continue without asking the user a clarifying question.',
            done: 'The request is already fully satisfied by the work so far; no further stage work is needed.',
          },
        },
      }
      const failedBackOptions = ['none', ...earlierStages]
      questions.failed_back = {
        type: 'choice',
        instructions: "Which earlier stage's output was wrong and must be redone? Choose 'none' if nothing earlier needs to be redone.",
        criteria: Object.fromEntries(failedBackOptions.map(name => [name, name === 'none' ? 'Nothing earlier needs to be redone.' : `The ${name} stage's output was wrong and must be redone.`])),
      }
      const keyMap = driftCandidates && driftCandidates.length > 0 ? domainKeyMap(driftCandidates) : undefined
      if (keyMap) {
        for (const [key, name] of keyMap) {
          const candidate = driftCandidates!.find(c => c.name === name)
          questions[`drift_${key}`] = {
            type: 'noul',
            instructions: `The remaining work now belongs to the ${name} workflow${candidate?.description ? ` (${candidate.description})` : ''}, not ${playbook}.`,
          }
        }
      }
      const state: Record<string, unknown> = {
        stage,
        artifact: bounded(artifact, 6_000),
        request: bounded(request, 4_000),
        playbook,
        remaining_stages: remainingStages,
        earlier_stages: earlierStages,
      }
      const outcome = await evaluate(state, questions)

      const next = choice(outcome, 'next')
      if (!next || !['continue', 'promote', 'reroute', 'stuck', 'done'].includes(next)) return undefined
      const failedBackRaw = choice(outcome, 'failed_back')
      if (!failedBackRaw || !failedBackOptions.includes(failedBackRaw)) return undefined
      const failed_back = failedBackRaw === 'none' ? undefined : (failedBackRaw as Stage)

      const drift: Record<string, number> = {}
      if (keyMap) {
        for (const [key, name] of keyMap) {
          const value = noul(outcome, `drift_${key}`)
          if (value === undefined) return undefined
          drift[name] = value
        }
      }
      return { next: next as EdgeJudgment['next'], failed_back, drift }
    },
  }
}
