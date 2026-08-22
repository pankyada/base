interface Props { tokens?: number; window?: number }

export function contextPercent(tokens: number | undefined, window: number | undefined): number | null {
  if (!window || window <= 0 || tokens == null) return null
  return Math.min(100, Math.max(0, Math.round((tokens / window) * 100)))
}

export function ContextGauge({ tokens, window }: Props) {
  const percent = contextPercent(tokens, window)
  return (
    <span className="context-gauge" title={percent == null ? 'Context window unavailable' : `${percent}% context used`}>
      <span className="context-gauge__label">ctx</span>
      <span className="context-gauge__track"><span className="context-gauge__fill" style={{ width: `${percent ?? 0}%` }} /></span>
      <span className="context-gauge__value">{percent == null ? '—' : `${percent}%`}</span>
    </span>
  )
}
