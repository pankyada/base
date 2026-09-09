'use client'
import { useEffect, useRef, useState } from 'react'
import { Brief } from '../../components/assistant/Brief'
import { Shell } from '../../components/chrome/Shell'
import { useSharedHarnessWS } from '../../components/chrome/SocketProvider'
import { MemoryTimeline, memoryEditPrompt } from '../../components/assistant/MemoryTimeline'
import { TriggerList } from '../../components/assistant/TriggerList'
import { buildScopedUrl, isStaleScope, type RequestScope } from '../../lib/scopedRequest'
import { fetchBatch, fetchRemote, remoteOr, batchFailureReasons, type RemoteData } from '../../lib/remoteData'
import { Unavailable } from '../../components/chrome/Unavailable'

type HomeBatch = { pending: unknown; runs: unknown; usage: unknown; triggers: unknown; memory: unknown; metrics: unknown; conflicts: unknown }

/** Active profile, read off the WS event stream (this page doesn't run the reducer HarnessApp uses). */
function activeProfile(events: { type: string }[]): string | undefined {
  const message = [...events].reverse().find(event => event.type === 'session_ready' || event.type === 'profiles')
  if (!message) return undefined
  return (message as { profile?: string; current?: string }).profile ?? (message as { current?: string }).current
}

export default function HomePage() {
  const [data, setData] = useState<Record<string, unknown>>({})
  const [batch, setBatch] = useState<{ [K in keyof HomeBatch]: RemoteData<HomeBatch[K]> } | undefined>(undefined)
  const [memoryAt, setMemoryAt] = useState<string>()
  const base = process.env.NEXT_PUBLIC_HARNESS_HTTP_URL || 'http://localhost:7337'
  const { events, userId } = useSharedHarnessWS()
  const profile = activeProfile(events)
  const scope: RequestScope = { userId, profile }
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const [retryToken, setRetryToken] = useState(0)
  useEffect(() => {
    const at = new URLSearchParams(window.location.search).get('at') ?? undefined
    setMemoryAt(at)
    const requestedScope = { userId: scopeRef.current.userId, profile: scopeRef.current.profile }
    setData({}) // drop the previous scope's brief before the new scoped reads land
    setBatch(undefined)
    // /pending, /runs, /usage, memory, and /memory/conflicts are user-scoped. /triggers and /metrics are aggregate reads (see src/server/read-api.ts — /triggers spans every profile with no user filter, /metrics accepts only a profile filter).
    // Each of the seven reads is fetched and reported independently (fetchBatch → Promise.allSettled) so one dead endpoint does not blank the rest of the brief.
    void fetchBatch<HomeBatch>({
      pending: () => fetchRemote(buildScopedUrl(base, '/pending', { userId: requestedScope.userId })),
      runs: () => fetchRemote(buildScopedUrl(base, '/runs', requestedScope)),
      usage: () => fetchRemote(buildScopedUrl(base, '/usage', { userId: requestedScope.userId })),
      triggers: () => fetchRemote(buildScopedUrl(base, '/triggers', {})),
      memory: () => fetchRemote(buildScopedUrl(base, '/memory', { userId: requestedScope.userId, profile: requestedScope.profile }, { at })),
      metrics: () => fetchRemote(buildScopedUrl(base, '/metrics', { profile: requestedScope.profile })),
      conflicts: () => fetchRemote(buildScopedUrl(base, '/memory/conflicts', { userId: requestedScope.userId })),
    }).then(result => {
      if (isStaleScope(requestedScope, scopeRef.current)) return
      setBatch(result)
      setData({
        pending: remoteOr(result.pending, {}),
        runs: remoteOr(result.runs, {}),
        usage: remoteOr(result.usage, {}),
        triggers: remoteOr(result.triggers, {}),
        memory: remoteOr(result.memory, {}),
        metrics: remoteOr(result.metrics, {}),
        conflicts: remoteOr(result.conflicts, {}),
      })
    })
  }, [base, scope.userId, scope.profile, retryToken])
  const memoryEntries = (data.memory as { entries?: { key?: string; content?: string; valid_from?: string; valid_to?: string; superseded?: boolean }[] } | undefined)?.entries ?? []
  const triggers = (data.triggers as { triggers?: { name: string; kind: string; fires: number; skips: number; skip_reasons?: Record<string, number>; last_fire?: string | null }[] } | undefined)?.triggers ?? []
  const conflicts = (data.conflicts as { conflicts?: { id: string; claim_key: string; state: string; claim_a: { key: string; value?: string; source?: string }; claim_b: { key: string; value?: string; source?: string }; revision: number }[] } | undefined)?.conflicts ?? []
  const failures = batch ? batchFailureReasons(batch) : []
  return <Shell><main className="route-page">
    {!batch ? <p role="status">Loading brief…</p> : null}
    {failures.length > 0 ? <Unavailable reason={failures.join(' · ')} onRetry={() => setRetryToken(t => t + 1)} /> : null}
    <Brief data={data} /><p className="muted" data-testid="home-scope-note">Triggers and metrics below are aggregate across all users; pending, runs, usage, and memory are scoped to your identity.</p><section className="memory-filter"><label>Memory instant <input type="datetime-local" value={memoryAt ? memoryAt.slice(0, 16) : ''} onChange={event => { const value = event.target.value ? new Date(event.target.value).toISOString() : ''; window.location.href = value ? `/home?at=${encodeURIComponent(value)}` : '/home' }} /></label></section><MemoryTimeline entries={memoryEntries} conflicts={conflicts} onResolveConflict={(id, revision, chosenKey) => { void fetch(buildScopedUrl(base, `/memory/conflicts/${id}/resolve`, { userId }), { method: 'POST', body: JSON.stringify({ revision, chosen_key: chosenKey }) }).then(() => window.location.reload()) }} onEdit={entry => { window.localStorage.setItem('harness-composer-draft', memoryEditPrompt(entry)); window.location.href = '/' }} /><TriggerList triggers={triggers} /></main></Shell>
}
