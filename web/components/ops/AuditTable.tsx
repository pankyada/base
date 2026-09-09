'use client'
import { useEffect, useRef, useState } from 'react'
import { buildScopedUrl, type RequestScope } from '../../lib/scopedRequest'
import { fetchScopedRemote, type RemoteData } from '../../lib/remoteData'
import { Unavailable } from '../chrome/Unavailable'

export interface AuditEntry { id?: string; ts: string; tool?: string; effect?: string; decision?: string; decided_by?: string; decided_reason?: string; tainted?: boolean; input_digest?: string; undo?: boolean; ok?: boolean }
export function auditUrl(baseUrl: string, filters: { tainted?: boolean; tool?: string; effect?: string; decision?: string }, scope: RequestScope = {}): string {
  return buildScopedUrl(baseUrl, '/audit', scope, { tainted: filters.tainted != null ? String(filters.tainted) : undefined, tool: filters.tool, effect: filters.effect, decision: filters.decision })
}
interface AuditBody { entries?: AuditEntry[] }
export function AuditTable({ baseUrl, scope = {}, entries: initialEntries = [] }: { baseUrl?: string; scope?: RequestScope; entries?: AuditEntry[] }) {
  const [entries, setEntries] = useState(initialEntries)
  const [remote, setRemote] = useState<RemoteData<AuditBody>>(baseUrl ? { status: 'loading' } : { status: 'ready', data: { entries: initialEntries } })
  const [tainted, setTainted] = useState(false)
  const [tool, setTool] = useState('')
  const [expanded, setExpanded] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  useEffect(() => {
    if (!baseUrl) return
    const requestedScope = scopeRef.current
    setRemote({ status: 'loading' })
    setEntries([]) // drop the previous scope's audit rows before the new scoped read lands
    void fetchScopedRemote<AuditBody>(baseUrl, '/audit', requestedScope, () => scopeRef.current, { extraParams: { tainted: tainted ? 'true' : undefined, tool: tool || undefined }, isEmpty: body => (body.entries ?? []).length === 0 }).then(result => {
      if (result === 'stale') return
      setRemote(result)
      setEntries(result.status === 'ready' ? (result.data.entries ?? []) : [])
    })
  }, [baseUrl, scope.userId, scope.profile, tainted, tool, attempt])
  return <section className="audit-table"><h2>Audit</h2><div><label>tool <input value={tool} onChange={event => setTool(event.target.value)} /></label><label><input type="checkbox" checked={tainted} onChange={event => setTainted(event.target.checked)} /> tainted only</label></div>
    {remote.status === 'loading' ? <p role="status">Loading audit…</p> : null}
    {remote.status === 'failed' ? <Unavailable reason={remote.reason} onRetry={() => setAttempt(a => a + 1)} /> : null}
    {remote.status !== 'loading' && remote.status !== 'failed' ? (entries.length === 0 ? <p>No audit entries.</p> : <div style={{ maxHeight: 420, overflowY: 'auto' }}><table><thead><tr><th>time</th><th>tool</th><th>effect</th><th>decision</th><th>tainted</th><th>ok</th></tr></thead><tbody>{entries.slice(0, 1000).map((entry, index) => { const id = entry.id ?? String(index); return <tr key={id} onClick={() => setExpanded(expanded === id ? undefined : id)}><td>{entry.ts}</td><td>{entry.tool}</td><td>{entry.effect}</td><td>{entry.decision}</td><td>{entry.tainted ? 'yes' : 'no'}</td><td>{entry.ok === false ? 'no' : 'yes'}</td>{expanded === id ? <td colSpan={6}><div>digest: {entry.input_digest ?? 'none'} · undo: {entry.undo ? 'available' : 'none'}{entry.decided_reason ? ` · ${entry.decided_reason}` : ''}</div></td> : null}</tr> })}</tbody></table></div>) : null}
  </section>
}
