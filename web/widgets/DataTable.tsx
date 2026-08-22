import { useMemo, useState } from 'react'
import { tableToCsv } from '../lib/export'

export function filterRows(rows: Record<string, unknown>[], query: string): Record<string, unknown>[] { return rows.filter(row => !query || JSON.stringify(row).toLowerCase().includes(query.toLowerCase())) }
export function pinColumn(columns: string[], column: string): string[] { return columns.includes(column) ? [column, ...columns.filter(item => item !== column)] : columns }
export function virtualWindow(rowCount: number, scrollTop: number, viewportHeight: number, rowHeight: number): { start: number; end: number; top: number; bottom: number } {
  if (rowCount <= 0 || rowHeight <= 0) return { start: 0, end: 0, top: 0, bottom: 0 }
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 1)
  const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight))
  return { start, end: Math.max(start, end), top: start * rowHeight, bottom: Math.max(0, rowCount - end) * rowHeight }
}

export function DataTable({ data }: { data: unknown }) {
  const rows = Array.isArray(data) ? data.filter(row => row && typeof row === 'object') as Record<string, unknown>[] : data && typeof data === 'object' && Array.isArray((data as { rows?: unknown[] }).rows) ? (data as { rows: Record<string, unknown>[] }).rows : []
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<string>()
  const [pinned, setPinned] = useState<string>()
  const [scrollTop, setScrollTop] = useState(0)
  const columns = [...new Set(rows.flatMap(row => Object.keys(row))) ]
  const orderedColumns = pinned ? pinColumn(columns, pinned) : columns
  const filtered = useMemo(() => filterRows(rows, query).sort((left, right) => sort ? String(left[sort] ?? '').localeCompare(String(right[sort] ?? ''), undefined, { numeric: true }) : 0), [query, rows, sort])
  const virtualized = filtered.length > 500
  const window = virtualized ? virtualWindow(filtered.length, scrollTop, 420, 28) : { start: 0, end: filtered.length, top: 0, bottom: 0 }
  const visibleRows = filtered.slice(window.start, window.end)
  const csv = tableToCsv(orderedColumns, filtered.map(row => orderedColumns.map(column => row[column])))
  return <div className="data-table"><input aria-label="Filter rows" value={query} onChange={event => { setQuery(event.target.value); setScrollTop(0) }} placeholder="Filter" /><a download="filtered.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>export CSV</a><div className="data-table__viewport" onScroll={event => setScrollTop(event.currentTarget.scrollTop)} style={virtualized ? { maxHeight: 420, overflowY: 'auto' } : undefined}><table><thead><tr>{orderedColumns.map(column => <th key={column}><button onClick={() => setSort(column)}>{column}</button><button aria-label={`Pin ${column}`} onClick={() => setPinned(column)}>pin</button></th>)}</tr></thead><tbody>{window.top ? <tr aria-hidden="true"><td colSpan={Math.max(1, orderedColumns.length)} style={{ height: window.top, padding: 0, border: 0 }} /></tr> : null}{visibleRows.map((row, index) => <tr key={window.start + index}>{orderedColumns.map(column => <td key={column}>{String(row[column] ?? '—')}</td>)}</tr>)}{window.bottom ? <tr aria-hidden="true"><td colSpan={Math.max(1, orderedColumns.length)} style={{ height: window.bottom, padding: 0, border: 0 }} /></tr> : null}</tbody></table></div>{virtualized ? <small>Showing rows {window.start + 1}–{window.end} of {filtered.length}.</small> : null}</div>
}
