export interface LiveApproval {
  id: string
  name: string
  resolve: (approved: boolean) => void
  cancel?: () => void
}

interface Entry extends LiveApproval { expiresAt: number }

/**
 * In-process approval callbacks survive a browser/TUI transport reconnect.
 * This intentionally has no persistence: process restart still fails closed.
 */
export class RecoverableApprovalRegistry {
  private readonly sessions = new Map<string, Map<string, Entry>>()

  constructor(private readonly ttlMs = 5 * 60_000, private readonly maxPerSession = 256) {}

  register(sessionId: string, user: string, approval: LiveApproval): void {
    const key = scopedKey(sessionId, user)
    const entries = this.sessions.get(key) ?? new Map<string, Entry>()
    if (!entries.has(approval.id) && entries.size >= this.maxPerSession) throw new Error('approval recovery capacity exhausted')
    entries.set(approval.id, { ...approval, expiresAt: Date.now() + this.ttlMs })
    this.sessions.set(key, entries)
  }

  get(sessionId: string, user: string, id: string): LiveApproval | undefined {
    const entries = this.sessions.get(scopedKey(sessionId, user))
    const entry = entries?.get(id)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      entries!.delete(id); entry.cancel?.(); entry.resolve(false); this.removeEmpty(sessionId, user, entries!)
      return undefined
    }
    return entry
  }

  has(sessionId: string, user: string): boolean {
    const entries = this.sessions.get(scopedKey(sessionId, user))
    if (!entries) return false
    this.cleanup()
    return (this.sessions.get(scopedKey(sessionId, user))?.size ?? 0) > 0
  }

  remove(sessionId: string, user: string, id: string): void {
    const entries = this.sessions.get(scopedKey(sessionId, user))
    if (!entries) return
    entries.delete(id)
    this.removeEmpty(sessionId, user, entries)
  }

  cancel(sessionId: string, user: string): void {
    const key = scopedKey(sessionId, user)
    const entries = this.sessions.get(key)
    if (!entries) return
    this.sessions.delete(key)
    for (const entry of entries.values()) { entry.cancel?.(); entry.resolve(false) }
  }

  cleanup(now = Date.now()): number {
    let expired = 0
    for (const [key, entries] of this.sessions) {
      for (const [id, entry] of entries) {
        if (entry.expiresAt > now) continue
        entries.delete(id); entry.cancel?.(); entry.resolve(false); expired++
      }
      if (entries.size === 0) this.sessions.delete(key)
    }
    return expired
  }

  private removeEmpty(sessionId: string, user: string, entries: Map<string, Entry>): void {
    if (entries.size === 0) this.sessions.delete(scopedKey(sessionId, user))
  }
}

function scopedKey(sessionId: string, user: string): string { return JSON.stringify([sessionId, user]) }
