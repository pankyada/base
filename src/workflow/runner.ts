import OpenAI from 'openai'
import type { Profile } from '../profiles/schema.js'
import { resolveRole } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { AgentLoopEvents, ToolContext } from '../tools/types.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import { estimateCost } from '../models/registry.js'
import { logEvent } from '../telemetry/logger.js'
import { loadPlaybook } from './playbook.js'
import { buildStageContext, validateArtifact, writeArtifact } from './artifacts.js'
import { defaultTaskPlan, triageA, triageB } from './triage.js'
import { emitTaskOutcome, recordWrittenFiles } from './labeler.js'
import { extractKnowledge, generalizationFromReview, persistKnowledge, queryProjectGraph } from './knowledge.js'
import { newStageId, newTaskId, STAGES } from './types.js'
import type { Stage, StageResult, TaskPlan, Tier, Intensity } from './types.js'
import { chooseExploration, promoteTier, resolveTier } from './policy.js'
import { parseRoutingPolicy } from './adaptive.js'
import type { RoutingPolicyDoc } from './adaptive.js'
import { maybeShadow } from './shadow.js'

export interface WorkflowRunOptions { taskId?: string; loop?: typeof runAgentLoop }

export interface PlanPreview {
  taskId: string
  body: string
  intensity: Intensity
  tier: Tier
  model: string
  contract_ok: boolean
  attempt: number
}

function triageIsFixed(profile: Profile): boolean {
  const min = profile.workflow?.min_intensity ?? {}
  const max = profile.workflow?.max_intensity ?? {}
  return STAGES.every(stage => min[stage] !== undefined && max[stage] !== undefined && min[stage] === max[stage])
}

// A sentence-scoped negation check on the failure vocabulary — "no errors
// found, all tests passed" and "previously broken, now fixed" both contain a
// raw fail-keyword hit but are resolutions, not failures. Splitting on
// sentence boundaries and requiring the negator to land in the *same*
// sentence keeps this local (no cross-sentence bleed) while catching the
// common "no X" / "X, now fixed" phrasings a verify stage actually produces.
const FAIL_WORD = /\b(fail(?:ed|s|ure)?|error(?:s)?|broken|incorrect)\b/i
const RESOLVED_NEARBY = /\b(no|not|n't|never|zero|none|without|resolved|fixed|passed?|corrected|addressed)\b/i

function hasUnresolvedFailure(body: string): boolean {
  const sentences = body.split(/(?<=[.!\n])\s*/)
  return sentences.some(sentence => FAIL_WORD.test(sentence) && !RESOLVED_NEARBY.test(sentence))
}

export function shouldEscalate(result: StageResult): { escalate: boolean; reason: string } {
  if (!result.contract_ok) return { escalate: true, reason: 'stage contract unmet' }
  if (result.stage === 'verify' && (hasUnresolvedFailure(result.body) || failBackTarget(result) !== null)) return { escalate: true, reason: 'verification failed' }
  if ((result.edit_rewrites ?? 0) >= 3) return { escalate: true, reason: 'edit thrash' }
  if ((result.tool_error_rate ?? 0) > 0.3) return { escalate: true, reason: 'tool error rate above 30%' }
  if ((result.confidence ?? 1) < 0.4) return { escalate: true, reason: 'low confidence' }
  if ((result.high_findings ?? 0) > 0) return { escalate: true, reason: 'high severity review finding' }
  return { escalate: false, reason: '' }
}

// Back-targetable stages. Checked in pipeline order, but the window in
// stageWrongPattern is kept tight (adjacent words only) precisely so an
// earlier stage merely *mentioned* nearby a later stage's "is wrong" clause
// can't spuriously match — e.g. "the plan missed this so the build is wrong"
// must resolve to build, the stage actually called wrong, not plan.
const BACK_TARGETS: Stage[] = ['recon', 'plan', 'design', 'build']
const BACK_TARGET_PATTERN = new RegExp(`(?:precondition|fail[- ]back|go(?:ing)?\\s+back|revisit|redo|return)\\s+(?:to\\s+)?(?:the\\s+)?(${BACK_TARGETS.join('|')})(?:\\s+stage)?`, 'i')

function stageWrongPattern(stage: Stage): RegExp {
  return new RegExp(`\\b${stage}\\b(?:\\s+stage)?[^.\\n]{0,10}\\b(?:is|was)\\b[^.\\n]{0,10}\\b(wrong|incorrect|flawed|broken|invalid)\\b|\\b(wrong|incorrect|flawed|broken|invalid)\\b[^.\\n]{0,10}\\bwith\\s+(?:the\\s+)?${stage}\\b`, 'i')
}

export function failBackTarget(result: StageResult): Stage | null {
  const explicit = result.body.match(BACK_TARGET_PATTERN)
  if (explicit) return explicit[1].toLowerCase() as Stage
  if (result.stage !== 'verify') return null
  return BACK_TARGETS.find(stage => stageWrongPattern(stage).test(result.body)) ?? null
}

function stageBody(session: Session): string {
  const messages = session.messages as Array<{ role: string; content?: unknown }>
  const last = [...messages].reverse().find(m => m.role === 'assistant' && typeof m.content === 'string')
  return String(last?.content ?? '').trim()
}

function childSession(root: Session, stageId: string, seed: string): Session {
  return { ...root, id: stageId, messages: [{ role: 'system', content: 'You are one bounded workflow stage. Return the requested artifact only.' }], tool_calls: [], usage: { input: 0, output: 0, cost_usd: 0 }, todos: root.todos, session_memory: root.session_memory }
}

function stageEvents(root: Session, events: AgentLoopEvents): AgentLoopEvents {
  return { ...events, onSessionEnd: () => {}, onStats: (input, output, cost, contextTokens) => events.onStats?.(root.usage.input + input, root.usage.output + output, root.usage.cost_usd + cost, contextTokens) }
}

async function shadowCompletion(openai: OpenAI, model: string, prompt: string): Promise<string> {
  const response = await (openai.chat.completions as any).create({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0 })
  return String(response.choices?.[0]?.message?.content ?? '')
}

async function executeStage(request: string, stage: Stage, intensity: Intensity, tier: Tier, attempt: number, taskId: string, plan: TaskPlan, profile: Profile, root: Session, context: ToolContext, events: AgentLoopEvents, openai: OpenAI, signal: AbortSignal, prior: Array<{ stage: Stage; body: string }>, graphSlice: string, loop: typeof runAgentLoop, explore = false, persistArtifact = true): Promise<StageResult> {
  const modelId = tier === 'critic' ? (profile.models?.roles.critic ?? profile.model.id) : (profile.models?.roles?.[tier] ?? profile.model.id)
  const contract = loadPlaybook(profile.workflow?.playbook ?? 'generic').contract(stage, intensity)
  const seed = buildStageContext(request, prior, contract, stage === 'recon' ? graphSlice : '')
  const stageId = newStageId()
  const staged = childSession(root, stageId, seed)
  const stageContext = { ...context, session: staged, events: stageEvents(root, events) }
  const started = Date.now()
  events.onStage?.(stage, intensity, tier, modelId, 'start')
  logEvent({ session: root.id, profile: profile.name, kind: 'stage', task_id: taskId, stage_id: stageId, stage, intensity, tier, task_class: plan.task_class, blast_radius: plan.blast_radius, reversibility: plan.reversibility, playbook: profile.workflow?.playbook ?? 'generic', attempt, model: modelId, state: 'start' })
  await loop(seed, profile, staged, stageContext, stageContext.events, openai, signal, { modelId, stage: { task_id: taskId, stage_id: stageId, stage, attempt, intensity, tier, task_class: plan.task_class, blast_radius: plan.blast_radius, playbook: profile.workflow?.playbook ?? 'generic', explore } })
  root.tool_calls.push(...staged.tool_calls)
  root.usage.input += staged.usage.input
  root.usage.output += staged.usage.output
  root.usage.cost_usd += staged.usage.cost_usd
  const body = stageBody(staged)
  const validation = validateArtifact(body, contract)
  if (persistArtifact) writeArtifact(profile, root, stage, body, { intensity, tier, model: modelId, confidence: plan.confidence, contract_ok: validation.ok, attempt, task_id: taskId })
  if (profile.workflow?.knowledge.graph) {
    const knowledge = await extractKnowledge(body, stage, openai, profile)
    const generalized = stage === 'review' && profile.workflow.knowledge.generalization_probe ? generalizationFromReview(body) : { nodes: [], edges: [] }
    await persistKnowledge(context.memory, [...knowledge.nodes, ...generalized.nodes], [...knowledge.edges, ...generalized.edges]).catch(() => {})
  }
  const result: StageResult = { stage, intensity, tier, modelId, attempt, body, contract_ok: validation.ok, missing: validation.missing, confidence: plan.confidence, high_findings: stage === 'review' && /\bhigh\b/i.test(body) ? 1 : 0 }
  const escalation = shouldEscalate(result)
  logEvent({ session: root.id, profile: profile.name, kind: 'stage', task_id: taskId, stage_id: stageId, stage, intensity, tier, task_class: plan.task_class, blast_radius: plan.blast_radius, reversibility: plan.reversibility, playbook: profile.workflow?.playbook ?? 'generic', attempt, model: modelId, state: escalation.escalate ? 'escalated' : 'done', contract_ok: validation.ok, cost_usd: staged.usage.cost_usd, duration_ms: Date.now() - started, escalated_from: escalation.escalate ? tier : undefined, failed_back_to: failBackTarget(result) ?? undefined, explore })
  events.onStage?.(stage, intensity, tier, modelId, escalation.escalate ? 'escalated' : 'done', staged.usage.cost_usd)
  return result
}

function cloneSession(session: Session): Session {
  return JSON.parse(JSON.stringify(session)) as Session
}

/** Run only recon and plan against an isolated session for interactive rehearsal. */
export async function runPlanPreview(request: string, profile: Profile, session: Session, context: ToolContext, events: AgentLoopEvents, openai: OpenAI, signal: AbortSignal = new AbortController().signal, loop: typeof runAgentLoop = runAgentLoop): Promise<PlanPreview> {
  const taskId = newTaskId()
  const playbook = loadPlaybook(profile.workflow?.playbook ?? 'generic')
  const previewSession = cloneSession(session)
  const previewContext = { ...context, session: previewSession }
  const fixedTriage = triageIsFixed(profile)
  const triage = fixedTriage
    ? { task_class: playbook.task_classes[0] ?? 'general', recon_intensity: Math.max(1, profile.workflow?.min_intensity.recon ?? 1) as Intensity }
    : await triageA(request, playbook, openai, profile)
  const graphSlice = await queryProjectGraph(previewContext.memory, request).catch(() => 'no prior project knowledge')
  const reconPlan: TaskPlan = {
    task_class: triage.task_class,
    blast_radius: 'module',
    reversibility: 'easy',
    intensity: { recon: triage.recon_intensity, plan: 1, design: 0, build: 0, verify: 0, review: 0 },
    confidence: 0.5,
    why: 'interactive plan request',
  }
  const prior: Array<{ stage: Stage; body: string }> = []
  const reconRouting = resolveTier(profile, 'recon', reconPlan.task_class, undefined, playbook.name)
  const recon = await executeStage(request, 'recon', Math.max(1, reconPlan.intensity.recon) as Intensity, reconRouting.tier, 1, taskId, reconPlan, profile, previewSession, previewContext, events, openai, signal, prior, graphSlice, loop, false, false)
  prior.push({ stage: 'recon', body: recon.body })
  const plan = fixedTriage
    ? defaultTaskPlan(playbook, triage.task_class, profile.workflow)
    : await triageB(request, recon.body, playbook, openai, profile, triage.task_class)
  const intensity = Math.max(1, plan.intensity.plan) as Intensity
  const routing = resolveTier(profile, 'plan', plan.task_class, undefined, playbook.name)
  const result = await executeStage(request, 'plan', intensity, routing.tier, 1, taskId, plan, profile, previewSession, previewContext, events, openai, signal, prior, graphSlice, loop, false, false)
  return { taskId, body: result.body, intensity, tier: routing.tier, model: result.modelId, contract_ok: result.contract_ok, attempt: result.attempt }
}

export async function runWorkflow(request: string, profile: Profile, session: Session, context: ToolContext, events: AgentLoopEvents, openai: OpenAI, signal: AbortSignal = new AbortController().signal, options: WorkflowRunOptions = {}): Promise<void> {
  const taskId = options.taskId ?? newTaskId()
  const playbook = loadPlaybook(profile.workflow?.playbook ?? 'generic')
  const loop = options.loop ?? runAgentLoop
  const maxRetries = profile.workflow?.budget.max_stage_retries ?? 2
  const maxCost = profile.workflow?.budget.max_usd_per_task ?? 2
  const startedAt = Date.now()
  let adaptivePolicy: RoutingPolicyDoc | undefined
  if (profile.workflow?.routing.policy === 'adaptive') {
    try { adaptivePolicy = parseRoutingPolicy((await context.memory.read('project', 'routing-policy'))?.content) } catch { adaptivePolicy = undefined }
  }

  const fixedTriage = triageIsFixed(profile)
  const triage = fixedTriage
    ? { task_class: playbook.task_classes[0] ?? 'general', recon_intensity: Math.max(1, profile.workflow?.min_intensity.recon ?? 1) as Intensity }
    : await triageA(request, playbook, openai, profile)
  const graphSlice = await queryProjectGraph(context.memory, request).catch(() => 'no prior project knowledge')
  const reconPlan: TaskPlan = {
    task_class: triage.task_class,
    blast_radius: 'module',
    reversibility: 'easy',
    intensity: { recon: triage.recon_intensity, plan: 0, design: 0, build: 0, verify: 0, review: 0 },
    confidence: 0.5,
    why: 'triage-A',
  }
  session.messages.push({ role: 'user', content: request })
  const artifacts: Array<{ stage: Stage; body: string }> = []
  const tierOverrides = new Map<Stage, Tier>()
  let reentries = 0
  let plan: TaskPlan | undefined
  let pointer = 0
  let reconAttempts = 0
  const failureCounts = new Map<Stage, number>()
  let finalResult: StageResult | undefined

  const budgetExhausted = () => session.usage.cost_usd >= maxCost || Date.now() - startedAt >= (profile.workflow?.budget.max_stage_minutes ?? 15) * 60_000
  const plainFallback = async (reason: string) => {
    emitTaskOutcome(session, { task_id: taskId, stages_run: artifacts.length, rework_count: reentries, escalations: reentries, verify_first_try: false, review_findings: { high: 0, med: 0, low: 0 }, verdict: 'abandoned', reason })
    await loop(request, profile, session, context, events, openai, signal, { appendUser: false })
  }

  while (pointer < playbook.stages.length) {
    if (signal.aborted) return
    const stage = playbook.stages[pointer]
    if (stage !== 'recon' && !plan) throw new Error('workflow invariant: plan stage reached before recon')
    const activePlan = stage === 'recon' ? reconPlan : plan!
    const baseIntensity = stage === 'recon' ? reconPlan.intensity.recon : activePlan.intensity[stage]
    const routing = resolveTier(profile, stage, activePlan.task_class, adaptivePolicy, playbook.name)
    const selectedTier = tierOverrides.get(stage) ?? routing.tier
    const exploration = stage === 'recon'
      ? { tier: selectedTier, explore: false }
      : chooseExploration(profile, selectedTier, activePlan.reversibility, Math.max(0, 1 - session.usage.cost_usd / maxCost))
    const intensity = stage === 'recon' ? Math.max(1, baseIntensity) as Intensity : baseIntensity

    if (intensity === 0) {
      events.onStage?.(stage, 0, routing.tier, routing.modelId, 'skipped', 0)
      logEvent({ session: session.id, profile: profile.name, kind: 'stage', task_id: taskId, stage_id: newStageId(), stage, intensity: 0, tier: routing.tier, task_class: activePlan.task_class, blast_radius: activePlan.blast_radius, reversibility: activePlan.reversibility, playbook: playbook.name, attempt: 0, model: routing.modelId, state: 'skipped', contract_ok: true, cost_usd: 0 })
      pointer++
      continue
    }
    if (budgetExhausted()) { await plainFallback('workflow budget exhausted'); return }

    const attempt = (stage === 'recon' ? reconAttempts : 0) + 1
    if (stage === 'recon') reconAttempts++
    const result = await executeStage(request, stage, intensity, exploration.tier, attempt, taskId, activePlan, profile, session, context, events, openai, signal, artifacts, graphSlice, loop, exploration.explore)
    finalResult = result
    artifacts.push({ stage, body: result.body })

    if (stage === 'plan' || stage === 'design') {
      const contract = playbook.contract(stage, intensity)
      const shadow = await maybeShadow(
        stage,
        activePlan,
        profile,
        model => shadowCompletion(openai, model, buildStageContext(request, artifacts.slice(0, -1), contract)),
        (blind, critic) => shadowCompletion(openai, critic, `Judge Artifact A and Artifact B blind. State which is stronger and why.\n${blind}`),
        { chosenTier: exploration.tier },
      )
      if (shadow) {
        const shadowId = newStageId()
        logEvent({ session: session.id, profile: profile.name, kind: 'stage', task_id: taskId, stage_id: shadowId, stage, intensity, tier: 'cheap', task_class: activePlan.task_class, blast_radius: activePlan.blast_radius, reversibility: activePlan.reversibility, playbook: playbook.name, attempt, model: resolveRole(profile, 'cheap'), state: 'done', contract_ok: true, explore: true })
        logEvent({ session: session.id, profile: profile.name, kind: 'outcome', task_id: taskId, verdict: 'accepted', stages_run: 1, rework_count: 0, escalations: 0, verify_first_try: true, review_findings: { high: 0, med: 0, low: 0 }, total_cost_usd: 0, reason: `shadow comparison: ${shadow.verdict ?? 'no verdict'}`, explore: true })
      }
    }

    if (stage === 'recon') {
      if (!result.contract_ok) {
        if (reentries >= maxRetries) {
          emitTaskOutcome(session, { task_id: taskId, stages_run: artifacts.length, rework_count: reentries, escalations: reentries, verify_first_try: false, review_findings: { high: 0, med: 0, low: 0 }, verdict: 'abandoned', reason: 'recon gate failed' })
          events.onSessionEnd(session.id)
          return
        }
        reentries++
        reconPlan.intensity.recon = Math.min(3, reconPlan.intensity.recon + 1) as Intensity
        tierOverrides.set('recon', promoteTier(selectedTier))
        continue
      }
      plan = fixedTriage
        ? defaultTaskPlan(playbook, triage.task_class, profile.workflow)
        : await triageB(request, result.body, playbook, openai, profile, triage.task_class)
      pointer++
      continue
    }

    const escalation = shouldEscalate(result)
    if (!escalation.escalate) failureCounts.delete(stage)
    if (escalation.escalate) {
      if (reentries >= maxRetries) {
        emitTaskOutcome(session, { task_id: taskId, stages_run: artifacts.length, rework_count: reentries, escalations: reentries, verify_first_try: false, review_findings: { high: 0, med: 0, low: 0 }, verdict: 'abandoned', reason: `${stage}: ${escalation.reason}` })
        events.onSessionEnd(session.id)
        return
      }
      reentries++
      const target = failBackTarget(result)
      if (target) {
        activePlan.intensity[target] = Math.min(3, activePlan.intensity[target] + 1) as Intensity
        pointer = playbook.stages.indexOf(target)
        if (pointer < 0) pointer = 0
        continue
      }
      const failures = (failureCounts.get(stage) ?? 0) + 1
      failureCounts.set(stage, failures)
      const sameTierRetry = (!result.contract_ok || stage === 'verify') && failures < 2
      if (sameTierRetry) {
        pointer = playbook.stages.indexOf(stage)
      } else {
        // A repeated verification failure re-runs build at the promoted tier;
        // other triggers promote and retry their own stage.
        const promoteStage = stage === 'verify' ? 'build' : stage
        const promotionSource = tierOverrides.get(promoteStage) ?? resolveTier(profile, promoteStage, activePlan.task_class, adaptivePolicy, playbook.name).tier
        const promoted = promoteTier(promotionSource)
        tierOverrides.set(promoteStage, promoted)
        pointer = playbook.stages.indexOf(promoteStage)
      }
      if (pointer < 0) pointer = playbook.stages.indexOf(stage)
      continue
    }
    pointer++
  }

  const writtenFiles = session.tool_calls
    .filter(call => ['Write', 'Edit'].includes(call.name))
    .map(call => call.input.path ?? call.input.file_path)
    .filter((path): path is string => typeof path === 'string')
  if (writtenFiles.length > 0) recordWrittenFiles(profile, session, taskId, writtenFiles)
  const finalBody = artifacts[artifacts.length - 1]?.body ?? finalResult?.body ?? ''
  session.messages.push({ role: 'assistant', content: finalBody })
  emitTaskOutcome(session, {
    task_id: taskId,
    stages_run: artifacts.length,
    rework_count: reentries,
    escalations: reentries,
    verify_first_try: !artifacts.some(a => a.stage === 'verify' && /\b(fail|error|broken|incorrect)\b/i.test(a.body)),
    review_findings: { high: artifacts.filter(a => a.stage === 'review' && /\bhigh\b/i.test(a.body)).length, med: 0, low: 0 },
    verdict: 'accepted',
  })
  events.onSessionEnd(session.id)
}
