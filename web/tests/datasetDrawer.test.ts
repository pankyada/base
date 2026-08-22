import { describe, expect, it } from 'vitest'
import { datasetContext, nullPercent, uploadPercent } from '../components/data/DatasetDrawer'
import { distribution } from '../components/data/SchemaCard'

describe('dataset drawer', () => {
  it('formats schema null percentage and selection context', () => {
    expect(nullPercent({ name: 'x', dtype: 'number', nulls: 2, distinct: 3, sample: [] }, 10)).toBe(20)
    expect(datasetContext({ id: 'd1', name: 'sales', filename: 'sales.csv', path: '/tmp/sales.csv', bytes: 100, rows: 10, columns: 2, created_at: 'x', provenance: 'untrusted' }, ['amount', 'region'])).toContain('sales.csv')
    expect(datasetContext({ id: 'd1', name: 'sales', filename: 'sales.csv', path: '/tmp/sales.csv', bytes: 100, created_at: 'x', provenance: 'untrusted' }, [])).toContain('unknown rows')
    expect(uploadPercent(50, 100)).toBe(50)
    expect(distribution([1, 1, 2])).toEqual([{ value: '1', count: 2 }, { value: '2', count: 1 }])
  })
})
