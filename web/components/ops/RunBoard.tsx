'use client'
import { useEffect, useState } from 'react'

export interface RunRow { id: string; status: string; tokens?: number; costUsd?: number; model?: string }
export function cancelRunUrl(baseUrl: string, id: string): string { return `${baseUrl.replace(/\/$/, '')}/runs/${encodeURIComponent(id)}` }
export function runStatusLabel(status: string): string { return status === 'waiting_input' ? 'waiting for input' : status.replace('_', ' ') }
export function runBoardEmptyLabel(rows: RunRow[]): string { return rows.length ? '' : 'No active runs' }
export function mergeRunEvent(rows: RunRow[], event: { type: string; run_id?: string; tokens_in?: number; tokens_out?: number; cost_usd?: number; status?: 'completed' | 'budget_exceeded' | 'cancelled' | 'failed'; reason?: string }): RunRow[] {
  if (!event.run_id) return rows
  const index = rows.findIndex(row => row.id === event.run_id)
  const current = index >= 0 ? rows[index] : { id: event.run_id, status: 'running' }
  const endStatus = event.status === 'budget_exceeded' || event.status === 'cancelled' || event.status === 'failed' ? event.status : 'done'
  const next = { ...current, ...(event.type === 'turn_start' ? { status: 'running' } : {}), ...(event.type === 'session_end' ? { status: endStatus } : {}), ...(event.type === 'stats' ? { tokens: (event.tokens_in ?? 0) + (event.tokens_out ?? 0), costUsd: event.cost_usd } : {}) }
  return index >= 0 ? rows.map((row, rowIndex) => rowIndex === index ? next : row) : [...rows, next]
}

export function RunBoard({ baseUrl, onCancel, liveEvents = [] }: { baseUrl: string; onCancel?: (id: string) => void; liveEvents?: { type: string; run_id?: string; tokens_in?: number; tokens_out?: number; cost_usd?: number; status?: 'completed' | 'budget_exceeded' | 'cancelled' | 'failed'; reason?: string }[] }) {
  const [rows, setRows] = useState<RunRow[]>([])
  useEffect(() => { void fetch(`${baseUrl}/runs`).then(response => response.ok ? response.json() : { runs: [] }).then(body => setRows(body.runs ?? [])).catch(() => setRows([])) }, [baseUrl])
  useEffect(() => { setRows(current => liveEvents.reduce(mergeRunEvent, current)) }, [liveEvents])
  return <section className="run-board"><h2>Runs</h2>{rows.length === 0 ? <p>{runBoardEmptyLabel(rows)}</p> : rows.map(row => <article key={row.id} className={`run-row run-row--${row.status}`}><strong>{row.id}</strong><span>{runStatusLabel(row.status)}</span><span>{row.tokens ?? 0} tokens</span>{onCancel && row.status === 'running' ? <button onClick={() => onCancel(row.id)}>cancel</button> : null}</article>)}</section>
}
