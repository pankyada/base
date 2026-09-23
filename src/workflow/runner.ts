import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import type { Profile } from '../profiles/schema.js'
import { resolveRole } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { AgentLoopEvents, ToolContext } from '../tools/types.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import { estimateCost } from '../models/registry.js'
import { logEvent } from '../telemetry/logger.js'
import { loadPlaybook, listPlaybooks } from './playbook.js'
import { buildStageContext, validateArtifact, writeArtifact } from './artifacts.js'
import { clampIntensity, defaultTaskPlan, triageA, triageB } from './triage.js'
import { emitTaskOutcome, recordWrittenFiles } from './labeler.js'
import { extractKnowledge, generalizationFromReview, persistKnowledge, queryProjectGraph } from './knowledge.js'
import { newStageId, newTaskId, STAGES } from './types.js'
import type { Playbook, Stage, StageResult, TaskPlan, Tier, Intensity, IntensityMap } from './types.js'
import { chooseExploration, promoteTier, resolveTier } from './policy.js'
import { parseRoutingPolicy } from './adaptive.js'
import type { RoutingPolicyDoc } from './adaptive.js'
import { maybeShadow } from './shadow.js'
import type { ProviderClient, UsageMetadata } from '../provider/types.js'
import { bindRunProvider } from '../provider/invocation.js'
import { mergeUsageDelta, usageDeltaFromSession } from '../usage/ledger.js'
import { createWorkflowDecisionAdvisor, WorkflowDecisionControlError, type WorkflowDecisionAdvisor } from '../decisions/workflow.js'
import { DecisionRuntimeService } from '../decisions/runtime.js'
import { decideRoute } from './route.js'
import type { RouteDecision } from './route.js'
import { runClaimCheck } from './claims.js'

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

function workflowAdvisor(profile: Profile, context: ToolContext, signal: AbortSignal): WorkflowDecisionAdvisor | undefined {
  const config = profile.decision_layer
  if (!config || config.features.workflow_routing === 'disabled' || !(context.decisionRuntime instanceof DecisionRuntimeService) || !context.decisionRuntime.provider || !config.model) return undefined
  return createWorkflowDecisionAdvisor({ provider: context.decisionRuntime.provider, model: config.model, signal, mode: config.features.workflow_routing, evaluateOptions: context.decisionRuntime.evaluateOptions(signal) })
}

// Request routing graph (roadmap #31 phase 2, spec §5.1/§6). Gated on
// `decision_layer.features.request_routing`, mirroring `workflowAdvisor`'s
// gating but keyed on the routing-specific feature mode.
function routeAdvisor(profile: Profile, context: ToolContext, signal: AbortSignal): WorkflowDecisionAdvisor | undefined {
  const config = profile.decision_layer
  const mode = config?.features.request_routing
  if (!config || (mode !== 'shadow' && mode !== 'enforce') || !(context.decisionRuntime instanceof DecisionRuntimeService) || !context.decisionRuntime.provider || !config.model) return undefined
  return createWorkflowDecisionAdvisor({ provider: context.decisionRuntime.provider, model: config.model, signal, mode, evaluateOptions: context.decisionRuntime.evaluateOptions(signal) })
}

export interface RouteResolution {
  decision?: RouteDecision
  mode?: 'shadow' | 'enforce'
}

/**
 * Phase 2/3 (PT-077/PT-078): compute and log one routing decision. Shadow
 * mode still never applies it (phase 2 behavior, preserved byte-for-byte
 * except the additive `route_applied` telemetry field). Enforce mode marks
 * `route_applied: true` on a `run` decision — the caller (resolveRouteDecision
 * below, or runWorkflow directly) is responsible for actually applying it;
 * this function stays pure logging + policy, no side effects on the run.
 * Any non-control failure degrades to a logged fallback and the caller's
 * existing path continues untouched; a control outcome propagates.
 */
async function resolveRoute(request: string, profile: Profile, session: Session, context: ToolContext, signal: AbortSignal, taskId: string, currentPlaybookName: string, clarificationsRemaining: number): Promise<RouteResolution> {
  const router = profile.workflow?.router
  if (!router) return {}
  const configuredCandidates = router.candidates ?? []
  if (configuredCandidates.length === 0) return {}
  const available = listPlaybooks()
  const candidateNames = configuredCandidates.filter(name => available.some(p => p.name === name))
  if (candidateNames.length === 0) return {}
  const mode = profile.decision_layer?.features.request_routing
  if (mode !== 'shadow' && mode !== 'enforce') return {}
  const advisor = routeAdvisor(profile, context, signal)
  if (!advisor?.chooseRoute) return { mode }

  const base = { session: session.id, profile: profile.name, kind: 'route' as const, task_id: taskId, route_mode: mode, route_candidates: candidateNames }
  try {
    const candidates = candidateNames.map(name => ({ name, description: available.find(p => p.name === name)?.description }))
    const lastAssistant = stageBody(session) || undefined
    const signals = await advisor.chooseRoute(request, candidates, session.workflow_route, lastAssistant)
    if (!signals) {
      logEvent({ ...base, route_fallback: 'incomplete or malformed route signals', route_applied: false })
      return { mode }
    }
    const decision = decideRoute(signals, router, currentPlaybookName, clarificationsRemaining, session.workflow_route)
    const applied = mode === 'enforce' && decision.kind === 'run'
    logEvent({
      ...base,
      route_domain: signals.domain,
      route_scale_distribution: signals.scale,
      route_ambiguous: signals.ambiguous,
      route_decision_kind: decision.kind,
      ...(decision.kind === 'run' ? { route_playbooks: decision.playbooks, route_scale: decision.scale } : {}),
      route_applied: applied,
    })
    return { decision, mode }
  } catch (error) {
    if (error instanceof WorkflowDecisionControlError) throw error
    // Bounded: provider error text is not ours to log in full.
    logEvent({ ...base, route_fallback: (error instanceof Error ? error.message : 'route provider error').slice(0, 200), route_applied: false })
    return { mode }
  }
}

export const FIXED_CLARIFYING_QUESTION = 'Could you clarify what exactly you want done?'

// Spec §5.6: the clarifying question's TEXT is produced by the cheap-role
// model (Jev never generates text), via the same shadowCompletion helper
// used for plan/design shadow comparisons. Any failure — empty completion,
// thrown error — falls back to a fixed generic question so an ask can never
// itself abort the run.
async function generateClarifyingQuestion(profile: Profile, context: ToolContext, openai: OpenAI | undefined, request: string): Promise<string> {
  try {
    const model = resolveRole(profile, 'cheap')
    const prompt = `Ask a single short clarifying question that would let a competent assistant start this request. Return ONLY the question, no other output.\n\nRequest: ${request.slice(0, 4_000)}`
    const question = (await shadowCompletion(openai, context.provider, model, prompt)).trim()
    return question || FIXED_CLARIFYING_QUESTION
  } catch {
    return FIXED_CLARIFYING_QUESTION
  }
}

export interface RouteDecisionResolution {
  decision?: RouteDecision
  mode?: 'shadow' | 'enforce'
  request: string
}

/**
 * Phase 3 (PT-078), spec §5.6: resolve the top-level route decision for a
 * request, asking at most `router.max_clarifications` clarifying questions
 * when the decision comes back `ask` in enforce mode. Every iteration logs
 * its own `route` event via resolveRoute; each ask logs one `clarify` event
 * (task linkage + attempt number only — no question or answer text). The
 * loop terminates on its own once `decideRoute`'s rule 1 (ambiguous +
 * clarifications remaining) can no longer fire, which happens naturally once
 * `clarificationsUsed` reaches the cap — no separate "exhausted" branch is
 * needed for that case. An unattended run (no `onInputRequest`) short-circuits
 * by re-resolving once with `clarificationsRemaining = 0` instead of asking.
 */
async function resolveRouteDecision(request: string, profile: Profile, session: Session, context: ToolContext, events: AgentLoopEvents, openai: OpenAI | undefined, signal: AbortSignal, taskId: string, currentPlaybookName: string): Promise<RouteDecisionResolution> {
  const maxClarifications = profile.workflow?.router?.max_clarifications ?? 0
  let effectiveRequest = request
  let clarificationsUsed = 0

  while (true) {
    const clarificationsRemaining = Math.max(0, maxClarifications - clarificationsUsed)
    const resolution = await resolveRoute(effectiveRequest, profile, session, context, signal, taskId, currentPlaybookName, clarificationsRemaining)
    if (!resolution.decision || resolution.mode !== 'enforce' || resolution.decision.kind !== 'ask') {
      return { decision: resolution.decision, mode: resolution.mode, request: effectiveRequest }
    }
    if (!events.onInputRequest) {
      // Unattended: no human channel to ask through. Re-decide forcing
      // clarificationsRemaining = 0 so rule 1 cannot fire, and proceed.
      const forced = await resolveRoute(effectiveRequest, profile, session, context, signal, taskId, currentPlaybookName, 0)
      return { decision: forced.decision, mode: forced.mode, request: effectiveRequest }
    }
    const question = await generateClarifyingQuestion(profile, context, openai, effectiveRequest)
    const id = randomUUID().replace(/-/g, '').slice(0, 8)
    const answer = await events.onInputRequest(id, question, 'text')
    clarificationsUsed++
    logEvent({ session: session.id, profile: profile.name, kind: 'clarify', task_id: taskId, attempt: clarificationsUsed })
    effectiveRequest = `${effectiveRequest}\n\nClarification: ${answer}`
  }
}

// Spec §5.2/§6 phase 3: merge a route decision's per-stage intensity floor
// into a plan as max(existing, floor), then re-run the existing clampIntensity
// so profile min_intensity/max_intensity still win. clampIntensity already
// forces recon >= 1 unconditionally; the explicit check below asserts that
// invariant rather than silently trusting it.
function applyIntensityFloor(plan: TaskPlan, floor: Partial<IntensityMap> | undefined, workflow?: Profile['workflow']): TaskPlan {
  if (!floor) return plan
  const intensity = { ...plan.intensity }
  for (const stage of STAGES) {
    const floorValue = floor[stage]
    if (floorValue !== undefined) intensity[stage] = Math.max(intensity[stage], floorValue) as Intensity
  }
  const clamped = clampIntensity({ ...plan, intensity }, workflow)
  if (clamped.intensity.recon < 1) throw new Error('workflow invariant violated: recon intensity floor produced recon < 1')
  return clamped
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
  const combineUsage = (stageUsage?: UsageMetadata): UsageMetadata | undefined => {
    if (!stageUsage && !root.usage.billing_mode && !root.usage.cost_basis && root.usage.billed_cost_usd === undefined && root.usage.api_estimate_usd === undefined && root.usage.api_equivalent_usd === undefined && root.usage.usage_status === undefined && root.usage.cached_input_tokens === undefined && root.usage.reasoning_output_tokens === undefined && root.usage.model_attempts === undefined) return undefined
    const combined: UsageMetadata = {
      billing_mode: root.usage.billing_mode,
      cost_basis: root.usage.cost_basis,
      billed_cost_usd: root.usage.billed_cost_usd,
      api_estimate_usd: root.usage.api_estimate_usd,
      api_equivalent_usd: root.usage.api_equivalent_usd,
      usage_status: root.usage.usage_status,
      cached_input_tokens: root.usage.cached_input_tokens,
      reasoning_output_tokens: root.usage.reasoning_output_tokens,
      model_attempts: root.usage.model_attempts,
    }
    if (stageUsage) {
      if (stageUsage.billing_mode !== undefined) combined.billing_mode = combined.billing_mode && combined.billing_mode !== stageUsage.billing_mode ? 'mixed' : stageUsage.billing_mode
      if (stageUsage.cost_basis !== undefined) combined.cost_basis = combined.cost_basis && combined.cost_basis !== stageUsage.cost_basis ? 'mixed' : stageUsage.cost_basis
      if (combined.billed_cost_usd === null || stageUsage.billed_cost_usd === null) combined.billed_cost_usd = null
      else if (combined.billed_cost_usd === undefined) combined.billed_cost_usd = stageUsage.billed_cost_usd
      else if (stageUsage.billed_cost_usd !== undefined) combined.billed_cost_usd += stageUsage.billed_cost_usd
      for (const key of ['api_estimate_usd', 'api_equivalent_usd', 'cached_input_tokens', 'reasoning_output_tokens', 'model_attempts'] as const) {
        if (stageUsage[key] !== undefined) combined[key] = (combined[key] ?? 0) + stageUsage[key]!
      }
      const rank = { complete: 0, partial: 1, unknown: 2, estimated: 3 }
      if (stageUsage.usage_status !== undefined && (combined.usage_status === undefined || rank[stageUsage.usage_status] > rank[combined.usage_status])) combined.usage_status = stageUsage.usage_status
    }
    return combined
  }
  return { ...events, onSessionEnd: () => {}, onStats: (input, output, cost, contextTokens, agentId, usage) => events.onStats?.(root.usage.input + input, root.usage.output + output, root.usage.cost_usd + cost, contextTokens, agentId, combineUsage(usage)) }
}

function mergeStageUsage(root: Session, staged: Session): void {
  mergeUsageDelta(root.usage, staged.usage)
}

async function shadowCompletion(openai: OpenAI | undefined, provider: ProviderClient | undefined, model: string, prompt: string): Promise<string> {
  if (provider) return (await provider.generate({ model, stream: false, maxTokens: 800, temperature: 0, messages: [{ role: 'user', content: prompt }] }, { purpose: 'workflow-shadow' })).text
  if (!openai) throw new Error('workflow provider unavailable')
  const response = await (openai.chat.completions as any).create({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 800, temperature: 0 })
  return String(response.choices?.[0]?.message?.content ?? '')
}

// Exported (beyond runner.ts's internal callers) so PT-076's playbook-threading
// refactor — executeStage uses the `playbook` argument instead of re-resolving
// it from `profile.workflow?.playbook` — can be unit-tested directly with a
// playbook that differs from the profile's configured one.
export async function executeStage(request: string, stage: Stage, intensity: Intensity, tier: Tier, attempt: number, taskId: string, plan: TaskPlan, profile: Profile, playbook: Playbook, root: Session, context: ToolContext, events: AgentLoopEvents, openai: OpenAI | undefined, signal: AbortSignal, prior: Array<{ stage: Stage; body: string }>, graphSlice: string, loop: typeof runAgentLoop, explore = false, persistArtifact = true, parentTaskId?: string): Promise<StageResult> {
  const modelId = tier === 'critic' ? (profile.models?.roles.critic ?? profile.model.id) : (profile.models?.roles?.[tier] ?? profile.model.id)
  const contract = playbook.contract(stage, intensity)
  const seed = buildStageContext(request, prior, contract, stage === 'recon' ? graphSlice : '')
  const stageId = newStageId()
  const staged = childSession(root, stageId, seed)
  if (context.stageSystemPromptAppend) {
    const messages = staged.messages as Array<{ role: string; content?: string }>
    const stageSystem = messages.find(message => message.role === 'system')
    if (stageSystem) stageSystem.content = `${stageSystem.content ?? ''}\n\n${context.stageSystemPromptAppend}`
  }
  const stageBudget = context.budget
    ? context.budget.allocate(context.budget.remainingCost())
    : undefined
  const stageContext = {
    ...context,
    session: staged,
    events: stageEvents(root, events),
    ...(stageBudget ? { budget: stageBudget } : {}),
  }
  if (context.provider) stageContext.provider = bindRunProvider(context.provider, stageContext)
  const started = Date.now()
  events.onStage?.(stage, intensity, tier, modelId, 'start')
  logEvent({ session: root.id, profile: profile.name, kind: 'stage', task_id: taskId, stage_id: stageId, stage, intensity, tier, task_class: plan.task_class, blast_radius: plan.blast_radius, reversibility: plan.reversibility, playbook: playbook.name, attempt, model: modelId, state: 'start', ...(parentTaskId ? { parent_task_id: parentTaskId } : {}) })
  try {
    await loop(seed, profile, staged, stageContext, stageContext.events, openai, signal, { modelId, stage: { task_id: taskId, stage_id: stageId, stage, attempt, intensity, tier, task_class: plan.task_class, blast_radius: plan.blast_radius, playbook: playbook.name, explore } })
  } finally {
    root.tool_calls.push(...staged.tool_calls)
    mergeStageUsage(root, staged)
    if (stageBudget && context.budget) context.budget.absorbChildUsage(stageBudget, staged.usage.cost_usd)
  }
  const body = stageBody(staged)
  const validation = validateArtifact(body, contract)
  if (persistArtifact) writeArtifact(profile, root, stage, body, { intensity, tier, model: modelId, confidence: plan.confidence, contract_ok: validation.ok, attempt, task_id: taskId })
  if (profile.workflow?.knowledge.graph) {
    const knowledge = await extractKnowledge(body, stage, openai, profile, context.provider)
    const generalized = stage === 'review' && profile.workflow.knowledge.generalization_probe ? generalizationFromReview(body) : { nodes: [], edges: [] }
    await persistKnowledge(context.memory, [...knowledge.nodes, ...generalized.nodes], [...knowledge.edges, ...generalized.edges]).catch(() => {})
  }
  const result: StageResult = { stage, intensity, tier, modelId, attempt, body, contract_ok: validation.ok, missing: validation.missing, confidence: plan.confidence, high_findings: stage === 'review' && /\bhigh\b/i.test(body) ? 1 : 0 }
  const escalation = shouldEscalate(result)
  logEvent({ session: root.id, profile: profile.name, kind: 'stage', task_id: taskId, stage_id: stageId, stage, intensity, tier, task_class: plan.task_class, blast_radius: plan.blast_radius, reversibility: plan.reversibility, playbook: playbook.name, attempt, model: modelId, state: escalation.escalate ? 'escalated' : 'done', contract_ok: validation.ok, cost_usd: staged.usage.cost_usd, duration_ms: Date.now() - started, escalated_from: escalation.escalate ? tier : undefined, failed_back_to: failBackTarget(result) ?? undefined, explore, ...(parentTaskId ? { parent_task_id: parentTaskId } : {}) })
  events.onStage?.(stage, intensity, tier, modelId, escalation.escalate ? 'escalated' : 'done', staged.usage.cost_usd)
  return result
}

function cloneSession(session: Session): Session {
  return JSON.parse(JSON.stringify(session)) as Session
}

/** Run only recon and plan against an isolated session for interactive rehearsal. */
export async function runPlanPreview(request: string, profile: Profile, session: Session, context: ToolContext, events: AgentLoopEvents, openai: OpenAI | undefined, signal: AbortSignal = new AbortController().signal, loop: typeof runAgentLoop = runAgentLoop): Promise<PlanPreview> {
  const taskId = newTaskId()
  const playbook = loadPlaybook(profile.workflow?.playbook ?? 'generic')
  const previewSession = cloneSession(session)
  const previewContext = { ...context, session: previewSession }
  if (context.provider) previewContext.provider = bindRunProvider(context.provider, previewContext)
  const usageBefore = { ...previewSession.usage }
  try {
    const decision = workflowAdvisor(profile, previewContext, signal)
    const fixedTriage = triageIsFixed(profile)
    const triage = fixedTriage
      ? { task_class: playbook.task_classes[0] ?? 'general', recon_intensity: Math.max(1, profile.workflow?.min_intensity.recon ?? 1) as Intensity }
      : await triageA(request, playbook, openai, profile, previewContext.provider, decision)
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
    const recon = await executeStage(request, 'recon', Math.max(1, reconPlan.intensity.recon) as Intensity, reconRouting.tier, 1, taskId, reconPlan, profile, playbook, previewSession, previewContext, events, openai, signal, prior, graphSlice, loop, false, false)
    prior.push({ stage: 'recon', body: recon.body })
    const plan = fixedTriage
      ? defaultTaskPlan(playbook, triage.task_class, profile.workflow)
      : await triageB(request, recon.body, playbook, openai, profile, triage.task_class, previewContext.provider, decision)
    const intensity = Math.max(1, plan.intensity.plan) as Intensity
    const routing = resolveTier(profile, 'plan', plan.task_class, undefined, playbook.name)
    const result = await executeStage(request, 'plan', intensity, routing.tier, 1, taskId, plan, profile, playbook, previewSession, previewContext, events, openai, signal, prior, graphSlice, loop, false, false)
    return { taskId, body: result.body, intensity, tier: routing.tier, model: result.modelId, contract_ok: result.contract_ok, attempt: result.attempt }
  } finally {
    mergeUsageDelta(session.usage, usageDeltaFromSession(usageBefore, previewSession.usage))
  }
}

interface PassShared {
  profile: Profile
  session: Session
  context: ToolContext
  events: AgentLoopEvents
  openai: OpenAI | undefined
  signal: AbortSignal
  loop: typeof runAgentLoop
  maxRetries: number
  maxCost: number
  workflowDeadline: number
  adaptivePolicy?: RoutingPolicyDoc
}

interface PassOptions {
  taskId: string
  playbook: Playbook
  intensityFloor?: Partial<IntensityMap>
  /** Prior artifacts from an earlier pass (spec §5.3 multi-domain chaining), used as stage context but excluded from this pass's own outcome stats. */
  priorArtifacts: Array<{ stage: Stage; body: string }>
  parentTaskId?: string
}

type PassOutcome =
  | { verdict: 'accepted'; artifacts: Array<{ stage: Stage; body: string }> }
  | { verdict: 'abandoned'; reason: string }
  | { verdict: 'budget_exhausted' }
  | { verdict: 'aborted' }

/**
 * One playbook pass of the workflow state machine (stage pointer, fail-back,
 * tier promotion) — the body of pre-phase-3 `runWorkflow`, extracted so
 * `runWorkflow` can run it once for a single-domain request or twice in
 * sequence for a multi-domain one (spec §5.3). Does NOT call
 * `events.onSessionEnd` — the caller does that exactly once per `runWorkflow`
 * call (item 4 of the phase 3 task). Does NOT push the user message to
 * `session.messages` — the caller does that once, before any pass runs.
 */
async function runWorkflowPass(request: string, shared: PassShared, opts: PassOptions): Promise<PassOutcome> {
  const { profile, session, context, events, openai, signal, loop, maxRetries, maxCost, workflowDeadline, adaptivePolicy } = shared
  const { taskId, playbook, intensityFloor, priorArtifacts, parentTaskId } = opts
  const decision = workflowAdvisor(profile, context, signal)
  const fixedTriage = triageIsFixed(profile)
  const rawTriage = fixedTriage
    ? { task_class: playbook.task_classes[0] ?? 'general', recon_intensity: Math.max(1, profile.workflow?.min_intensity.recon ?? 1) as Intensity }
    : await triageA(request, playbook, openai, profile, context.provider, decision)
  // Only the routed floor is capped by profile max_intensity.recon; triage's own
  // recon choice keeps today's behavior. Recon never drops below 1.
  const reconFloor = Math.min(intensityFloor?.recon ?? 0, profile.workflow?.max_intensity.recon ?? 3)
  const reconIntensity = Math.max(1, rawTriage.recon_intensity, reconFloor) as Intensity
  if (reconIntensity < 1) throw new Error('workflow invariant violated: recon intensity floor produced recon < 1')
  const triage = { task_class: rawTriage.task_class, recon_intensity: reconIntensity }
  const graphSlice = await queryProjectGraph(context.memory, request).catch(() => 'no prior project knowledge')
  const reconPlan: TaskPlan = {
    task_class: triage.task_class,
    blast_radius: 'module',
    reversibility: 'easy',
    intensity: { recon: triage.recon_intensity, plan: 0, design: 0, build: 0, verify: 0, review: 0 },
    confidence: 0.5,
    why: 'triage-A',
  }
  const artifacts: Array<{ stage: Stage; body: string }> = [...priorArtifacts]
  const toolCallsBefore = session.tool_calls.length
  const tierOverrides = new Map<Stage, Tier>()
  let reentries = 0
  let plan: TaskPlan | undefined
  let pointer = 0
  let reconAttempts = 0
  const failureCounts = new Map<Stage, number>()
  let finalResult: StageResult | undefined

  const ownArtifacts = () => artifacts.slice(priorArtifacts.length)
  const budgetExhausted = () => session.usage.cost_usd >= maxCost || Date.now() >= workflowDeadline || (context.deadline !== undefined && Date.now() >= context.deadline)
  const plainFallback = async (reason: string) => {
    emitTaskOutcome(session, { task_id: taskId, stages_run: ownArtifacts().length, rework_count: reentries, escalations: reentries, verify_first_try: false, review_findings: { high: 0, med: 0, low: 0 }, verdict: 'abandoned', reason, ...(parentTaskId ? { parent_task_id: parentTaskId } : {}) })
    await loop(request, profile, session, context, events, openai, signal, { appendUser: false })
  }

  claimCheckLoop: while (true) {
  while (pointer < playbook.stages.length) {
    if (signal.aborted) return { verdict: 'aborted' }
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
      logEvent({ session: session.id, profile: profile.name, kind: 'stage', task_id: taskId, stage_id: newStageId(), stage, intensity: 0, tier: routing.tier, task_class: activePlan.task_class, blast_radius: activePlan.blast_radius, reversibility: activePlan.reversibility, playbook: playbook.name, attempt: 0, model: routing.modelId, state: 'skipped', contract_ok: true, cost_usd: 0, ...(parentTaskId ? { parent_task_id: parentTaskId } : {}) })
      pointer++
      continue
    }
    if (budgetExhausted()) { await plainFallback('workflow budget exhausted'); return { verdict: 'budget_exhausted' } }

    const attempt = (stage === 'recon' ? reconAttempts : 0) + 1
    if (stage === 'recon') reconAttempts++
    const result = await executeStage(request, stage, intensity, exploration.tier, attempt, taskId, activePlan, profile, playbook, session, context, events, openai, signal, artifacts, graphSlice, loop, exploration.explore, true, parentTaskId)
    finalResult = result
    artifacts.push({ stage, body: result.body })

    if (stage === 'plan' || stage === 'design') {
      const contract = playbook.contract(stage, intensity)
      const shadow = await maybeShadow(
        stage,
        activePlan,
        profile,
        model => shadowCompletion(openai, context.provider, model, buildStageContext(request, artifacts.slice(0, -1), contract)),
        (blind, critic) => shadowCompletion(openai, context.provider, critic, `Judge Artifact A and Artifact B blind. State which is stronger and why.\n${blind}`),
        { chosenTier: exploration.tier },
      )
      if (shadow) {
        const shadowId = newStageId()
        logEvent({ session: session.id, profile: profile.name, kind: 'stage', task_id: taskId, stage_id: shadowId, stage, intensity, tier: 'cheap', task_class: activePlan.task_class, blast_radius: activePlan.blast_radius, reversibility: activePlan.reversibility, playbook: playbook.name, attempt, model: resolveRole(profile, 'cheap'), state: 'done', contract_ok: true, explore: true, ...(parentTaskId ? { parent_task_id: parentTaskId } : {}) })
        logEvent({ session: session.id, profile: profile.name, kind: 'outcome', task_id: taskId, verdict: 'accepted', stages_run: 1, rework_count: 0, escalations: 0, verify_first_try: true, review_findings: { high: 0, med: 0, low: 0 }, total_cost_usd: 0, reason: `shadow comparison: ${shadow.verdict ?? 'no verdict'}`, explore: true, ...(parentTaskId ? { parent_task_id: parentTaskId } : {}) })
      }
    }

    if (stage === 'recon') {
      if (!result.contract_ok) {
        if (reentries >= maxRetries) {
          emitTaskOutcome(session, { task_id: taskId, stages_run: ownArtifacts().length, rework_count: reentries, escalations: reentries, verify_first_try: false, review_findings: { high: 0, med: 0, low: 0 }, verdict: 'abandoned', reason: 'recon gate failed', ...(parentTaskId ? { parent_task_id: parentTaskId } : {}) })
          return { verdict: 'abandoned', reason: 'recon gate failed' }
        }
        reentries++
        reconPlan.intensity.recon = Math.min(3, reconPlan.intensity.recon + 1) as Intensity
        tierOverrides.set('recon', promoteTier(selectedTier))
        continue
      }
      plan = fixedTriage
        ? defaultTaskPlan(playbook, triage.task_class, profile.workflow)
        : await triageB(request, result.body, playbook, openai, profile, triage.task_class, context.provider, decision)
      plan = applyIntensityFloor(plan, intensityFloor, profile.workflow)
      pointer++
      continue
    }

    const escalation = shouldEscalate(result)
    if (!escalation.escalate) failureCounts.delete(stage)
    if (escalation.escalate) {
      if (reentries >= maxRetries) {
        emitTaskOutcome(session, { task_id: taskId, stages_run: ownArtifacts().length, rework_count: reentries, escalations: reentries, verify_first_try: false, review_findings: { high: 0, med: 0, low: 0 }, verdict: 'abandoned', reason: `${stage}: ${escalation.reason}`, ...(parentTaskId ? { parent_task_id: parentTaskId } : {}) })
        return { verdict: 'abandoned', reason: `${stage}: ${escalation.reason}` }
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

  // Roadmap #31 phase 5 (PT-080), spec §5.7/§6: single hook call for the
  // verify claim-check. Reached only on the pass's natural completion (no
  // early return above) — which already implies "a verify stage ran without
  // escalating" or "this playbook never ran verify" (§5.7's two trigger
  // cases), so one call here covers both. All extraction/evidence/gating
  // logic lives in claims.ts; this loop only applies its action.
  const claimGate = await runClaimCheck({ profile, session, context, signal, taskId, playbook, ownArtifacts: ownArtifacts(), toolCallsBefore, request, reentries, maxRetries, parentTaskId })
  if (claimGate.action === 'retry') {
    reentries++
    pointer = claimGate.pointer
    continue claimCheckLoop
  }
  if (claimGate.action === 'abandon') {
    emitTaskOutcome(session, { task_id: taskId, stages_run: ownArtifacts().length, rework_count: reentries, escalations: reentries, verify_first_try: false, review_findings: { high: 0, med: 0, low: 0 }, verdict: 'abandoned', reason: claimGate.reason, ...(parentTaskId ? { parent_task_id: parentTaskId } : {}) })
    return { verdict: 'abandoned', reason: claimGate.reason }
  }
  break claimCheckLoop
  }

  const writtenFiles = session.tool_calls
    .slice(toolCallsBefore)
    .filter(call => ['Write', 'Edit'].includes(call.name))
    .map(call => call.input.path ?? call.input.file_path)
    .filter((path): path is string => typeof path === 'string')
  if (writtenFiles.length > 0) recordWrittenFiles(profile, session, taskId, writtenFiles)
  const own = ownArtifacts()
  const finalBody = own[own.length - 1]?.body ?? finalResult?.body ?? ''
  session.messages.push({ role: 'assistant', content: finalBody })
  emitTaskOutcome(session, {
    task_id: taskId,
    stages_run: own.length,
    rework_count: reentries,
    escalations: reentries,
    verify_first_try: !own.some(a => a.stage === 'verify' && /\b(fail|error|broken|incorrect)\b/i.test(a.body)),
    review_findings: { high: own.filter(a => a.stage === 'review' && /\bhigh\b/i.test(a.body)).length, med: 0, low: 0 },
    verdict: 'accepted',
    ...(parentTaskId ? { parent_task_id: parentTaskId } : {}),
  })
  return { verdict: 'accepted', artifacts: own }
}

export async function runWorkflow(request: string, profile: Profile, session: Session, context: ToolContext, events: AgentLoopEvents, openai: OpenAI | undefined, signal: AbortSignal = new AbortController().signal, options: WorkflowRunOptions = {}): Promise<void> {
  const taskId = options.taskId ?? newTaskId()
  const fallbackPlaybookName = profile.workflow?.playbook ?? 'generic'
  const fallbackPlaybook = loadPlaybook(fallbackPlaybookName)
  const loop = options.loop ?? runAgentLoop
  const maxRetries = profile.workflow?.budget.max_stage_retries ?? 2
  const maxCost = profile.workflow?.budget.max_usd_per_task ?? 2
  const startedAt = Date.now()
  const workflowDeadline = startedAt + (profile.workflow?.budget.max_stage_minutes ?? 15) * 60_000
  context.deadline = Math.min(context.deadline ?? Infinity, workflowDeadline)
  let adaptivePolicy: RoutingPolicyDoc | undefined
  if (profile.workflow?.routing.policy === 'adaptive') {
    try { adaptivePolicy = parseRoutingPolicy((await context.memory.read('project', 'routing-policy'))?.content) } catch { adaptivePolicy = undefined }
  }

  // Roadmap #31 phase 3 (PT-078), spec §5.6: resolve (and, in enforce mode,
  // possibly ask a clarifying question about) the routing decision for the
  // whole request exactly once, before any stage runs. A `run` decision's
  // `playbooks` array already carries both the primary and (when present)
  // the secondary playbook for the multi-domain pass below (spec §5.3) — no
  // separate fan-out call happens per pass.
  const routeResolution = await resolveRouteDecision(request, profile, session, context, events, openai, signal, taskId, fallbackPlaybookName)
  const effectiveRequest = routeResolution.request
  const decision = routeResolution.decision
  const routeMode = routeResolution.mode
  const enforceRun = routeMode === 'enforce' && decision?.kind === 'run'
  const primaryPlaybook = enforceRun ? loadPlaybook(decision.primary) : fallbackPlaybook
  const intensityFloor = enforceRun ? decision.intensityFloor : undefined
  const secondaryPlaybookName = enforceRun && decision.playbooks.length === 2 ? decision.playbooks[1] : undefined

  session.messages.push({ role: 'user', content: effectiveRequest })

  const shared: PassShared = { profile, session, context, events, openai, signal, loop, maxRetries, maxCost, workflowDeadline, adaptivePolicy }

  const primaryOutcome = await runWorkflowPass(effectiveRequest, shared, {
    taskId,
    playbook: primaryPlaybook,
    intensityFloor,
    priorArtifacts: [],
  })

  // Aborted runs never ended the session before phase 3. Budget exhaustion
  // runs the flat loop via plainFallback, which ends the session itself.
  if (primaryOutcome.verdict === 'aborted' || primaryOutcome.verdict === 'budget_exhausted') return

  if (primaryOutcome.verdict === 'abandoned') {
    events.onSessionEnd(session.id)
    return
  }

  // Spec §5.5: session route memory is written on an accepted outcome
  // whenever a `run` decision existed, in shadow OR enforce — shadow only
  // feeds the next `chooseRoute`'s `continues_previous` state, never applies.
  if (decision?.kind === 'run') {
    session.workflow_route = { playbook: decision.primary, scale: decision.scale, task_id: taskId, at: new Date().toISOString() }
  }

  if (secondaryPlaybookName) {
    const secondaryTaskId = newTaskId()
    const priorArtifact = primaryOutcome.artifacts[primaryOutcome.artifacts.length - 1]
    const secondaryOutcome = await runWorkflowPass(effectiveRequest, shared, {
      taskId: secondaryTaskId,
      playbook: loadPlaybook(secondaryPlaybookName),
      intensityFloor,
      priorArtifacts: priorArtifact ? [priorArtifact] : [],
      parentTaskId: taskId,
    })
    if (secondaryOutcome.verdict === 'aborted' || secondaryOutcome.verdict === 'budget_exhausted') return
  }

  events.onSessionEnd(session.id)
}
