import React from 'react'
import type { Artifact } from '../lib/types'
import { MetricTiles } from './MetricTiles'
import { Bar } from './Bar'
import { Line } from './Line'
import { Area } from './Area'
import { Scatter } from './Scatter'
import { Histogram } from './Histogram'
import { Heatmap } from './Heatmap'
import { Box } from './Box'
import { Correlation } from './Correlation'
import { DataTable } from './DataTable'
import { DiffView } from './DiffView'
import { FileTree } from './FileTree'
import { TermOut } from './TermOut'
import { DocView } from './DocView'

export const WIDGET_KINDS = ['metrics', 'bar', 'line', 'area', 'scatter', 'histogram', 'heatmap', 'box', 'correlation', 'table', 'diff', 'filetree', 'terminal', 'doc', 'research'] as const
type WidgetProps = { data: unknown }
export function widgetForKind(kind: string): ((props: WidgetProps) => JSX.Element) | undefined {
  switch (kind) {
    case 'metrics': return MetricTiles
    case 'bar': return Bar
    case 'line': return Line
    case 'area': return Area
    case 'scatter': return Scatter
    case 'histogram': return Histogram
    case 'heatmap': return Heatmap
    case 'box': return Box
    case 'correlation': return Correlation
    case 'table': return DataTable
    case 'diff': return DiffView
    case 'filetree': return FileTree
    case 'terminal': return TermOut
    case 'doc': case 'research': return DocView
    default: return undefined
  }
}

export function GenWidget({ artifact }: { artifact: Artifact }) {
  const Widget = widgetForKind(artifact.kind)
  return Widget ? <Widget data={artifact.data} /> : <div role="alert">Unknown widget kind: {artifact.kind}</div>
}
