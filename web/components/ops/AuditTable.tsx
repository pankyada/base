'use client'
import { useEffect, useRef, useState } from 'react'
import { buildScopedUrl, isStaleScope, type RequestScope } from '../../lib/scopedRequest'

export interface AuditEntry { id?: string; ts: string; tool?: string; effect?: string; decision?: string; decided_by?: string; decided_reason?: string; tainted?: boolean; input_digest?: string; undo?: boolean; ok?: boolean }
export function auditUrl(baseUrl: string, filters: { tainted?: boolean; tool?: string; effect?: string; decision?: string }, scope: RequestScope = {}): string {
  return buildScopedUrl(baseUrl, '/audit', scope, { tainted: filters.tainted != null ? String(filters.tainted) : undefined, tool: filters.tool, effect: filters.effect, decision: filters.decision })
}
export function AuditTable({ baseUrl, scope = {}, entries: initialEntries = [] }: { baseUrl?: string; scope?: RequestScope; entries?: AuditEntry[] }) {
  const [entries, setEntries] = useState(initialEntries)
  const [tainted, setTainted] = useState(false)
  const [tool, setTool] = useState('')
  const [expanded, setExpanded] = useState<string>()
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  useEffect(() => {
    if (!baseUrl) return
    const requestedScope = scopeRef.current
    setEntries([]) // drop the previous scope's audit rows before the new scoped read lands
    const url = auditUrl(baseUrl, { tainted: tainted || undefined, tool: tool || undefined }, requestedScope)
    void fetch(url).then(response => response.ok ? response.json() : { entries: [] }).then(body => { if (!isStaleScope(requestedScope, scopeRef.current)) setEntries(body.entries ?? []) }).catch(() => { if (!isStaleScope(requestedScope, scopeRef.current)) setEntries([]) })
  }, [baseUrl, scope.userId, scope.profile, tainted, tool])
  return <section className="audit-table"><h2>Audit</h2><div><label>tool <input value={tool} onChange={event => setTool(event.target.value)} /></label><label><input type="checkbox" checked={tainted} onChange={event => setTainted(event.target.checked)} /> tainted only</label></div><div style={{ maxHeight: 420, overflowY: 'auto' }}><table><thead><tr><th>time</th><th>tool</th><th>effect</th><th>decision</th><th>tainted</th><th>ok</th></tr></thead><tbody>{entries.slice(0, 1000).map((entry, index) => { const id = entry.id ?? String(index); return <tr key={id} onClick={() => setExpanded(expanded === id ? undefined : id)}><td>{entry.ts}</td><td>{entry.tool}</td><td>{entry.effect}</td><td>{entry.decision}</td><td>{entry.tainted ? 'yes' : 'no'}</td><td>{entry.ok === false ? 'no' : 'yes'}</td>{expanded === id ? <td colSpan={6}><div>digest: {entry.input_digest ?? 'none'} · undo: {entry.undo ? 'available' : 'none'}{entry.decided_reason ? ` · ${entry.decided_reason}` : ''}</div></td> : null}</tr> })}</tbody></table></div></section>
}
