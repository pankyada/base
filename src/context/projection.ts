import type OpenAI from 'openai'
import type { ProviderClient } from '../provider/types.js'
import type { Profile } from '../profiles/schema.js'
import { ensureContextState, type Session } from '../session/types.js'
import type { MemoryProvider } from '../memory/interface.js'
import { buildDigest } from './digest.js'
import { contextWindowFor, estimateTokens } from './estimator.js'
import { applyCacheBreakpoints } from './cache.js'
import type { MemoryCaptureService } from '../decisions/memory.js'
import { CompactionDecisionControlError, type CompactionDecisionAdvisor, type CompactionSourceGroup } from '../decisions/compaction.js'
import { addSupplementalPin, clearSupplementalPins, renderPins } from './pins.js'
import { createHash } from 'node:crypto'

const DEFAULTS = {
  high_water: 0.80,
  low_water: 0.45,
  tail_turns: 3,
}

interface Turn {
  start: number
  end: number
}

export interface ProjectionTelemetry {
  elided_count: number
  elided_bytes: number
  digest_calls: number
}

const projectionTelemetryByResult = new WeakMap<object, ProjectionTelemetry>()

export function projectionTelemetry(messages: unknown[]): ProjectionTelemetry {
  return projectionTelemetryByResult.get(messages as object) ?? { elided_count: 0, elided_bytes: 0, digest_calls: 0 }
}

function messageRole(message: unknown): string | undefined {
  return (message as any)?.role
}

function completeTurns(messages: unknown[]): { turns: Turn[]; partialStart?: number } {
  const turns: Turn[] = []
  let start: number | undefined
  let pendingToolCalls = new Set<string>()

  for (let index = 1; index < messages.length; index++) {
    const message = messages[index] as any
    if (message.role === 'user' && start !== undefined && pendingToolCalls.size === 0) {
      turns.push({ start, end: index })
      start = index
      pendingToolCalls = new Set()
    }
    if (message.role === 'user' && start === undefined) {
      start = index
      pendingToolCalls = new Set()
    }
    if (start === undefined) continue

    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      for (const call of message.tool_calls) if (call?.id) pendingToolCalls.add(call.id)
    }
    if (message.role === 'tool' && message.tool_call_id) pendingToolCalls.delete(message.tool_call_id)
    if (message.role === 'assistant' && (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0)) {
      turns.push({ start, end: index + 1 })
      start = undefined
      pendingToolCalls = new Set()
    }
  }
  return start === undefined ? { turns } : { turns, partialStart: start }
}

function protectedStart(messages: unknown[], tailTurns: number): number {
  const { turns, partialStart } = completeTurns(messages)
  if (partialStart !== undefined) return partialStart
  return turns[Math.max(0, turns.length - tailTurns)]?.start ?? messages.length
}

function systemProjection(session: Session): any {
  const system = (session.messages[0] as any) ?? { role: 'system', content: '' }
  const pins = renderPins(session)
  const content = typeof system.content === 'string' && pins
    ? `${system.content}\n\n${pins}`
    : system.content ?? pins
  return { ...system, content }
}

function cloneMessage(message: unknown, contentOverride?: string): any {
  const cloned = { ...(message as any) }
  if (contentOverride !== undefined) cloned.content = contentOverride
  if (Array.isArray((message as any)?.tool_calls)) cloned.tool_calls = (message as any).tool_calls.map((call: any) => ({ ...call, function: call.function ? { ...call.function } : call.function }))
  return cloned
}

function publicSourceMessage(message: any): Record<string, unknown> {
  const result: Record<string, unknown> = { role: message?.role }
  if (message?.content !== undefined) result.content = message.content
  if (Array.isArray(message?.tool_calls)) result.tool_calls = message.tool_calls.map((call: any) => ({ id: call?.id, type: call?.type, function: call?.function ? { name: call.function.name, arguments: call.function.arguments } : undefined }))
  if (message?.tool_call_id !== undefined) result.tool_call_id = message.tool_call_id
  if (message?.name !== undefined) result.name = message.name
  return result
}

function digestMessage(text: string): any {
  return { role: 'user', content: `[Earlier session digest: ${text}]` }
}

function elisionText(message: any): string {
  const id = message.tool_call_id ?? 'unknown'
  const length = typeof message.content === 'string' ? message.content.length : 0
  return `[Tool result → ${length} chars elided · ContextRestore("${id}")]`
}

function makeProjection(session: Session, liveStart: number, digestText: string | undefined, elided: Set<number>): any[] {
  const messages = session.messages as any[]
  const live = messages.slice(liveStart).map((message, offset) => {
    const index = liveStart + offset
    return cloneMessage(message, elided.has(index) ? elisionText(message) : undefined)
  })
  return [systemProjection(session), ...(digestText ? [digestMessage(digestText)] : []), ...live]
}

function sourceGroups(messages: any[], turns: Turn[], liveStart: number, protectedFrom: number): CompactionSourceGroup[] {
  return turns
    .filter(turn => turn.start >= liveStart && turn.end <= protectedFrom)
    .map(turn => {
      const group = messages.slice(turn.start, turn.end)
      const calls = group.flatMap(message => message.role === 'assistant' && Array.isArray(message.tool_calls) ? message.tool_calls.map((call: any) => call?.id).filter(Boolean) : [])
      const results = new Set(group.filter(message => message.role === 'tool' && message.tool_call_id).map(message => message.tool_call_id))
      const publicMessages = group.map(publicSourceMessage)
      const sourceRevision = createHash('sha256').update(JSON.stringify(publicMessages)).digest('hex').slice(0, 16)
      return { id: `turn:${turn.start}:${turn.end}:${sourceRevision}`, start: turn.start, end: turn.end, messages: publicMessages, containsToolPair: calls.every((id: string) => results.has(id)), sourceRevision }
    })
}

function sourceGroupText(group: CompactionSourceGroup): string {
  return `[source-group ${group.id}]\n${group.messages.map(message => JSON.stringify(publicSourceMessage(message))).join('\n')}`
}

async function nominateSupplementalPins(session: Session, profile: Profile, groups: CompactionSourceGroup[], advisor: CompactionDecisionAdvisor, onNotice?: (message: string, detail?: string) => void, sourceStillCurrent?: () => boolean): Promise<void> {
  if (groups.length === 0) return
  const maxGroups = Math.max(1, Math.min(groups.length, 16))
  const maxBytes = Math.max(1, Math.floor(contextWindowFor(profile) * (profile.context?.pin_budget ?? 0.25) * 4))
  let selected: string[] | undefined
  try {
    selected = await advisor.select(groups, { maxGroups, maxBytes })
  } catch (error) {
    if (error instanceof CompactionDecisionControlError) throw error
    onNotice?.('semantic compaction selection unavailable', 'existing projection backstops were preserved')
    return
  }
  if (sourceStillCurrent && !sourceStillCurrent()) return
  if (advisor.mode === 'shadow' || !selected?.length) return
  const byId = new Map(groups.map(group => [group.id, group]))
  for (const id of [...new Set(selected)]) {
    const group = byId.get(id)
    if (!group || !group.containsToolPair) continue
    addSupplementalPin(session, profile, { key: `compaction:${id}`, text: sourceGroupText(group), source_revision: group.sourceRevision })
  }
}

function dropOldestTurn(indices: Set<number>, turns: Turn[]): boolean {
  const turn = turns.find(candidate => [...Array(candidate.end - candidate.start).keys()].some(offset => indices.has(candidate.start + offset)))
  if (!turn) return false
  for (let index = turn.start; index < turn.end; index++) indices.delete(index)
  return true
}

function fitPrefix(session: Session, projection: any[], maxTokens: number): any[] {
  if (!Number.isFinite(maxTokens) || estimateTokens(projection, session) <= maxTokens) return projection
  const prefix = projection[0]
  if (typeof prefix?.content !== 'string') return projection
  let low = 0
  let high = prefix.content.length
  let best = ''
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = [{ ...prefix, content: prefix.content.slice(0, middle) }, ...projection.slice(1)]
    if (estimateTokens(candidate, session) <= maxTokens) {
      best = prefix.content.slice(0, middle)
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return [{ ...prefix, content: best }, ...projection.slice(1)]
}

export async function project(
  session: Session,
  profile: Profile,
  openai?: OpenAI,
  memory?: MemoryProvider,
  onNotice?: (message: string, detail?: string) => void,
  provider?: ProviderClient,
  capture?: MemoryCaptureService,
  compaction?: CompactionDecisionAdvisor,
): Promise<unknown[]> {
  const state = ensureContextState(session)
  // Supplemental semantic pins are request-scoped and must not survive a
  // disabled/shadow decision mode or a fresh re-evaluation.
  clearSupplementalPins(session)
  const metrics: ProjectionTelemetry = { elided_count: 0, elided_bytes: 0, digest_calls: 0 }
  const finalize = (messages: unknown[]): unknown[] => {
    const result = applyCacheBreakpoints(messages, profile.context?.cache === true)
    projectionTelemetryByResult.set(result as object, { ...metrics })
    return result
  }
  const config = {
    high_water: profile.context?.high_water ?? DEFAULTS.high_water,
    low_water: profile.context?.low_water ?? DEFAULTS.low_water,
    tail_turns: profile.context?.tail_turns ?? DEFAULTS.tail_turns,
  }
  const maxTokens = contextWindowFor(profile)
  const highTarget = maxTokens * config.high_water
  const lowTarget = maxTokens * config.low_water
  const messages = session.messages as any[]
  let liveStart = Math.max(1, Math.min(messages.length, state.digest?.upto ?? 1))
  let digestText = state.digest?.text
  let protectedFrom = protectedStart(messages, config.tail_turns)
  let elided = new Set<number>()
  let projection = makeProjection(session, liveStart, digestText, elided)

  if (estimateTokens(projection, session) <= highTarget) return finalize(projection)

  const initialTurns = completeTurns(messages).turns
  if (compaction) {
    const groups = sourceGroups(messages, initialTurns, liveStart, protectedFrom)
    const sourceRevision = createHash('sha256').update(JSON.stringify(groups.map(group => ({ id: group.id, sourceRevision: group.sourceRevision })))).digest('hex')
    await nominateSupplementalPins(session, profile, groups, compaction, onNotice, () => {
      const current = sourceGroups(messages, completeTurns(messages).turns, liveStart, protectedFrom)
      return JSON.stringify(current.map(group => ({ id: group.id, sourceRevision: group.sourceRevision }))) === JSON.stringify(groups.map(group => ({ id: group.id, sourceRevision: group.sourceRevision })))
    })
    const currentGroups = sourceGroups(messages, completeTurns(messages).turns, liveStart, protectedFrom)
    const currentRevision = createHash('sha256').update(JSON.stringify(currentGroups.map(group => ({ id: group.id, sourceRevision: group.sourceRevision })))).digest('hex')
    if (sourceRevision !== currentRevision) clearSupplementalPins(session)
    projection = makeProjection(session, liveStart, digestText, elided)
  }

  const candidates = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message, index }) => index >= liveStart && index < protectedFrom && messageRole(message) === 'tool' && typeof message.content === 'string' && message.content.length > 0)
    .sort((a, b) => b.message.content.length - a.message.content.length)
  for (const candidate of candidates) {
    if (estimateTokens(projection, session) <= lowTarget) break
    elided.add(candidate.index)
    metrics.elided_count += 1
    metrics.elided_bytes += candidate.message.content.length
    projection = makeProjection(session, liveStart, digestText, elided)
  }
  if (estimateTokens(projection, session) <= lowTarget) return finalize(projection)

  const { turns, partialStart } = completeTurns(messages)
  const foldable = turns.filter(turn => turn.start >= liveStart && turn.end <= protectedFrom)
  if (foldable.length > 0) {
    const upto = foldable[foldable.length - 1].end
    metrics.digest_calls += 1
    const digest = await buildDigest(session, profile, openai, upto, memory, provider, capture)
    if (digest) {
      state.digest = { upto, text: digest.text }
      liveStart = upto
      digestText = digest.text
      protectedFrom = protectedStart(messages, config.tail_turns)
      elided = new Set<number>()
      projection = makeProjection(session, liveStart, digestText, elided)
      if (estimateTokens(projection, session) <= lowTarget) return finalize(projection)
    } else {
      onNotice?.('context digest failed; dropping oldest turns', 'projection continued with the tier-3 backstop')
    }
  }

  const remaining = new Set<number>()
  for (let index = liveStart; index < messages.length; index++) remaining.add(index)
  const dropTurns = turns.filter(turn => turn.start >= liveStart && turn.end <= protectedFrom)
  for (const turn of dropTurns) {
    if (estimateTokens(projection, session) <= maxTokens) break
    for (let index = turn.start; index < turn.end; index++) remaining.delete(index)
    projection = [systemProjection(session), ...(digestText ? [digestMessage(digestText)] : []), ...messages.filter((_, index) => remaining.has(index)).map(message => cloneMessage(message))]
  }

  if (estimateTokens(projection, session) > maxTokens) {
    const allTurns = turns.filter(turn => turn.start >= liveStart && turn.end <= messages.length)
    for (const turn of allTurns) {
      if (estimateTokens(projection, session) <= maxTokens) break
      for (let index = turn.start; index < turn.end; index++) remaining.delete(index)
      projection = [systemProjection(session), ...(digestText ? [digestMessage(digestText)] : []), ...messages.filter((_, index) => remaining.has(index)).map(message => cloneMessage(message))]
    }
  }

  if (partialStart !== undefined && estimateTokens(projection, session) > maxTokens) {
    for (let index = partialStart; index < messages.length; index++) remaining.delete(index)
    projection = [systemProjection(session), ...(digestText ? [digestMessage(digestText)] : []), ...messages.filter((_, index) => remaining.has(index)).map(message => cloneMessage(message))]
  }

  if (estimateTokens(projection, session) > maxTokens) {
    onNotice?.('context projection reached hard backstop', 'prefix content trimmed to stay under the configured window')
    projection = [projection[0]]
    projection = fitPrefix(session, projection, maxTokens)
  } else if (dropTurns.length > 0) {
    onNotice?.('context projected with dropped turns', 'oldest complete turns were omitted from this request')
  }
  return finalize(projection)
}
