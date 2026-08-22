import { useState } from 'react'
import React from 'react'
import { collapseSeries, formatValue } from './format'
import { categoryScale, linearScale, timeScale } from './scale'

export interface SeriesData {
  x: { key: string; label?: string; type: 'category' | 'number' | 'time' }
  series: Array<{ key: string; label?: string; unit?: string }>
  rows: Array<Record<string, string | number | null>>
  annotations?: Array<{ x: string | number; label: string }>
}

export function barBaseline(values: number[], zeroBaseline = true): { baseline: number; axisBreak: boolean } {
  if (zeroBaseline || !values.length) return { baseline: 0, axisBreak: false }
  return { baseline: Math.min(...values), axisBreak: true }
}

export function seriesColor(artifactId: string, key: string, index: number): string {
  let hash = 0
  for (const char of `${artifactId}:${key}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `var(--series-${((hash + index) % 8) + 1})`
}

export function collapseSeriesData(data: SeriesData): SeriesData {
  if (data.series.length <= 8) return data
  const visible = data.series.slice(0, 8)
  const tail = data.series.slice(8)
  return {
    ...data,
    series: [...visible, { key: 'other', label: 'Other' }],
    rows: data.rows.map(row => ({
      ...row,
      other: tail.reduce<number | null>((sum, item) => {
        const value = row[item.key]
        if (typeof value !== 'number') return sum
        return (sum ?? 0) + value
      }, null),
    })),
  }
}

export function pointLabel(data: SeriesData, rowIndex: number, seriesKey: string): string {
  const row = data.rows[rowIndex]
  if (!row) return ''
  return seriesKey + ': ' + formatValue(row[seriesKey]) + ' at ' + formatValue(row[data.x.key])
}

export function normalizeSeries(data: unknown): { data?: SeriesData; rows: SeriesData['rows']; error?: string } {
  if (!data || typeof data !== 'object') return { rows: [], error: 'Plot data must be an object' }
  const candidate = data as Partial<SeriesData>
  if (!candidate.x || !Array.isArray(candidate.series) || !Array.isArray(candidate.rows) || typeof candidate.x.key !== 'string') return { rows: [], error: 'Plot data requires x, series, and rows' }
  const rows = candidate.rows.filter(row => row && typeof row === 'object') as SeriesData['rows']
  if (rows.length !== candidate.rows.length) return { rows: [], error: 'Plot rows must be objects' }
  return { data: { x: candidate.x as SeriesData['x'], series: candidate.series as SeriesData['series'], rows }, rows }
}

interface Props { data: unknown; title?: string; mark?: 'line' | 'bar' | 'area' | 'scatter'; artifactId?: string; zeroBaseline?: boolean }

export function Plot({ data: input, title, mark = 'line', artifactId = 'plot', zeroBaseline = true }: Props) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [hovered, setHovered] = useState<{ row: number; series: string }>()
  const normalized = normalizeSeries(input)
  if (normalized.error || !normalized.data) return <div role="alert" className="widget-error">{normalized.error}</div>
  const data = normalized.data
  if (!data.rows.length) return <div className="widget-empty">No data</div>
  const collapsedData = collapseSeriesData(data)
  const series = collapsedData.series.filter(item => !hidden.has(item.key))
  const collapsed = data.series.length > 8
  const hasNumericValue = collapsedData.rows.some(row => series.some(item => typeof row[item.key] === 'number'))
  if (!hasNumericValue) return <div className="widget-empty">All values are null</div>
  const xValues = collapsedData.rows.map(row => row[data.x.key]).filter((value): value is string | number => value != null)
  const numeric = xValues.filter((value): value is number => typeof value === 'number')
  const min = numeric.length ? Math.min(...numeric) : 0
  const max = numeric.length ? Math.max(...numeric) : 1
  const baseline = barBaseline(numeric, zeroBaseline)
  const pointX = (value: string | number | null) => value == null ? null : data.x.type === 'category' ? categoryScale(String(value), xValues.map(String), [30, 370]) : data.x.type === 'time' ? timeScale(value, [xValues[0] ?? '', xValues.at(-1) ?? ''], [30, 370]) : linearScale(Number(value), [min, max], [30, 370])
  const toggleSeries = (key: string) => setHidden(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  return <figure className="plot" aria-label={title ?? 'Plot'}>
    {title ? <figcaption>{title}</figcaption> : null}
    <svg viewBox="0 0 400 220" role="img" tabIndex={0} aria-label={title ?? 'Plot'} onKeyDown={event => { if (event.key === 'ArrowRight' && hovered) setHovered(current => current && { ...current, row: Math.min(collapsedData.rows.length - 1, current.row + 1) }); if (event.key === 'ArrowLeft' && hovered) setHovered(current => current && { ...current, row: Math.max(0, current.row - 1) }) }}>
      <line x1="30" y1="190" x2="370" y2="190" stroke="var(--border)" /><line x1="30" y1="20" x2="30" y2="190" stroke="var(--border)" />
      {baseline.axisBreak ? <path d="M25 185l10 10m-10-4l10 10" stroke="var(--warn)" aria-label="axis break" /> : null}
      {series.map((item, seriesIndex) => collapsedData.rows.map((row, rowIndex) => {
        const x = pointX(row[data.x.key]); const raw = row[item.key]; const values = collapsedData.rows.map(candidate => candidate[item.key]).filter((value): value is number => typeof value === 'number'); const y = typeof raw === 'number' ? 190 - linearScale(raw, [baseline.baseline, Math.max(baseline.baseline + 1, ...values)], [0, 160]) : null
        if (x == null || y == null) return null
        return <g key={item.key + '-' + rowIndex} onMouseEnter={() => setHovered({ row: rowIndex, series: item.key })} onFocus={() => setHovered({ row: rowIndex, series: item.key })} tabIndex={0} role="button" aria-label={pointLabel(collapsedData, rowIndex, item.key)}><circle cx={x} cy={y} r={mark === 'scatter' ? 4 : 3} fill={seriesColor(artifactId, item.key, seriesIndex)} /><title>{pointLabel(collapsedData, rowIndex, item.key)}</title></g>
      }))}
      {mark === 'bar' ? collapsedData.rows.map((row, rowIndex) => series.map((item, seriesIndex) => { const x = pointX(row[data.x.key]); const raw = row[item.key]; if (x == null || typeof raw !== 'number') return null; const values = collapsedData.rows.map(candidate => candidate[item.key]).filter((value): value is number => typeof value === 'number'); const y = 190 - linearScale(raw, [baseline.baseline, Math.max(baseline.baseline + 1, ...values)], [0, 160]); return <rect key={'bar-' + item.key + '-' + rowIndex} x={x - 5 + seriesIndex * 10} y={Math.min(y, 190)} width={8} height={Math.abs(190 - y)} fill={seriesColor(artifactId, item.key, seriesIndex)} opacity={0.7} /> })) : null}
    </svg>
    {hovered ? <output className="plot__tooltip">{pointLabel(collapsedData, hovered.row, hovered.series)}</output> : null}
    <div className="plot__legend">{collapsedData.series.map((item, index) => <button type="button" key={item.key} onClick={() => toggleSeries(item.key)} aria-pressed={!hidden.has(item.key)} style={{ color: seriesColor(artifactId, item.key, index) }}>{item.label ?? item.key}</button>)}{collapsed ? <small>Additional series collapsed into other.</small> : null}</div>
    <table className="sr-only"><caption>{title ?? 'Plot data'}</caption><thead><tr><th>{data.x.label ?? data.x.key}</th>{series.map(item => <th key={item.key}>{item.label ?? item.key}</th>)}</tr></thead><tbody>{collapsedData.rows.map((row, index) => <tr key={index}><td>{formatValue(row[data.x.key])}</td>{series.map(item => <td key={item.key}>{formatValue(row[item.key], item.unit)}</td>)}</tr>)}</tbody></table>
  </figure>
}
