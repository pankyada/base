import type { Intensity, IntensityMap } from './types.js'

/**
 * Request routing graph (roadmap #31), Phase 2 — PT-077. Pure, synchronous
 * policy code per spec §5.2. No I/O, no model calls: `chooseRoute` (in
 * `src/decisions/workflow.ts`) does the Jev fan-out and hands this function
 * plain signals.
 */
export type Scale = 'trivial' | 'small' | 'medium' | 'large'

export const SCALES: readonly Scale[] = ['trivial', 'small', 'medium', 'large']

export interface RouteSignals {
  /** Per-candidate-playbook domain applicability probability, keyed by playbook name. */
  domain: Record<string, number>
  /** Scale probability distribution across all four levels. */
  scale: Record<Scale, number>
  has_existing_work: number
  ambiguous: number
  /** Only meaningful (and only asked) when a session route is available. */
  continues_previous?: number
}

export interface RouterConfig {
  domain_threshold: number
  ask_threshold: number
  max_reroutes: number
  max_clarifications: number
  scale_presets?: Partial<Record<Scale, Partial<IntensityMap>>>
}

export interface SessionRoute {
  playbook: string
  scale: Scale
  task_id: string
  at: string
}

export type RouteDecision =
  | { kind: 'ask'; reason: 'ambiguous' }
  | { kind: 'run'; playbooks: string[]; primary: string; scale: Scale; intensityFloor: Partial<IntensityMap>; why: string }

/** Near-tie margin per spec §5.2 rule 5: within this, the *larger* scale wins. */
const TIE_MARGIN = 0.15

function argmaxScale(scale: Record<Scale, number>): Scale {
  const ordered = [...SCALES].sort((a, b) => (scale[b] ?? 0) - (scale[a] ?? 0))
  const top = ordered[0]
  const second = ordered[1]
  if (second === undefined) return top
  const topP = scale[top] ?? 0
  const secondP = scale[second] ?? 0
  if (topP - secondP > TIE_MARGIN) return top
  // Near-tie: choose the larger (later-indexed) of the two contenders.
  const topIdx = SCALES.indexOf(top)
  const secondIdx = SCALES.indexOf(second)
  return topIdx > secondIdx ? top : second
}

export function intensityFloorFor(config: RouterConfig, scale: Scale): Partial<IntensityMap> {
  const preset = config.scale_presets?.[scale] ?? {}
  const recon = Math.max(1, preset.recon ?? 0) as Intensity
  return { ...preset, recon }
}

/** Phase 4 (PT-079), spec §5.4 `promote`: the next-larger scale level, capped at 'large'. */
export function nextScale(scale: Scale): Scale {
  const idx = SCALES.indexOf(scale)
  return SCALES[Math.min(idx + 1, SCALES.length - 1)]
}

/**
 * Policy rules in order (spec §5.2):
 * 1. ambiguous > ask_threshold and clarifications remaining => ask.
 * 2. continues_previous > 0.5 and a session route exists => reuse its playbook.
 * 3. Domain filter: playbooks with domain > domain_threshold, sorted desc, capped at 2.
 *    None qualify => fall back to `[fallbackPlaybook]`.
 * 4. scale = argmax level (ties within TIE_MARGIN => larger level).
 * 5. intensityFloor = scale_presets[scale], recon forced >= 1.
 */
export function decideRoute(
  signals: RouteSignals,
  config: RouterConfig,
  fallbackPlaybook: string,
  clarificationsRemaining: number,
  sessionRoute?: SessionRoute,
): RouteDecision {
  if (signals.ambiguous > config.ask_threshold && clarificationsRemaining > 0) {
    return { kind: 'ask', reason: 'ambiguous' }
  }

  if (signals.continues_previous !== undefined && signals.continues_previous > 0.5 && sessionRoute) {
    const scale = argmaxScale(signals.scale)
    return {
      kind: 'run',
      playbooks: [sessionRoute.playbook],
      primary: sessionRoute.playbook,
      scale,
      intensityFloor: intensityFloorFor(config, scale),
      why: `continues previous session route (${sessionRoute.playbook})`,
    }
  }

  const inDomain = Object.entries(signals.domain)
    .filter(([, p]) => p > config.domain_threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 2)

  const playbooks = inDomain.length > 0 ? inDomain : [fallbackPlaybook]
  const scale = argmaxScale(signals.scale)
  const why = inDomain.length > 0
    ? `domain match: ${playbooks.join(', ')}`
    : `no candidate above domain_threshold (${config.domain_threshold}); fallback to ${fallbackPlaybook}`

  return {
    kind: 'run',
    playbooks,
    primary: playbooks[0],
    scale,
    intensityFloor: intensityFloorFor(config, scale),
    why,
  }
}
