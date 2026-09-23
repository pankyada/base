import type { Session, SessionToolCall } from '../session/types.js'
import type { Playbook, Stage } from './types.js'
import type { Profile } from '../profiles/schema.js'
import type { ToolContext } from '../tools/types.js'
import { DecisionRuntimeService } from '../decisions/runtime.js'
import { checkClaims } from '../decisions/claims.js'
import { WorkflowDecisionControlError } from '../decisions/workflow.js'
import { logEvent } from '../telemetry/logger.js'

/**
 * Request routing graph (roadmap #31), Phase 5 — PT-080. Verify claim-check
 * per spec §5.7: claim extraction, evidence assembly, and the gate decision
 * are pure code (below); `runClaimCheck` at the bottom of this file is the
 * one stateful orchestration point (Jev call + telemetry) that
 * `src/workflow/runner.ts` invokes behind a single hook call (spec §6 phase
 * 5). The Jev call itself lives in `src/decisions/claims.ts` (`checkClaims`).
 */

// A claim is "checkable" when it contains a number, a file-like path/name,
// or one of the common assertion verbs a verify/build artifact uses to state
// a fact about the work. Deliberately code, not an LLM call — deterministic
// and cheap; Jev only judges whether the *evidence* backs the claim.
const NUMBER_PATTERN = /\d/
const FILE_PATTERN = /\b[\w.-]+\/[\w./-]*\w\b|\b[\w-]+\.[a-zA-Z]{1,10}\b/
const ASSERTION_VERB_PATTERN = /\b(passes?|passed|fails?|failed|is|are|was|were|returns?|returned|contains?|contained|equals?)\b/i

const MAX_CLAIMS = 8
const MIN_CLAIM_LENGTH = 12

/**
 * Split an artifact into candidate claims (sentences/bullets), keep the ones
 * that look checkable, dedupe, and cap at `MAX_CLAIMS` — preferring earlier
 * claims over later ones (the loop stops as soon as the cap is hit).
 * Deterministic: same input always yields the same output.
 */
export function extractClaims(artifact: string): string[] {
  if (!artifact) return []
  const pieces = artifact
    .split(/\r?\n/)
    .flatMap(line => line.replace(/^[\s>*\-\d.)#]+/, '').split(/(?<=[.!?])\s+/))
    .map(piece => piece.trim())
    .filter(Boolean)

  const claims: string[] = []
  const seen = new Set<string>()
  for (const piece of pieces) {
    if (claims.length >= MAX_CLAIMS) break
    if (piece.length < MIN_CLAIM_LENGTH) continue
    const checkable = NUMBER_PATTERN.test(piece) || FILE_PATTERN.test(piece) || ASSERTION_VERB_PATTERN.test(piece)
    if (!checkable) continue
    const key = piece.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    claims.push(piece)
  }
  return claims
}

export interface ClaimEvidenceItem { tool: string; ok: boolean; result: string }
export interface ClaimEvidence { items: ClaimEvidenceItem[]; tainted: boolean }

const MAX_ITEM_CHARS = 1_500
const MAX_TOTAL_CHARS = 8_000

/**
 * Evidence is the pass's own tool calls since `toolCallsBefore` (the same
 * slicing idea `runWorkflowPass` already uses for `writtenFiles`), newest
 * first, each result bounded and the whole set capped. Mirrors
 * `DecisionAdvisoryService`'s taint semantics: `tainted` is set whenever the
 * session carries any `taint_sources`, and the caller (checkClaims) passes it
 * through to Jev rather than filtering evidence out — the check still runs,
 * it just knows the evidence may be untrusted.
 * Returns `undefined` when there is no evidence at all, so the caller can
 * skip the check entirely rather than ever failing on absence of evidence.
 */
export function buildClaimEvidence(session: Session, toolCallsBefore: number): ClaimEvidence | undefined {
  const calls: SessionToolCall[] = session.tool_calls.slice(toolCallsBefore)
  if (calls.length === 0) return undefined
  const tainted = Boolean(session.taint_sources && session.taint_sources.length > 0)
  const items: ClaimEvidenceItem[] = []
  let total = 0
  for (const call of [...calls].reverse()) {
    const result = String(call.result ?? '').slice(0, MAX_ITEM_CHARS)
    if (total + result.length > MAX_TOTAL_CHARS) break
    items.push({ tool: call.name, ok: call.ok, result })
    total += result.length
  }
  if (items.length === 0) return undefined
  return { items, tainted }
}

export const CLAIM_FAIL_THRESHOLD = 0.3

export type ClaimGateVerdict = 'pass' | 'fail'

/** Pure gate policy per spec §5.7: any claim with p < 0.3 fails the gate. */
export function decideClaimGate(probabilities: number[]): { verdict: ClaimGateVerdict; minP: number } {
  const minP = probabilities.length > 0 ? Math.min(...probabilities) : 1
  return { verdict: minP < CLAIM_FAIL_THRESHOLD ? 'fail' : 'pass', minP }
}

/**
 * Where to resume the pass after a failed claim-check (spec §5.7/§5.4-style
 * re-entry): the playbook's `build` stage, or the stage immediately before
 * `verify` when the playbook has no `build` stage. Never before `recon`
 * (index 0), which is always the first stage of any playbook.
 */
export function claimRetryPointer(stages: Stage[]): number {
  const buildIdx = stages.indexOf('build')
  if (buildIdx >= 0) return buildIdx
  const verifyIdx = stages.indexOf('verify')
  if (verifyIdx > 0) return verifyIdx - 1
  return 0
}

/** Did this pass already run a `verify` stage (spec §5.7 trigger rule)? */
export function hasVerifyArtifact(ownArtifacts: Array<{ stage: Stage; body: string }>): boolean {
  return ownArtifacts.some(a => a.stage === 'verify')
}

export interface ClaimCheckHookInput {
  profile: Profile
  session: Session
  context: ToolContext
  signal: AbortSignal
  taskId: string
  playbook: Playbook
  /** This pass's own artifacts only (already excludes multi-domain `priorArtifacts`). */
  ownArtifacts: Array<{ stage: Stage; body: string }>
  /** Same slicing idea `runWorkflowPass` uses for `writtenFiles`: this pass's tool calls start here. */
  toolCallsBefore: number
  request: string
  /** The pass's current re-entry count, checked against `maxRetries` before granting another one. */
  reentries: number
  maxRetries: number
  parentTaskId?: string
}

export type ClaimCheckAction =
  | { action: 'retry'; pointer: number }
  | { action: 'abandon'; reason: string }
  | { action: 'none' }

function claimCheckAdvisorReady(profile: Profile, context: ToolContext): { model: string } | undefined {
  const config = profile.decision_layer
  const mode = config?.features.claim_check
  if (!config || (mode !== 'shadow' && mode !== 'enforce') || !config.model) return undefined
  if (!(context.decisionRuntime instanceof DecisionRuntimeService) || !context.decisionRuntime.provider) return undefined
  return { model: config.model }
}

/**
 * The single stateful orchestration point for the claim-check hook: gates on
 * `decision_layer.features.claim_check` (same runtime/provider availability
 * pattern as `routeAdvisor`/`workflowAdvisor` in runner.ts), extracts claims
 * from the pass's final artifact, assembles evidence, calls Jev once via
 * `checkClaims`, logs one bounded `claim_check` telemetry event (never claim
 * or evidence text), and returns the action for `runWorkflowPass` to apply.
 *
 * Absent/disabled feature, no runtime, no claims, or no evidence all return
 * `{ action: 'none' }` with zero Jev calls except where noted — byte-identical
 * behavior to today per spec invariant 2. A `WorkflowDecisionControlError`
 * from `checkClaims` propagates (mirrors every other decision-layer call
 * site); any other provider failure degrades to a logged `claim_fallback`
 * and `{ action: 'none' }` — claim-check failure never blocks the run.
 */
export async function runClaimCheck(input: ClaimCheckHookInput): Promise<ClaimCheckAction> {
  const { profile, session, context, signal, taskId, playbook, ownArtifacts, toolCallsBefore, request, reentries, maxRetries, parentTaskId } = input
  const ready = claimCheckAdvisorReady(profile, context)
  if (!ready) return { action: 'none' }
  const mode = profile.decision_layer!.features.claim_check as 'shadow' | 'enforce'

  const base = { session: session.id, profile: profile.name, kind: 'claim_check' as const, task_id: taskId, ...(parentTaskId ? { parent_task_id: parentTaskId } : {}) }

  const finalArtifact = ownArtifacts[ownArtifacts.length - 1]?.body ?? ''
  const claims = extractClaims(finalArtifact)
  const evidence = claims.length > 0 ? buildClaimEvidence(session, toolCallsBefore) : undefined
  if (claims.length === 0 || !evidence) {
    logEvent({ ...base, claim_skipped: 'no_evidence', claim_applied: false })
    return { action: 'none' }
  }

  const runtime = context.decisionRuntime as DecisionRuntimeService
  try {
    const probabilities = await checkClaims(runtime.provider!, ready.model, claims, evidence, request, { signal, evaluateOptions: runtime.evaluateOptions(signal) })
    if (!probabilities) {
      logEvent({ ...base, claim_count: claims.length, claim_fallback: 'incomplete or malformed claim-check response', claim_applied: false })
      return { action: 'none' }
    }
    const { verdict, minP } = decideClaimGate(probabilities)
    const applied = mode === 'enforce' && verdict === 'fail'
    logEvent({ ...base, claim_count: claims.length, claim_min_p: minP, claim_verdict: verdict, claim_applied: applied })
    if (!applied) return { action: 'none' }
    if (reentries >= maxRetries) return { action: 'abandon', reason: 'claim-check failed' }
    return { action: 'retry', pointer: claimRetryPointer(playbook.stages) }
  } catch (error) {
    if (error instanceof WorkflowDecisionControlError) throw error
    // Bounded: provider error text is not ours to log in full.
    logEvent({ ...base, claim_count: claims.length, claim_fallback: (error instanceof Error ? error.message : 'claim-check provider error').slice(0, 200), claim_applied: false })
    return { action: 'none' }
  }
}
