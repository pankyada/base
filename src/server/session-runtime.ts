import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJson, readJson } from '../shared/atomic-json.js'
import { sanitizeUserId, userPaths } from '../session/user-paths.js'

export interface RuntimeEvent { seq: number; type: string; payload: unknown; at: string }
export interface RuntimeSnapshot {
  session_id: string; user: string; revision: number
  status: 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled'
  last_seq: number; controller?: { id: string; lease: string; expires_at: number }
  events: RuntimeEvent[]; run_id?: string; latest_usage?: unknown
  budget?: unknown; actionable_ids: string[]; recovery_incomplete?: boolean
}
export interface Subscription { mode: 'events' | 'snapshot'; events?: RuntimeEvent[]; snapshot: RuntimeSnapshot; gap: boolean }

/** Server-owned run/session state. Socket lifetime never owns this object. */
export class SessionRuntime {
  private readonly events: RuntimeEvent[] = []
  private seq = 0
  private revision = 0
  private status: RuntimeSnapshot['status'] = 'running'
  private controller?: { id: string; lease: string; expires_at: number }
  private runId?: string
  private latestUsage?: unknown
  private budget?: unknown
  private recoveryIncomplete = false
  private readonly actionable = new Set<string>()
  private readonly responses = new Map<string, { result?: unknown; error?: unknown; failed?: boolean; invoking?: boolean }>()
  constructor(readonly session_id: string, readonly user: string, private readonly maxEvents = 256, private readonly disconnectedTtlMs = 5 * 60_000, private readonly persist?: string, restored?: RuntimeSnapshot, private readonly maxResponses = 4096) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 4096 || !Number.isSafeInteger(maxResponses) || maxResponses < 1) throw new Error('invalid runtime retention limit')
    if (!restored) return
    if (restored.session_id !== session_id || restored.user !== user) throw new Error('persisted runtime identity mismatch')
    this.seq = restored.last_seq
    this.revision = restored.revision
    this.status = restored.status
    this.runId = restored.run_id
    this.latestUsage = structuredClone(restored.latest_usage)
    this.budget = structuredClone(restored.budget)
    this.recoveryIncomplete = restored.recovery_incomplete ?? false
    this.actionable.clear()
    for (const id of restored.actionable_ids ?? []) if (typeof id === 'string') this.actionable.add(id)
    this.events.push(...structuredClone(restored.events.filter(event => event.type !== 'runtime').slice(-this.maxEvents)))
    // All action callbacks are ephemeral, including malformed legacy terminal snapshots.
    this.actionable.clear()
    // A controller lease and in-memory response callback cannot survive a
    // process restart. Requiring a fresh claim prevents stale socket actors
    // from mutating a restored runtime.
    this.controller = undefined
    if (restored.status === 'running' || restored.status === 'waiting_input') {
      this.actionable.clear()
      this.status = 'failed'
      this.emit('runtime_restarted', { previous_status: restored.status, reason: 'in-memory execution cannot continue after restart' })
    }
  }
  private snapshot(): RuntimeSnapshot {
    // Wire snapshots are detached at every level. A client must not be able
    // to mutate event payloads, controller state, or recovery metadata.
    const clone = <T>(value: T): T => structuredClone(value)
    return {
      session_id: this.session_id, user: this.user, revision: this.revision,
      status: this.status, last_seq: this.seq,
      controller: this.controller ? clone(this.controller) : undefined,
      events: clone(this.events),
      ...(this.runId ? { run_id: this.runId } : {}),
      ...(this.latestUsage !== undefined ? { latest_usage: clone(this.latestUsage) } : {}),
      ...(this.budget !== undefined ? { budget: clone(this.budget) } : {}),
      ...(this.recoveryIncomplete ? { recovery_incomplete: true } : {}),
      actionable_ids: [...this.actionable],
    }
  }
  private persistState(): void { if (this.persist) atomicWriteJson(this.persist, this.snapshot()) }
  emit(type: string, payload: unknown): RuntimeEvent {
    // Recovery messages contain snapshots themselves; never recursively retain them.
    if (type === 'runtime') return { seq: this.seq, type, payload: undefined, at: new Date().toISOString() }
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined
    // Child telemetry belongs in the event feed, but cannot replace the
    // root run's recovery projection. Child callbacks carry agent_id.
    const rootEvent = typeof data?.agent_id !== 'string' || data.agent_id.length === 0
    if (rootEvent && type === 'turn_start') {
      this.status = 'running'; this.actionable.clear(); this.latestUsage = undefined
    }
    if (rootEvent && typeof data?.run_id === 'string' && data.run_id.length <= 256) this.runId = data.run_id
    if (rootEvent && type === 'stats' && data) this.latestUsage = this.bounded(data)
    if (type === 'session_ready' && data?.budget !== undefined) this.budget = this.bounded(data.budget)
    if (type === 'session_end') {
      const status = data?.status
      if (rootEvent) {
        this.status = status === 'cancelled' ? 'cancelled' : status === 'failed' || status === 'budget_exceeded' ? 'failed' : 'completed'
        this.actionable.clear()
      }
    }
    const id = typeof data?.id === 'string' ? data.id : typeof data?.response_id === 'string' ? data.response_id : undefined
    if (['tool_prompt', 'input_request', 'code_execute', 'ui_render'].includes(type) && id) {
      if (id.length <= 256 && this.actionable.size < 256) this.actionable.add(id)
      else this.recoveryIncomplete = true
    }
    if (['response', 'tool_end', 'input_response', 'code_result', 'ui_result', 'tool_approve', 'tool_deny'].includes(type) && id) this.actionable.delete(id)
    const event = { seq: ++this.seq, type, payload: this.bounded(payload), at: new Date().toISOString() }
    this.events.push(event)
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents)
    this.revision++; this.persistState()
    return structuredClone(event)
  }
  private bounded(value: unknown): unknown {
    const json = JSON.stringify(value)
    if (json === undefined) return undefined
    if (Buffer.byteLength(json) > 16 * 1024) {
      this.recoveryIncomplete = true
      return { truncated: true, reason: 'runtime preview exceeds retention limit' }
    }
    return JSON.parse(json)
  }
  setStatus(status: RuntimeSnapshot['status']): void {
    this.status = status
    if (status === 'completed' || status === 'failed' || status === 'cancelled') this.actionable.clear()
    this.emit('status', { status })
  }
  subscribe(afterSeq = 0): Subscription {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error('invalid runtime cursor')
    const oldest = this.events[0]?.seq ?? this.seq + 1
    const gap = afterSeq > this.seq || (afterSeq > 0 && afterSeq < oldest - 1)
    return gap ? { mode: 'snapshot', snapshot: this.snapshot(), gap: true } : { mode: 'events', events: structuredClone(this.events.filter(e => e.seq > afterSeq)), snapshot: this.snapshot(), gap: false }
  }
  claim(controllerId: string, expectedRevision?: number, ttlMs = this.disconnectedTtlMs): { lease: string; revision: number } {
    if (expectedRevision !== undefined && expectedRevision !== this.revision) throw new Error(`stale controller revision: expected ${expectedRevision}, actual ${this.revision}`)
    if (this.controller && this.controller.expires_at > Date.now() && this.controller.id !== controllerId) throw new Error('session already has an active controller')
    const lease = randomUUID()
    this.controller = { id: controllerId, lease, expires_at: Date.now() + Math.max(1, ttlMs) }
    this.revision++
    this.emit('controller_claimed', { controller_id: controllerId })
    return { lease, revision: this.revision }
  }
  transfer(fromId: string, lease: string, toId: string, ttlMs = this.disconnectedTtlMs): { lease: string; revision: number } { this.assertController(fromId, lease); this.controller = undefined; return this.claim(toId, undefined, ttlMs) }
  release(controllerId: string, lease: string): void { this.assertController(controllerId, lease); this.controller = undefined; this.revision++; this.emit('controller_released', { controller_id: controllerId }) }
  assertController(controllerId: string, lease: string): void { if (!this.controller || this.controller.id !== controllerId || this.controller.lease !== lease || this.controller.expires_at <= Date.now()) throw new Error('stale or invalid controller lease') }
  /** Duplicate response id returns original result and never invokes handler twice. */
  respond<T>(responseId: string, controllerId: string, lease: string, handler: () => T): T {
    this.assertController(controllerId, lease)
    if (!responseId || responseId.length > 256) throw new Error('invalid response id')
    const key = JSON.stringify([controllerId, responseId])
    const cached = this.responses.get(key)
    if (cached) {
      if (cached.invoking) throw new Error('response handler is already executing')
      if (cached.failed) throw cached.error
      return cached.result as T
    }
    // Do not evict old IDs and accidentally execute their side effects twice.
    if (this.responses.size >= this.maxResponses) throw new Error('response retention exhausted; start a fresh session')
    const entry: { result?: unknown; error?: unknown; failed?: boolean; invoking?: boolean } = { invoking: true }
    this.responses.set(key, entry)
    try {
      const result = handler()
      entry.invoking = false
      if (result && typeof (result as any).then === 'function') {
        entry.result = Promise.resolve(result).then(value => {
          this.emit('response', { response_id: responseId }); return value
        }, error => {
          // Keep the rejected promise: an ambiguous failure must not be retried implicitly.
          this.emit('response_failed', { response_id: responseId }); throw error
        })
        return entry.result as T
      }
      entry.result = result
      this.emit('response', { response_id: responseId })
      return result
    } catch (error) {
      entry.invoking = false; entry.failed = true; entry.error = error
      throw error
    }
  }
  cleanup(now = Date.now()): boolean { if (this.controller && this.controller.expires_at <= now) { this.controller = undefined; this.emit('controller_expired', {}); return true } return false }
  get state(): RuntimeSnapshot { return this.snapshot() }
}

export class SessionRuntimeRegistry {
  private readonly sessions = new Map<string, SessionRuntime>()
  constructor(private readonly maxEvents = 256, private readonly ttlMs = 5 * 60_000, private readonly persistRoot?: string) {}
  private runtimePath(sessionId: string, user: string): string {
    const root = this.persistRoot ?? join(userPaths(user, '').sessionsDir, 'runtime')
    const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(root, this.persistRoot ? sanitizeUserId(user) : '', `${safeSession}.json`)
  }
  getOrCreate(sessionId: string, user: string): SessionRuntime {
    const existing = this.sessions.get(sessionId)
    if (existing) { if (existing.user !== user) throw new Error('session belongs to another user'); return existing }
    const path = this.runtimePath(sessionId, user)
    const restored = existsSync(path) ? readJson<RuntimeSnapshot>(path) : undefined
    const runtime = new SessionRuntime(sessionId, user, this.maxEvents, this.ttlMs, path, restored)
    this.sessions.set(sessionId, runtime)
    return runtime
  }
  get(sessionId: string, user: string): SessionRuntime | undefined {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing.user === user ? existing : undefined
    const path = this.runtimePath(sessionId, user)
    if (!existsSync(path)) return undefined
    const runtime = new SessionRuntime(sessionId, user, this.maxEvents, this.ttlMs, path, readJson<RuntimeSnapshot>(path))
    this.sessions.set(sessionId, runtime)
    return runtime
  }
  cleanup(now = Date.now()): number { let count = 0; for (const runtime of this.sessions.values()) if (runtime.cleanup(now)) count++; return count }
}
