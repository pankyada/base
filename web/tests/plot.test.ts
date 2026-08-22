import { describe, expect, it } from 'vitest'
import { categoryScale, linearScale, timeScale, ticks } from '../widgets/scale'
import { formatValue, collapseSeries } from '../widgets/format'
import { normalizeSeries, barBaseline, seriesColor, collapseSeriesData, pointLabel } from '../widgets/Plot'

describe('plot shell', () => {
  it('builds linear, time, category scales and useful ticks', () => {
    expect(linearScale(5, [0, 10], [0, 100])).toBe(50)
    expect(timeScale('2026-01-01', ['2026-01-01', '2026-01-11'], [0, 100])).toBe(0)
    expect(categoryScale('b', ['a', 'b'], [0, 100])).toBe(100)
    expect(ticks(0, 100, 5)).toHaveLength(5)
  })

  it('formats units and collapses series after eight', () => {
    expect(formatValue(1200, 'ms')).toContain('ms')
    expect(collapseSeries(Array.from({ length: 10 }, (_, i) => ({ key: `s${i}` })))).toHaveLength(9)
  })

  it('treats null as a gap and malformed data as a diagnostic', () => {
    expect(normalizeSeries({ x: { key: 'x', type: 'number' }, series: [{ key: 'y' }], rows: [{ x: 1, y: null }] }).rows[0].y).toBeNull()
    expect(normalizeSeries({ rows: 'bad' }).error).toBeTruthy()
  })

  it('enforces honest bar baselines and stable series colors', () => {
    expect(barBaseline([10, 20])).toEqual({ baseline: 0, axisBreak: false })
    expect(barBaseline([10, 20], false)).toEqual({ baseline: 10, axisBreak: true })
    expect(seriesColor('artifact-1', 'sales', 0)).toBe(seriesColor('artifact-1', 'sales', 0))
  })

  it('collapses tail values into an actual other series and labels points', () => {
    const data = { x: { key: 'x', type: 'category' as const }, series: Array.from({ length: 10 }, (_, i) => ({ key: 's' + i })), rows: [{ x: 'a', ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['s' + i, i + 1])) }] }
    const collapsed = collapseSeriesData(data)
    expect(collapsed.series.at(-1)?.key).toBe('other')
    expect(collapsed.rows[0].other).toBe(19)
    expect(pointLabel(data, 0, 's2')).toContain('s2')
  })
})
