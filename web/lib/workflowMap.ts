import type {
  WorkflowMapAttempt,
  WorkflowMapObservation,
  WorkflowMapScope,
  WorkflowMapSnapshot,
  ServerMessage,
} from './protocol'

export interface WorkflowMapClientState {
  snapshot: WorkflowMapSnapshot
  seenEventIds: string[]
  needsRecovery: boolean
}

export type WorkflowMapFrame = Extract<ServerMessage, { type: 'workflow_map' }>

const CLIENT_ATTEMPT_LIMIT = 48
const CLIENT_TRANSITION_LIMIT = 96
const CLIENT_ADVICE_LIMIT = 48
const CLIENT_EVENT_ID_LIMIT = 128

export function sameWorkflowMapScope(a: WorkflowMapScope, b: WorkflowMapScope): boolean {
  return a.run_id === b.run_id && a.session_id === b.session_id && a.profile === b.profile
}

function emptySnapshot(scope: WorkflowMapScope): WorkflowMapSnapshot {
  return { version: 1, scope, revision: 0, availability: { state: 'available' }, attempts: [], transitions: [], advice: [] }
}

function upsert<T>(items: T[], item: T, key: (value: T) => string): T[] {
  const id = key(item)
  const index = items.findIndex(value => key(value) === id)
  if (index < 0) return [...items, item]
  const next = [...items]
  next[index] = item
  return next
}

function applyObservation(snapshot: WorkflowMapSnapshot, observation: WorkflowMapObservation): WorkflowMapSnapshot {
  const availability = snapshot.availability.state === 'empty'
    ? { state: 'available' as const }
    : snapshot.availability
  const next: WorkflowMapSnapshot = { ...snapshot, revision: observation.revision, availability }
  let retentionOverflow = false
  const bounded = <T,>(items: T[], limit: number): T[] => {
    if (items.length <= limit) return items
    retentionOverflow = true
    return items.slice(-limit)
  }
  const finish = (snapshot: WorkflowMapSnapshot): WorkflowMapSnapshot => retentionOverflow
    ? { ...snapshot, availability: { state: 'partial', reason: 'retention_overflow' }, retained_from_revision: snapshot.retained_from_revision ?? observation.revision }
    : snapshot
  switch (observation.kind) {
    case 'attempt_started':
    case 'attempt_updated':
      return observation.attempt
        ? finish({ ...next, attempts: bounded(upsert(next.attempts, observation.attempt, item => item.attempt_id), CLIENT_ATTEMPT_LIMIT) })
        : next
    case 'transition':
      return observation.transition
        ? finish({ ...next, transitions: bounded(upsert(next.transitions, observation.transition, item => item.transition_id), CLIENT_TRANSITION_LIMIT) })
        : next
    case 'advice':
      return observation.advice
        ? finish({ ...next, advice: bounded(upsert(next.advice, observation.advice, item => item.advice_id), CLIENT_ADVICE_LIMIT) })
        : next
    case 'terminal': return { ...next, terminal: observation.terminal }
    case 'pass_started': return next
  }
}

/** Merge an exact-scope workflow map frame. A gap marks the view partial and waits for an authoritative snapshot. */
export function applyWorkflowMapFrame(
  current: WorkflowMapClientState | undefined,
  frame: WorkflowMapFrame,
  expectedScope: WorkflowMapScope,
): { state?: WorkflowMapClientState; accepted: boolean; needsRecovery: boolean } {
  if (frame.type !== 'workflow_map') return { state: current, accepted: false, needsRecovery: false }
  if (Boolean(frame.snapshot) === Boolean(frame.observation)) return { state: current, accepted: false, needsRecovery: false }
  const incomingScope = frame.snapshot?.scope ?? frame.observation?.scope
  if (!incomingScope || !sameWorkflowMapScope(incomingScope, expectedScope)) return { state: current, accepted: false, needsRecovery: false }

  if (frame.snapshot) {
    if (current && !sameWorkflowMapScope(frame.snapshot.scope, current.snapshot.scope)) return { state: current, accepted: false, needsRecovery: false }
    // An explicit unavailability snapshot is the new process's authoritative
    // answer after restart/eviction, even if its process-local revision resets.
    if (current && frame.snapshot.revision < current.snapshot.revision && frame.snapshot.availability.state !== 'unavailable') return { state: current, accepted: false, needsRecovery: false }
    return { state: { snapshot: frame.snapshot, seenEventIds: [], needsRecovery: false }, accepted: true, needsRecovery: false }
  }

  const observation = frame.observation
  if (!observation) return { state: current, accepted: false, needsRecovery: false }
  const prior = current ?? { snapshot: emptySnapshot(expectedScope), seenEventIds: [], needsRecovery: false }
  if (prior.seenEventIds.includes(observation.event_id) || observation.revision <= prior.snapshot.revision || prior.snapshot.terminal) {
    return { state: current, accepted: false, needsRecovery: current?.needsRecovery ?? false }
  }
  // Once a revision gap is observed, only a server snapshot can prove the
  // missing history has been repaired. Later contiguous events do not.
  if (prior.needsRecovery) return { state: current, accepted: false, needsRecovery: true }
  if (observation.revision !== prior.snapshot.revision + 1) {
    return {
      state: {
        ...prior,
        snapshot: { ...prior.snapshot, availability: { state: 'partial', reason: 'event_gap' } },
        needsRecovery: true,
      },
      accepted: false,
      needsRecovery: true,
    }
  }
  const snapshot = applyObservation(prior.snapshot, observation)
  const seenEventIds = [...prior.seenEventIds, observation.event_id].slice(-CLIENT_EVENT_ID_LIMIT)
  return { state: { snapshot, seenEventIds, needsRecovery: false }, accepted: true, needsRecovery: false }
}

export function workflowMapSummary(snapshot: WorkflowMapSnapshot): { actualAttempts: number; explorationAttempts: number; status: string; availability: string } {
  // `explore` is a tier selected for a real executeStage call. The renderer
  // keeps it on the observed path and labels the tier explicitly.
  const actualAttempts = snapshot.attempts.length
  const explorationAttempts = snapshot.attempts.filter(item => item.explore).length
  const availability = snapshot.availability.state === 'partial'
    ? `Partial history · ${snapshot.availability.reason.replaceAll('_', ' ')}`
    : snapshot.availability.state === 'unavailable'
      ? `Map unavailable · ${snapshot.availability.reason.replaceAll('_', ' ')}`
      : snapshot.availability.state === 'empty' ? 'No workflow observed' : 'Observed execution'
  const lastAttempt = snapshot.attempts.at(-1)
  const status = snapshot.terminal?.replaceAll('_', ' ') ?? lastAttempt?.state ?? (actualAttempts ? 'running' : snapshot.availability.state === 'empty' ? 'empty' : 'observed')
  return { actualAttempts, explorationAttempts, status, availability }
}

export function attemptLabel(attempt: WorkflowMapAttempt): string {
  return `${attempt.playbook} · ${attempt.stage} · attempt ${attempt.attempt}`
}
