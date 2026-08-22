import type { DatasetColumn, DatasetSchema } from '../../lib/datasets'

export function nullPercent(column: DatasetColumn, rows: number | undefined): number { return !rows ? 0 : Math.round((column.nulls / rows) * 100) }
export function distribution(values: unknown[]): { value: string; count: number }[] { const counts = new Map<string, number>(); for (const value of values) { const key = String(value); counts.set(key, (counts.get(key) ?? 0) + 1) } return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 5) }

export function SchemaCard({ schema, rows }: { schema: DatasetSchema; rows?: number }) {
  return <div className="schema-card">{schema.columns.map(column => <div className="schema-card__column" key={column.name}><strong>{column.name}</strong><span>{column.dtype}</span><span>{nullPercent(column, rows)}% null · {column.distinct} distinct</span><div className="schema-card__distribution">{distribution(column.sample).map(item => <span key={item.value} style={{ width: `${Math.max(4, item.count * 10)}%` }} title={`${item.value}: ${item.count}`} />)}</div></div>)}</div>
}
