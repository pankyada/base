import type { EdgeJudgment } from '../decisions/workflow.js'
import type { IntensityMap, Intensity, Stage } from './types.js'
import type { RouterConfig, Scale } from './route.js'
import { intensityFloorFor, nextScale } from './route.js'

/**
 * Request routing graph (roadmap #31), Phase 4 — PT-079. Pure, synchronous
 * helpers per spec §5.4. No I/O, no model calls — `judgeEdge` (in
 * `src/decisions/workflow.ts`) does the Jev call; `runWorkflowPass` (in
 * `runner.ts`) executes the resulting side effects. Kept here, separate from
 * runner.ts, so the mapping table is independently unit-testable and the
 * runner.ts call site stays small.
 */

/** The regex-path verdict label used for shadow-mode agreement comparison and telemetry. */
export type RegexEdgeLabel = 'continue' | 'escalate' | `failback:${Stage}`

export function regexEdgeLabel(escalate: boolean, failedBackTo: Stage | null): RegexEdgeLabel {
  if (failedBackTo) return `failback:${failedBackTo}`
  return escalate ? 'escalate' : 'continue'
}

/** The Jev-path verdict label, in the same shape as `regexEdgeLabel`, for agreement comparison and telemetry. */
export function jevEdgeLabel(next: EdgeJudgment['next'], failedBack: Stage | undefined): string {
  if (failedBack) return `failback:${failedBack}`
  return next
}

/** The highest-probability drift candidate, or `{ p: 0 }` when `drift` is empty. */
export function maxDrift(drift: Record<string, number>): { name?: string; p: number } {
  let best: { name?: string; p: number } = { p: 0 }
  for (const [name, p] of Object.entries(drift)) {
    if (p > best.p) best = { name, p }
  }
  return best
}

export type EdgeAction =
  | { kind: 'continue' }
  | { kind: 'promote' }
  | { kind: 'reroute'; target: string }
  | { kind: 'stuck' }
  | { kind: 'done' }
  | { kind: 'failback'; stage: Stage }

/**
 * Maps a Jev edge judgment to the action `runWorkflowPass` should take, per
 * spec §5.4/§6 phase 4. `failed_back` is checked first regardless of `next`
 * (the spec's enforce-mode bullet list order). A `reroute` verdict that is
 * not currently allowed (router not configured, `request_routing` not
 * `enforce`, drift below threshold, or the reroute cap reached) degrades to
 * `continue`.
 */
export function resolveEdgeAction(judgment: EdgeJudgment, opts: { rerouteAllowed: boolean; rerouteTarget?: string }): EdgeAction {
  if (judgment.failed_back) return { kind: 'failback', stage: judgment.failed_back }
  if (judgment.next === 'reroute') {
    if (!opts.rerouteAllowed || !opts.rerouteTarget) return { kind: 'continue' }
    return { kind: 'reroute', target: opts.rerouteTarget }
  }
  if (judgment.next === 'continue') return { kind: 'continue' }
  if (judgment.next === 'promote') return { kind: 'promote' }
  if (judgment.next === 'stuck') return { kind: 'stuck' }
  return { kind: 'done' }
}

export function rerouteAllowed(opts: { routerConfigured: boolean; requestRoutingMode?: 'disabled' | 'shadow' | 'enforce'; target?: string; currentPlaybook?: string; catchAll?: string[]; maxDriftP: number; domainThreshold: number; reroutesUsed: number; maxReroutes: number }): boolean {
  const catchAllDrift = opts.target !== undefined && opts.catchAll?.includes(opts.target) && !opts.catchAll.includes(opts.currentPlaybook ?? '')
  return opts.routerConfigured && opts.requestRoutingMode === 'enforce' && !catchAllDrift && opts.maxDriftP > opts.domainThreshold && opts.reroutesUsed < opts.maxReroutes
}

/**
 * spec §6 phase 4 `promote`: when the pass has a routed scale and the router
 * configures `scale_presets`, use the next scale level's floor (recon still
 * clamped >= 1 by `intensityFloorFor`). Otherwise raise plan/design/verify/
 * review by one level each, capped at 3 — the caller still runs the result
 * through `clampIntensity` (via `applyIntensityFloor`) so profile
 * min/max_intensity keep winning.
 */
export function promoteFloor(current: IntensityMap, scale: Scale | undefined, router: RouterConfig | undefined): Partial<IntensityMap> {
  if (scale && router?.scale_presets) {
    return intensityFloorFor(router, nextScale(scale))
  }
  const stages: Stage[] = ['plan', 'design', 'verify', 'review']
  const floor: Partial<IntensityMap> = {}
  for (const stage of stages) floor[stage] = Math.min(3, current[stage] + 1) as Intensity
  return floor
}
