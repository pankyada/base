import { randomUUID } from 'node:crypto'
import type {
  WorkflowMapAdvice,
  WorkflowMapAttempt,
  WorkflowMapObservation,
  WorkflowMapObservationInput,
  WorkflowMapScope,
  WorkflowMapSnapshot,
  WorkflowMapTransition,
} from '../types.js'

const limits = { observations: 128, attempts: 48, transitions: 96, advice: 48, completedRuns: 32 }
type MapState = {
  scope: WorkflowMapScope
  revision: number
  observations: WorkflowMapObservation[]
  attempts: WorkflowMapAttempt[]
  transitions: WorkflowMapTransition[]
  advice: WorkflowMapAdvice[]
  seen: Set<string>
  terminal?: WorkflowMapObservation['terminal']
  empty: boolean
  overflow: boolean
  retainedFromRevision?: number
}
type MapOptions = Partial<typeof limits>

function key(scope: WorkflowMapScope): string { return JSON.stringify([scope.run_id, scope.session_id, scope.profile]) }
function sameScope(a: WorkflowMapScope, b: WorkflowMapScope): boolean { return a.run_id === b.run_id && a.session_id === b.session_id && a.profile === b.profile }
function onlyKeys(value: object, allowed: string[]): boolean { return Object.keys(value).every(name => allowed.includes(name)) }
function boundedString(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
}
function id(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value) }
function finite(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max }
function validScope(value: unknown): value is WorkflowMapScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const s = value as WorkflowMapScope
  return onlyKeys(s, ['run_id', 'session_id', 'profile']) && boundedString(s.run_id) && boundedString(s.session_id) && boundedString(s.profile)
}

const stages = new Set(['recon', 'plan', 'design', 'build', 'verify', 'review'])
const tiers = new Set(['cheap', 'balanced', 'frontier', 'critic'])
const terminalStates = new Set(['completed', 'failed', 'cancelled', 'budget_exceeded', 'interrupted'])
const attemptStates = new Set(['running', 'done', 'escalated', 'skipped', 'failed', 'cancelled', 'budget_exceeded'])
const transitionKinds = new Set(['start', 'continue', 'retry', 'promote', 'fail_back', 'reroute', 'skip', 'claim_reentry', 'terminal'])
const adviceKinds = new Set(['route', 'edge', 'claim_check'])
const safeSummaries = new Set(['provider_unavailable', 'invalid_judgment', 'no_claims', 'no_evidence', 'claim_check_failed', 'pass', 'retention_overflow', 'event_gap'])
const safeActions = new Set(['ask', 'run', 'continue', 'promote', 'failback', 'reroute', 'stuck', 'done', 'retry', 'abandon', 'skip', 'pass'])

function validAttempt(raw: unknown): raw is WorkflowMapAttempt {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const a = raw as WorkflowMapAttempt
  return onlyKeys(a, ['attempt_id', 'pass_id', 'parent_pass_id', 'playbook', 'stage', 'attempt', 'intensity', 'tier', 'model', 'state', 'cost_usd', 'duration_ms', 'contract_ok', 'explore']) &&
    id(a.attempt_id) && boundedString(a.pass_id) && (a.parent_pass_id === undefined || boundedString(a.parent_pass_id)) &&
    boundedString(a.playbook) && stages.has(a.stage) && finite(a.attempt, 0, 100_000) && Number.isInteger(a.attempt) &&
    finite(a.intensity, 0, 3) && Number.isInteger(a.intensity) && tiers.has(a.tier) && boundedString(a.model) &&
    attemptStates.has(a.state) && (a.cost_usd === undefined || finite(a.cost_usd, 0, 1_000_000)) &&
    (a.duration_ms === undefined || finite(a.duration_ms, 0, 86_400_000)) &&
    (a.contract_ok === undefined || typeof a.contract_ok === 'boolean') && (a.explore === undefined || typeof a.explore === 'boolean')
}
function validTransition(raw: unknown): raw is WorkflowMapTransition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const t = raw as WorkflowMapTransition
  return onlyKeys(t, ['transition_id', 'from_attempt_id', 'to_attempt_id', 'kind']) && id(t.transition_id) && transitionKinds.has(t.kind) &&
    (t.from_attempt_id === undefined || id(t.from_attempt_id)) && (t.to_attempt_id === undefined || id(t.to_attempt_id))
}
function validAdvice(raw: unknown): raw is WorkflowMapAdvice {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const a = raw as WorkflowMapAdvice
  return onlyKeys(a, ['advice_id', 'kind', 'mode', 'applied', 'action', 'summary']) && id(a.advice_id) && adviceKinds.has(a.kind) && (a.mode === 'shadow' || a.mode === 'enforce') && typeof a.applied === 'boolean' &&
    (a.action === undefined || (boundedString(a.action, 32) && safeActions.has(a.action))) &&
    (a.summary === undefined || (boundedString(a.summary, 48) && safeSummaries.has(a.summary)))
}
function validInput(input: unknown): input is WorkflowMapObservationInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const e = input as WorkflowMapObservationInput
  if (!onlyKeys(e, ['event_id', 'kind', 'scope', 'pass_id', 'attempt', 'transition', 'advice', 'terminal']) || !id(e.event_id) || !validScope(e.scope)) return false
  switch (e.kind) {
    case 'pass_started': return boundedString(e.pass_id) && e.attempt === undefined && e.transition === undefined && e.advice === undefined
    case 'attempt_started': case 'attempt_updated': return validAttempt(e.attempt) && e.attempt.pass_id === e.pass_id && e.transition === undefined && e.advice === undefined
    case 'transition': return validTransition(e.transition) && e.attempt === undefined && e.advice === undefined
    case 'advice': return validAdvice(e.advice) && e.attempt === undefined && e.transition === undefined
    case 'terminal': return e.terminal !== undefined && terminalStates.has(e.terminal) && e.attempt === undefined && e.transition === undefined && e.advice === undefined
    default: return false
  }
}

export type WorkflowMapRecovery =
  | { mode: 'events'; events: WorkflowMapObservation[] }
  | { mode: 'snapshot'; snapshot: WorkflowMapSnapshot }
  | { mode: 'rejected' }

/** Ephemeral, bounded, server-owned projection of runner observations. */
export class WorkflowMapProjection {
  private readonly maps = new Map<string, MapState>()
  private readonly completed: string[] = []
  private readonly listeners = new Set<(observation: WorkflowMapObservation) => void>()
  private readonly completionListeners = new Set<(scope: WorkflowMapScope) => void>()
  private readonly limits: typeof limits
  constructor(options: MapOptions = {}) { this.limits = { ...limits, ...options } }

  subscribe(listener: (observation: WorkflowMapObservation) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeCompletion(listener: (scope: WorkflowMapScope) => void): () => void {
    this.completionListeners.add(listener)
    return () => this.completionListeners.delete(listener)
  }

  begin(scope: WorkflowMapScope): void {
    if (!validScope(scope)) return
    const k = key(scope)
    if (this.maps.has(k)) return
    this.maps.set(k, { scope: { ...scope }, revision: 0, observations: [], attempts: [], transitions: [], advice: [], seen: new Set(), empty: false, overflow: false })
  }

  /** Appends only validated, exactly scoped observations and assigns revision. */
  accept(input: WorkflowMapObservationInput): WorkflowMapObservation | undefined {
    if (!validInput(input)) return undefined
    const state = this.maps.get(key(input.scope))
    if (!state || !sameScope(state.scope, input.scope) || state.terminal || state.seen.has(input.event_id)) return undefined
    const event: WorkflowMapObservation = {
      event_id: input.event_id,
      revision: ++state.revision,
      kind: input.kind,
      scope: { run_id: input.scope.run_id, session_id: input.scope.session_id, profile: input.scope.profile },
      ...(input.pass_id !== undefined ? { pass_id: input.pass_id } : {}),
      ...(input.attempt !== undefined ? { attempt: { ...input.attempt } } : {}),
      ...(input.transition !== undefined ? { transition: { ...input.transition } } : {}),
      ...(input.advice !== undefined ? { advice: { ...input.advice } } : {}),
      ...(input.terminal !== undefined ? { terminal: input.terminal } : {}),
    }
    state.empty = false
    state.seen.add(event.event_id)
    state.observations.push(event)
    if (event.attempt) {
      const at = state.attempts.findIndex(item => item.attempt_id === event.attempt!.attempt_id)
      if (at >= 0) state.attempts[at] = event.attempt
      else state.attempts.push(event.attempt)
    }
    if (event.transition && !state.transitions.some(item => item.transition_id === event.transition!.transition_id)) state.transitions.push(event.transition)
    if (event.advice && !state.advice.some(item => item.advice_id === event.advice!.advice_id)) state.advice.push(event.advice)
    if (event.kind === 'terminal') state.terminal = event.terminal
    this.trimState(state)
    if (state.terminal) this.completed.push(key(state.scope))
    this.evictCompleted()
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)) } catch { /* observers cannot affect workflow execution */ }
    }
    if (state.terminal) this.notifyCompletion(state.scope)
    return event
  }

  completeEmpty(scope: WorkflowMapScope): WorkflowMapSnapshot | undefined {
    if (!validScope(scope)) return undefined
    this.begin(scope)
    const state = this.maps.get(key(scope))!
    if (state.revision > 0 || state.terminal) return this.snapshot(scope)
    state.empty = true
    state.terminal = 'completed'
    this.completed.push(key(scope))
    this.evictCompleted()
    this.notifyCompletion(state.scope)
    return this.snapshot(scope)
  }

  snapshot(scope: WorkflowMapScope, missingReason: 'not_retained' | 'server_restarted' = 'not_retained'): WorkflowMapSnapshot | undefined {
    if (!validScope(scope)) return undefined
    const state = this.maps.get(key(scope))
    if (!state || !sameScope(state.scope, scope)) return { version: 1, scope: { ...scope }, revision: 0, availability: { state: 'unavailable', reason: missingReason }, attempts: [], transitions: [], advice: [] }
    return {
      version: 1,
      scope: { ...state.scope },
      revision: state.revision,
      availability: state.overflow ? { state: 'partial', reason: 'retention_overflow' } : state.empty ? { state: 'empty' } : { state: 'available' },
      ...(state.terminal ? { terminal: state.terminal } : {}),
      attempts: structuredClone(state.attempts), transitions: structuredClone(state.transitions), advice: structuredClone(state.advice),
      ...(state.retainedFromRevision !== undefined ? { retained_from_revision: state.retainedFromRevision } : {}),
    }
  }

  recover(scope: WorkflowMapScope, afterRevision?: number): WorkflowMapRecovery {
    const state = validScope(scope) ? this.maps.get(key(scope)) : undefined
    if (!validScope(scope) || (afterRevision !== undefined && (!Number.isSafeInteger(afterRevision) || afterRevision < 0))) return { mode: 'rejected' }
    if (!state || !sameScope(state.scope, scope)) return { mode: 'snapshot', snapshot: this.snapshot(scope)! }
    const oldest = state.observations[0]?.revision ?? state.revision + 1
    if (afterRevision !== undefined && afterRevision >= oldest - 1 && afterRevision <= state.revision) {
      return { mode: 'events', events: structuredClone(state.observations.filter(event => event.revision > afterRevision)) }
    }
    return { mode: 'snapshot', snapshot: this.snapshot(scope)! }
  }

  private trimCollection<T>(items: T[], max: number, state: MapState, revisionOf: (value: T) => number): void {
    if (items.length <= max) return
    const removed = items.splice(0, items.length - max)
    state.overflow = true
    const first = removed.length ? revisionOf(removed[removed.length - 1]) + 1 : state.revision
    state.retainedFromRevision = Math.max(state.retainedFromRevision ?? 0, first)
  }
  private trimState(state: MapState): void {
    this.trimCollection(state.observations, this.limits.observations, state, event => event.revision)
    this.trimCollection(state.attempts, this.limits.attempts, state, item => state.observations.find(event => event.attempt?.attempt_id === item.attempt_id)?.revision ?? state.revision)
    this.trimCollection(state.transitions, this.limits.transitions, state, item => state.observations.find(event => event.transition?.transition_id === item.transition_id)?.revision ?? state.revision)
    this.trimCollection(state.advice, this.limits.advice, state, item => state.observations.find(event => event.advice?.advice_id === item.advice_id)?.revision ?? state.revision)
    while (state.seen.size > this.limits.observations) state.seen.delete(state.seen.values().next().value!)
  }
  private evictCompleted(): void {
    while (this.completed.length > this.limits.completedRuns) {
      const oldest = this.completed.shift()!
      const state = this.maps.get(oldest)
      if (state?.terminal) this.maps.delete(oldest)
    }
  }
  private notifyCompletion(scope: WorkflowMapScope): void {
    for (const listener of this.completionListeners) {
      try { listener({ ...scope }) } catch { /* observers cannot affect workflow execution */ }
    }
  }
  static newId(): string { return randomUUID() }
}

/** One process-local projection shared by interactive, REST, and trigger runs. */
export const workflowMapProjection = new WorkflowMapProjection()
