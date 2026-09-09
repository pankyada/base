'use client'
import { useEffect, useRef, useState } from 'react'
import { buildScopedUrl, type RequestScope } from '../../lib/scopedRequest'
import { fetchScopedRemote, type RemoteData } from '../../lib/remoteData'
import { Unavailable } from '../chrome/Unavailable'

export interface RunRow { id: string; status: string; tokens?: number; costUsd?: number; model?: string }
export function cancelRunUrl(baseUrl: string, id: string): string { return `${baseUrl.replace(/\/$/, '')}/runs/${encodeURIComponent(id)}` }
export function runsUrl(baseUrl: string, scope: RequestScope = {}): string { return buildScopedUrl(baseUrl, '/runs', scope) }
export function runStatusLabel(status: string): string { return status === 'waiting_input' ? 'waiting for input' : status.replace('_', ' ') }
export function runBoardEmptyLabel(rows: RunRow[]): string { return rows.length ? '' : 'No active runs' }
export function mergeRunEvent(rows: RunRow[], event: { type: string; run_id?: string; tokens_in?: number; tokens_out?: number; cost_usd?: number; status?: string; reason?: string }): RunRow[] {
  if (!event.run_id) return rows
  const index = rows.findIndex(row => row.id === event.run_id)
  const current = index >= 0 ? rows[index] : { id: event.run_id, status: 'running' }
  const endStatus = event.status === 'budget_exceeded' || event.status === 'cancelled' || event.status === 'failed' ? event.status : 'done'
  const next = { ...current, ...(event.type === 'turn_start' ? { status: 'running' } : {}), ...(event.type === 'session_end' ? { status: endStatus } : {}), ...(event.type === 'stats' ? { tokens: (event.tokens_in ?? 0) + (event.tokens_out ?? 0), costUsd: event.cost_usd } : {}) }
  return index >= 0 ? rows.map((row, rowIndex) => rowIndex === index ? next : row) : [...rows, next]
}

interface RunsBody { runs?: RunRow[] }

export function RunBoard({ baseUrl, scope = {}, onCancel, liveEvents = [] }: { baseUrl: string; scope?: RequestScope; onCancel?: (id: string) => void; liveEvents?: { type: string; run_id?: string; tokens_in?: number; tokens_out?: number; cost_usd?: number; status?: string; reason?: string }[] }) {
  const [remote, setRemote] = useState<RemoteData<RunsBody>>({ status: 'loading' })
  const [rows, setRows] = useState<RunRow[]>([])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const requestedScope = scopeRef.current
    setRemote({ status: 'loading' })
    setRows([]) // drop the previous scope's runs before the new scoped read lands
    void fetchScopedRemote<RunsBody>(baseUrl, '/runs', requestedScope, () => scopeRef.current, {}, body => (body.runs ?? []).length === 0).then(result => {
      if (result === 'stale') return
      setRemote(result)
      if (result.status === 'ready') setRows(result.data.runs ?? [])
      if (result.status === 'empty') setRows([])
    })
  }, [baseUrl, scope.userId, scope.profile, attempt])
  useEffect(() => { setRows(current => liveEvents.reduce(mergeRunEvent, current)) }, [liveEvents])
  return <section className="run-board"><h2>Runs</h2>
    {remote.status === 'loading' ? <p role="status">Loading runs…</p> : null}
    {remote.status === 'failed' ? <Unavailable reason={remote.reason} onRetry={() => setAttempt(a => a + 1)} /> : null}
    {remote.status !== 'loading' && remote.status !== 'failed' ? (rows.length === 0 ? <p>{runBoardEmptyLabel(rows)}</p> : rows.map(row => <article key={row.id} className={`run-row run-row--${row.status}`}><strong>{row.id}</strong><span>{runStatusLabel(row.status)}</span><span>{row.tokens ?? 0} tokens</span>{onCancel && row.status === 'running' ? <button onClick={() => onCancel(row.id)}>cancel</button> : null}</article>)) : null}
  </section>
}
