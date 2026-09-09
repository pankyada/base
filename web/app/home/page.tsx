'use client'
import { useEffect, useRef, useState } from 'react'
import { Brief } from '../../components/assistant/Brief'
import { Shell } from '../../components/chrome/Shell'
import { useSharedHarnessWS } from '../../components/chrome/SocketProvider'
import { MemoryTimeline, memoryEditPrompt } from '../../components/assistant/MemoryTimeline'
import { TriggerList } from '../../components/assistant/TriggerList'
import { buildScopedUrl, isStaleScope, type RequestScope } from '../../lib/scopedRequest'

/** Active profile, read off the WS event stream (this page doesn't run the reducer HarnessApp uses). */
function activeProfile(events: { type: string }[]): string | undefined {
  const message = [...events].reverse().find(event => event.type === 'session_ready' || event.type === 'profiles')
  if (!message) return undefined
  return (message as { profile?: string; current?: string }).profile ?? (message as { current?: string }).current
}

export default function HomePage() {
  const [data, setData] = useState<Record<string, unknown>>({})
  const [memoryAt, setMemoryAt] = useState<string>()
  const base = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'
  const { events, userId } = useSharedHarnessWS()
  const profile = activeProfile(events)
  const scope: RequestScope = { userId, profile }
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  useEffect(() => {
    const at = new URLSearchParams(window.location.search).get('at') ?? undefined
    setMemoryAt(at)
    const requestedScope = { userId: scopeRef.current.userId, profile: scopeRef.current.profile }
    setData({}) // drop the previous scope's brief before the new scoped reads land
    // /pending, /runs, /usage, memory, and /memory/conflicts are user-scoped. /triggers and /metrics are aggregate reads (see src/server/read-api.ts — /triggers spans every profile with no user filter, /metrics accepts only a profile filter).
    const scopedPaths: [string, RequestScope, Record<string, string | undefined>?][] = [
      ['/pending', { userId: requestedScope.userId }],
      ['/runs', requestedScope],
      ['/usage', { userId: requestedScope.userId }],
      ['/triggers', {}],
      ['/memory', { userId: requestedScope.userId, profile: requestedScope.profile }, { at }],
      ['/metrics', { profile: requestedScope.profile }],
      ['/memory/conflicts', { userId: requestedScope.userId }],
    ]
    void Promise.all(scopedPaths.map(([path, pathScope, extra]) => fetch(buildScopedUrl(base, path, pathScope, extra)).then(response => response.ok ? response.json() : {})))
      .then(([pending, runs, usage, triggers, memory, metrics, conflicts]) => { if (!isStaleScope(requestedScope, scopeRef.current)) setData({ pending, runs, usage, triggers, memory, metrics, conflicts }) })
      .catch(() => { if (!isStaleScope(requestedScope, scopeRef.current)) setData({}) })
  }, [base, scope.userId, scope.profile])
  const memoryEntries = (data.memory as { entries?: { key?: string; content?: string; valid_from?: string; valid_to?: string; superseded?: boolean }[] } | undefined)?.entries ?? []
  const triggers = (data.triggers as { triggers?: { name: string; kind: string; fires: number; skips: number; skip_reasons?: Record<string, number>; last_fire?: string | null }[] } | undefined)?.triggers ?? []
  const conflicts = (data.conflicts as { conflicts?: { id: string; claim_key: string; state: string; claim_a: { key: string; value?: string; source?: string }; claim_b: { key: string; value?: string; source?: string }; revision: number }[] } | undefined)?.conflicts ?? []
  return <Shell><main className="route-page"><Brief data={data} /><p className="muted" data-testid="home-scope-note">Triggers and metrics below are aggregate across all users; pending, runs, usage, and memory are scoped to your identity.</p><section className="memory-filter"><label>Memory instant <input type="datetime-local" value={memoryAt ? memoryAt.slice(0, 16) : ''} onChange={event => { const value = event.target.value ? new Date(event.target.value).toISOString() : ''; window.location.href = value ? `/home?at=${encodeURIComponent(value)}` : '/home' }} /></label></section><MemoryTimeline entries={memoryEntries} conflicts={conflicts} onResolveConflict={(id, revision, chosenKey) => { void fetch(buildScopedUrl(base, `/memory/conflicts/${id}/resolve`, { userId }), { method: 'POST', body: JSON.stringify({ revision, chosen_key: chosenKey }) }).then(() => window.location.reload()) }} onEdit={entry => { window.localStorage.setItem('harness-composer-draft', memoryEditPrompt(entry)); window.location.href = '/' }} /><TriggerList triggers={triggers} /></main></Shell>
}
