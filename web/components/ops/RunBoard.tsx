'use client'
import { useEffect, useRef, useState } from 'react'
import { buildScopedUrl, type RequestScope } from '../../lib/scopedRequest'
import { fetchScopedRemote, type RemoteData } from '../../lib/remoteData'
import type { WorkflowMapScope } from '../../lib/protocol'
import { Unavailable } from '../chrome/Unavailable'

export interface RunRow { id: string; status: string; tokens?: number; costUsd?: number; model?: string; input?: unknown; trigger?: string; started_at?: string; profile?: string; session_id?: string; error?: string }
export function workflowMapScopeForRun(row: RunRow): WorkflowMapScope | undefined {
  return row.session_id && row.profile ? { run_id: row.id, session_id: row.session_id, profile: row.profile } : undefined
}
export function cancelRunUrl(baseUrl: string, id: string): string { return `${baseUrl.replace(/\/$/, '')}/runs/${encodeURIComponent(id)}` }
export function runsUrl(baseUrl: string, scope: RequestScope = {}): string { return buildScopedUrl(baseUrl, '/runs', scope) }
export function runStatusLabel(status: string): string { return status === 'waiting_input' ? 'waiting for input' : status.replace('_', ' ') }
export function runBoardEmptyLabel(rows: RunRow[]): string { return rows.length ? '' : 'No active runs' }
export type RunStatusGroup = 'waiting' | 'running' | 'finished'
const terminalStatuses = new Set(['completed', 'done', 'failed', 'cancelled', 'budget_exceeded', 'finished'])
export function runStatusGroup(status: string): RunStatusGroup { return status === 'waiting_input' ? 'waiting' : terminalStatuses.has(status) ? 'finished' : 'running' }
export function runInputTitle(input: unknown): string | undefined {
  if (input == null) return undefined
  let text: string
  try { text = typeof input === 'string' ? input : JSON.stringify(input) ?? '' } catch { return undefined }
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, 180) : undefined
}
export function mergeRunEvent(rows: RunRow[], event: { type: string; run_id?: string; tokens_in?: number; tokens_out?: number; cost_usd?: number; status?: string; reason?: string }): RunRow[] {
  if (!event.run_id) return rows
  const index = rows.findIndex(row => row.id === event.run_id)
  const current = index >= 0 ? rows[index] : { id: event.run_id, status: 'running' }
  const endStatus = event.status === 'budget_exceeded' || event.status === 'cancelled' || event.status === 'failed' ? event.status : 'done'
  const next = { ...current, ...(event.type === 'turn_start' ? { status: 'running' } : {}), ...(event.type === 'session_end' ? { status: endStatus } : {}), ...(event.type === 'stats' ? { tokens: (event.tokens_in ?? 0) + (event.tokens_out ?? 0), costUsd: event.cost_usd } : {}) }
  return index >= 0 ? rows.map((row, rowIndex) => rowIndex === index ? next : row) : [...rows, next]
}

interface RunsBody { runs?: RunRow[] }

export function RunBoard({ baseUrl, scope = {}, onCancel, liveEvents = [], refreshToken = 0, selectedRunId, onSelectRun }: { baseUrl: string; scope?: RequestScope; refreshToken?: number; onCancel?: (id: string) => void; liveEvents?: { type: string; run_id?: string; tokens_in?: number; tokens_out?: number; cost_usd?: number; status?: string; reason?: string }[]; selectedRunId?: string; onSelectRun?: (row: RunRow) => void }) {
  const [remote, setRemote] = useState<RemoteData<RunsBody>>({ status: 'loading' })
  const [rows, setRows] = useState<RunRow[]>([])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const lastScope = useRef<string>()
  const [lastUpdated, setLastUpdated] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const requestedScope = scopeRef.current
    let disposed = false
    const key = JSON.stringify([baseUrl, scope.userId, scope.profile])
    if (lastScope.current !== key) { setRemote({ status: 'loading' }); setRows([]); setLastUpdated(undefined); lastScope.current = key }
    void fetchScopedRemote<RunsBody>(baseUrl, '/runs', requestedScope, () => scopeRef.current, { isEmpty: body => (body.runs ?? []).length === 0 }).then(result => {
      if (disposed || result === 'stale') return
      setRemote(result)
      if (result.status === 'ready') setRows(result.data.runs ?? [])
      if (result.status === 'empty') setRows([])
      if (result.status === 'ready' || result.status === 'empty') setLastUpdated(new Date().toISOString())
    })
    return () => { disposed = true }
  }, [baseUrl, scope.userId, scope.profile, attempt, refreshToken])
  useEffect(() => { setRows(current => liveEvents.reduce(mergeRunEvent, current)) }, [liveEvents])
  const groups: { id: RunStatusGroup; label: string; rows: RunRow[] }[] = [
    { id: 'waiting', label: 'Waiting', rows: rows.filter(row => runStatusGroup(row.status) === 'waiting') },
    { id: 'running', label: 'Running', rows: rows.filter(row => runStatusGroup(row.status) === 'running') },
    { id: 'finished', label: 'Finished', rows: rows.filter(row => runStatusGroup(row.status) === 'finished') },
  ]
  const stale = remote.status === 'failed' && rows.length > 0
  return <section className="run-board" data-freshness={stale ? 'stale' : remote.status === 'failed' ? 'unavailable' : remote.status}>
    <header className="ops-section-heading"><div><span className="ops-station-label">Workstream</span><h2>Runs</h2></div>{lastUpdated ? <small>Snapshot {new Date(lastUpdated).toLocaleTimeString()}</small> : null}</header>
    {remote.status === 'loading' ? <p role="status" className="ops-inline-state" data-state="loading">Reading run history…</p> : null}
    {remote.status === 'failed' ? <><Unavailable reason={remote.reason} onRetry={() => setAttempt(a => a + 1)} />{stale ? <p role="status" className="ops-inline-state" data-state="stale">Showing the last successful run snapshot.</p> : null}</> : null}
    {remote.status === 'empty' ? <p className="run-empty" role="status" data-state="empty">{runBoardEmptyLabel(rows)}</p> : null}
    {rows.length > 0 ? <div className="run-lanes">{groups.map(group => <section className={`run-lane run-lane--${group.id}`} key={group.id} aria-label={`${group.label} runs`}>
      <header className="run-lane__heading"><h3>{group.label}</h3><span>{group.rows.length.toString().padStart(2, '0')}</span></header>
      {group.rows.length ? group.rows.map(row => {
        const title = runInputTitle(row.input)
        const statusClass = row.status.replace(/[^a-z0-9-]/gi, '-')
        return <article key={row.id} className={`run-row run-row--${statusClass}`} data-run-status={row.status} aria-current={selectedRunId === row.id ? 'true' : undefined}>
          <span className="run-row__signal" aria-hidden="true" />
          <div className="run-row__main">{title ? <p className="run-row__input" title={title}>{title}</p> : null}
            <div className="run-row__identity"><strong title={row.id}>{row.id}</strong><span className="run-row__status">{runStatusLabel(row.status)}</span>{onSelectRun ? <button className="run-row__select" type="button" aria-label={`Select run ${row.id} for workflow map`} aria-pressed={selectedRunId === row.id} onClick={() => onSelectRun(row)}>Map</button> : null}</div>
            {row.error ? <p className="run-row__error">{row.error}</p> : null}
            <div className="run-row__telemetry">{row.trigger ? <span>{row.trigger}</span> : null}{row.profile ? <span>{row.profile}</span> : null}{row.model ? <span>{row.model}</span> : null}{typeof row.tokens === 'number' ? <span>{row.tokens.toLocaleString()} tokens</span> : null}{typeof row.costUsd === 'number' ? <span>${row.costUsd.toFixed(4)}</span> : null}</div>
          </div>
          {onCancel && row.status === 'running' ? <button className="run-row__cancel" type="button" onClick={() => onCancel(row.id)}>Cancel</button> : null}
        </article>
      }) : <p className="run-lane__empty">No runs in this lane.</p>}
    </section>)}</div> : null}
  </section>
}
