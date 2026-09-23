import type { DecisionAnswer, DecisionEvaluateOptions, DecisionOutcome, DecisionProvider, DecisionQuestion, JsonValue, NoulAnswer } from './types.js'
import { WorkflowDecisionControlError } from './workflow.js'
import type { ClaimEvidence } from '../workflow/claims.js'

/**
 * Request routing graph (roadmap #31), Phase 5 — PT-080, spec §5.7. The Jev
 * side of the verify claim-check: one `evaluate` call, one Noul question per
 * claim ("The provided evidence supports this claim: <claim>"). Kept
 * separate from `src/workflow/claims.ts` (pure extraction/evidence/gate
 * logic, no I/O) so the Jev wiring can be unit-tested independently, mirroring
 * the split between `route.ts` (pure policy) and `chooseRoute` in
 * `src/decisions/workflow.ts` (the Jev call).
 */

function bounded(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function noul(outcome: Extract<DecisionOutcome, { kind: 'success' }>, key: string): number | undefined {
  const answer: DecisionAnswer | undefined = outcome.response.answers[key]
  return answer?.type === 'noul' && typeof (answer as NoulAnswer).noul === 'number' ? (answer as NoulAnswer).noul : undefined
}

function questionKey(index: number): string {
  return `claim_${index}`
}

/**
 * Returns one probability per claim (same order as `claims`), or `undefined`
 * on any malformed/incomplete response — defensive parse, never throws for
 * that case. A control outcome (cancelled/deadline/etc.) still propagates as
 * `WorkflowDecisionControlError`, same as every other decision-layer call
 * site; callers must NOT swallow that one.
 */
export async function checkClaims(
  provider: DecisionProvider,
  model: string,
  claims: string[],
  evidence: ClaimEvidence,
  request: string,
  options?: { signal?: AbortSignal; evaluateOptions?: Omit<DecisionEvaluateOptions, 'signal'> },
): Promise<number[] | undefined> {
  if (claims.length === 0) return undefined

  const questions: Record<string, DecisionQuestion> = {}
  claims.forEach((claim, index) => {
    questions[questionKey(index)] = {
      type: 'noul',
      instructions: `The provided evidence supports this claim: ${claim}`,
    }
  })

  const state: JsonValue = {
    request: bounded(request, 4_000),
    evidence: evidence.items.map(item => ({ tool: item.tool, ok: item.ok, result: bounded(item.result, 1_500) })),
    tainted: evidence.tainted,
  }

  const outcome = await provider.evaluate({ model, state, questions }, { ...options?.evaluateOptions, signal: options?.signal })
  if (outcome.kind === 'control') throw new WorkflowDecisionControlError(outcome.reason)
  if (outcome.kind !== 'success') return undefined

  const probabilities: number[] = []
  for (let index = 0; index < claims.length; index++) {
    const p = noul(outcome, questionKey(index))
    if (p === undefined) return undefined
    probabilities.push(p)
  }
  return probabilities
}
