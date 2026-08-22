'use client'
import { useEffect, useState } from 'react'

export interface AuditEntry { id?: string; ts: string; tool?: string; effect?: string; decision?: string; decided_by?: string; decided_reason?: string; tainted?: boolean; input_digest?: string; undo?: boolean; ok?: boolean }
export function auditUrl(baseUrl: string, filters: { tainted?: boolean; tool?: string; effect?: string; decision?: string }): string { const params = new URLSearchParams(); if (filters.tainted != null) params.set('tainted', String(filters.tainted)); if (filters.tool) params.set('tool', filters.tool); if (filters.effect) params.set('effect', filters.effect); if (filters.decision) params.set('decision', filters.decision); return baseUrl.replace(/\/$/, '') + '/audit?' + params.toString() }
export function AuditTable({ baseUrl, entries: initialEntries = [] }: { baseUrl?: string; entries?: AuditEntry[] }) {
  const [entries, setEntries] = useState(initialEntries)
  const [tainted, setTainted] = useState(false)
  const [tool, setTool] = useState('')
  const [expanded, setExpanded] = useState<string>()
  useEffect(() => {
    if (!baseUrl) return
    const url = auditUrl(baseUrl, { tainted: tainted || undefined, tool: tool || undefined })
    void fetch(url).then(response => response.ok ? response.json() : { entries: [] }).then(body => setEntries(body.entries ?? [])).catch(() => setEntries([]))
  }, [baseUrl, tainted, tool])
  return <section className="audit-table"><h2>Audit</h2><div><label>tool <input value={tool} onChange={event => setTool(event.target.value)} /></label><label><input type="checkbox" checked={tainted} onChange={event => setTainted(event.target.checked)} /> tainted only</label></div><div style={{ maxHeight: 420, overflowY: 'auto' }}><table><thead><tr><th>time</th><th>tool</th><th>effect</th><th>decision</th><th>tainted</th><th>ok</th></tr></thead><tbody>{entries.slice(0, 1000).map((entry, index) => { const id = entry.id ?? String(index); return <tr key={id} onClick={() => setExpanded(expanded === id ? undefined : id)}><td>{entry.ts}</td><td>{entry.tool}</td><td>{entry.effect}</td><td>{entry.decision}</td><td>{entry.tainted ? 'yes' : 'no'}</td><td>{entry.ok === false ? 'no' : 'yes'}</td>{expanded === id ? <td colSpan={6}><div>digest: {entry.input_digest ?? 'none'} · undo: {entry.undo ? 'available' : 'none'}{entry.decided_reason ? ` · ${entry.decided_reason}` : ''}</div></td> : null}</tr> })}</tbody></table></div></section>
}
