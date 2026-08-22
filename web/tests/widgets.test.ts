import { describe, expect, it } from 'vitest'
import { WIDGET_KINDS, widgetForKind } from '../widgets/GenWidget'
import { filterRows, pinColumn, virtualWindow } from '../widgets/DataTable'

describe('fixed widget kit', () => {
  it('covers every supported artifact kind', () => {
    for (const kind of ['metrics', 'bar', 'line', 'area', 'scatter', 'histogram', 'heatmap', 'box', 'correlation', 'table', 'diff', 'filetree', 'terminal', 'doc', 'research']) {
      expect(WIDGET_KINDS).toContain(kind)
      expect(widgetForKind(kind)).toBeTruthy()
    }
  })

  it('filters and pins table columns while retaining large-row virtualization', () => {
    const rows = [{ a: 'x', b: 1 }, { a: 'y', b: 2 }]
    expect(filterRows(rows, 'y')).toEqual([{ a: 'y', b: 2 }])
    expect(pinColumn(['a', 'b'], 'b')).toEqual(['b', 'a'])
    expect(virtualWindow(1000, 240, 240, 28)).toEqual({ start: 7, end: 18, top: 196, bottom: 27496 })
  })
})
