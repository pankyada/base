import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Box, normalizeBox } from '../widgets/Box'
import { Correlation, normalizeCorrelation } from '../widgets/Correlation'
import { Heatmap, normalizeHeatmap } from '../widgets/Heatmap'

describe('R1 visual widgets', () => {
  it('renders SVG charts with labels, legends and missing cells', () => {
    const heatmap = renderToStaticMarkup(React.createElement(Heatmap, { data: { columns: ['Jan', 'Feb'], rows: [{ label: 'A', values: [1, null] }] } }))
    const box = renderToStaticMarkup(React.createElement(Box, { data: { series: [{ key: 'latency', label: 'Latency', values: [1, 2, 4] }] } }))
    const correlation = renderToStaticMarkup(React.createElement(Correlation, { data: { columns: ['x', 'y'], matrix: [[1, null], [null, 1]] } }))
    expect(heatmap).toContain('<svg')
    expect(heatmap).toContain('Jan')
    expect(heatmap).toContain('Heatmap legend')
    expect(heatmap).toContain('A, Feb: —')
    expect(box).toContain('<svg')
    expect(box).toContain('Latency')
    expect(correlation).toContain('<svg')
    expect(correlation).toContain('Correlation matrix')
  })

  it('reports actionable invalid states and retains nulls as missing', () => {
    expect(normalizeHeatmap({ columns: ['x'], rows: [{ label: 'a', values: [Number.NaN] }] }).error).toContain('finite')
    expect(normalizeCorrelation({ columns: ['x'], matrix: [[2]] }).error).toContain('-1 to 1')
    expect(normalizeBox({ series: [{ key: 'empty', values: [] }] }).error).toContain('finite')
    expect(renderToStaticMarkup(React.createElement(Heatmap, { data: { columns: ['x'], rows: [{ label: 'a', values: ['bad'] }] } }))).toContain('role="alert"')
  })
})
