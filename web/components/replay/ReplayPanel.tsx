'use client'
import { useEffect, useState } from 'react'

interface ReplaySummary { id: string; mode: string; events: number; effects: number; unknown_effects: number; parent_run_id?: string }
export function ReplayPanel({ baseUrl }: { baseUrl: string }) {
  const [items, setItems] = useState<ReplaySummary[]>([]); const [error, setError] = useState('')
  useEffect(() => { void fetch(`${baseUrl}/replay`).then(response => response.ok ? response.json() : { journals: [] }).then(body => setItems(body.journals ?? [])).catch(() => setError('Replay index unavailable')) }, [baseUrl])
  return <section className="panel replay-panel"><div className="panel-heading"><div><span className="eyebrow">R5 / PLAYBACK</span><h2>Recorded runs</h2></div><span className="status-pill">{items.length} indexed</span></div>{error ? <p className="muted">{error}</p> : <div className="replay-list">{items.slice(0, 12).map(item => <article key={item.id} className="replay-row"><div><strong>{item.id}</strong><span className="muted">{item.mode}{item.parent_run_id ? ` · branch of ${item.parent_run_id}` : ''}</span></div><div className="replay-stats"><span>{item.events} events</span><span>{item.effects} effects</span><span>{item.unknown_effects ? `${item.unknown_effects} unknown` : 'effects reconciled'}</span></div><div className="replay-actions"><button type="button" onClick={() => { void fetch(`${baseUrl}/replay/${encodeURIComponent(item.id)}/playback`, { method: 'POST' }) }}>Playback</button><button type="button" onClick={() => { void fetch(`${baseUrl}/replay/${encodeURIComponent(item.id)}/branch?checkpoint=turn_start`, { method: 'POST' }).then(() => window.location.reload()) }}>Branch at turn start</button></div></article>)}</div>}</section>
}
