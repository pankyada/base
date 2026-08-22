export function MetricTiles({ data }: { data: unknown }) {
  const items = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.entries(data as Record<string, unknown>).map(([label, value]) => ({ label, value })) : []
  return <div className="metric-tiles">{items.map((item, index) => { const value = typeof item === 'object' && item !== null && 'value' in item ? item.value : item; const label = typeof item === 'object' && item !== null && 'label' in item ? item.label : `metric ${index + 1}`; return <div className="metric-tile" key={String(label)}><span>{String(label)}</span><strong>{String(value)}</strong></div> })}</div>
}
