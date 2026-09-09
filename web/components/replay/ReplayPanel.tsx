'use client'
import { useEffect, useRef, useState } from 'react'
import { buildScopedUrl, isStaleScope, type RequestScope } from '../../lib/scopedRequest'

interface ReplaySummary { id: string; mode: string; events: number; effects: number; unknown_effects: number; parent_run_id?: string }
// /replay is scoped by `user` only — src/replay/router.ts builds ReplayStore(options.user) from the REST `scopedUser`, no `profile` param.
export function ReplayPanel({ baseUrl, scope = {} }: { baseUrl: string; scope?: RequestScope }) {
  const [items, setItems] = useState<ReplaySummary[]>([]); const [error, setError] = useState('')
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  useEffect(() => {
    // `requestedScope` is the full ambient scope (userId + profile) — staleness must be judged against it in full, even
    // though the URL below (urlScope) deliberately carries `userId` only, since /replay ignores `profile`.
    const requestedScope = scope
    const urlScope = { userId: scope.userId }
    setItems([]); setError('') // drop the previous scope's journal list before the new scoped read lands
    void fetch(buildScopedUrl(baseUrl, '/replay', urlScope)).then(response => response.ok ? response.json() : { journals: [] }).then(body => { if (!isStaleScope(requestedScope, scopeRef.current)) setItems(body.journals ?? []) }).catch(() => { if (!isStaleScope(requestedScope, scopeRef.current)) setError('Replay index unavailable') })
  }, [baseUrl, scope.userId])
  return <section className="panel replay-panel"><div className="panel-heading"><div><span className="eyebrow">R5 / PLAYBACK</span><h2>Recorded runs</h2></div><span className="status-pill">{items.length} indexed</span></div>{error ? <p className="muted">{error}</p> : <div className="replay-list">{items.slice(0, 12).map(item => <article key={item.id} className="replay-row"><div><strong>{item.id}</strong><span className="muted">{item.mode}{item.parent_run_id ? ` · branch of ${item.parent_run_id}` : ''}</span></div><div className="replay-stats"><span>{item.events} events</span><span>{item.effects} effects</span><span>{item.unknown_effects ? `${item.unknown_effects} unknown` : 'effects reconciled'}</span></div><div className="replay-actions"><button type="button" onClick={() => { void fetch(buildScopedUrl(baseUrl, `/replay/${encodeURIComponent(item.id)}/playback`, { userId: scope.userId }), { method: 'POST' }) }}>Playback</button><button type="button" onClick={() => { void fetch(buildScopedUrl(baseUrl, `/replay/${encodeURIComponent(item.id)}/branch`, { userId: scope.userId }, { checkpoint: 'turn_start' }), { method: 'POST' }).then(() => window.location.reload()) }}>Branch at turn start</button></div></article>)}</div>}</section>
}
