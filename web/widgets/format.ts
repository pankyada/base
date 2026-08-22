export function formatValue(value: number | string | null | undefined, unit?: string): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value
  const text = new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value)
  return unit ? `${text} ${unit}` : text
}

export function collapseSeries<T extends { key: string }>(series: T[]): T[] {
  if (series.length <= 8) return series
  return [...series.slice(0, 8), { ...series[8], key: 'other', label: 'Other' }]
}
