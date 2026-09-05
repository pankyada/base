import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJson, readJson } from '../shared/atomic-json.js'
import { sanitizeUserId, userPaths } from '../session/user-paths.js'

export interface RuntimeEvent { seq: number; type: string; payload: unknown; at: string }
export interface RuntimeSnapshot { session_id: string; user: string; revision: number; status: 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled'; last_seq: number; controller?: { id: string; lease: string; expires_at: number }; events: RuntimeEvent[] }
export interface Subscription { mode: 'events' | 'snapshot'; events?: RuntimeEvent[]; snapshot: RuntimeSnapshot; gap: boolean }

/** Server-owned run/session state. Socket lifetime never owns this object. */
export class SessionRuntime {
  private readonly events: RuntimeEvent[] = []
  private seq = 0
  private revision = 0
  private status: RuntimeSnapshot['status'] = 'running'
  private controller?: { id: string; lease: string; expires_at: number }
  private readonly responses = new Map<string, unknown>()
  constructor(readonly session_id: string, readonly user: string, private readonly maxEvents = 256, private readonly disconnectedTtlMs = 5 * 60_000, private readonly persist?: string, restored?: RuntimeSnapshot) {
    if (!restored) return
    if (restored.session_id !== session_id || restored.user !== user) throw new Error('persisted runtime identity mismatch')
    this.seq = restored.last_seq
    this.revision = restored.revision
    this.status = restored.status
    this.events.push(...restored.events.slice(-this.maxEvents))
    // A controller lease and in-memory response callback cannot survive a
    // process restart. Requiring a fresh claim prevents stale socket actors
    // from mutating a restored runtime.
    this.controller = undefined
    if (restored.status === 'running' || restored.status === 'waiting_input') {
      this.status = 'failed'
      this.emit('runtime_restarted', { previous_status: restored.status, reason: 'in-memory execution cannot continue after restart' })
    }
  }
  private snapshot(): RuntimeSnapshot { return { session_id: this.session_id, user: this.user, revision: this.revision, status: this.status, last_seq: this.seq, controller: this.controller, events: [...this.events] } }
  private persistState(): void { if (this.persist) atomicWriteJson(this.persist, this.snapshot()) }
  emit(type: string, payload: unknown): RuntimeEvent { const event = { seq: ++this.seq, type, payload, at: new Date().toISOString() }; this.events.push(event); if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents); this.revision++; this.persistState(); return event }
  setStatus(status: RuntimeSnapshot['status']): void { this.status = status; this.emit('status', { status }) }
  subscribe(afterSeq = 0): Subscription {
    const oldest = this.events[0]?.seq ?? this.seq + 1
    const gap = afterSeq > 0 && afterSeq < oldest - 1
    return gap ? { mode: 'snapshot', snapshot: this.snapshot(), gap: true } : { mode: 'events', events: this.events.filter(e => e.seq > afterSeq), snapshot: this.snapshot(), gap: false }
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
  respond<T>(responseId: string, controllerId: string, lease: string, handler: () => T): T { this.assertController(controllerId, lease); if (this.responses.has(responseId)) return this.responses.get(responseId) as T; const result = handler(); this.responses.set(responseId, result); this.emit('response', { response_id: responseId }); return result }
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
