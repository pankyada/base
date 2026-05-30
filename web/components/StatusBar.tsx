interface Props {
  busy: boolean
  focusPane: 'conv' | 'work'
  surface?: string
  surfaceIdx?: number
  surfaceTotal?: number
  tokens: { in: number, out: number }
  theme: string
  onToggleTheme: () => void
}

export function StatusBar({ busy, focusPane, surface, surfaceIdx, surfaceTotal, tokens, theme, onToggleTheme }: Props) {
  return (
    <div className="statusbar">
      <div>
        <span style={{ background: 'var(--accent)', color: 'var(--bg)', padding: '0 0.25rem' }}>
          {busy ? 'RUN' : 'RDY'}
        </span>
        <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
        <span style={{ color: focusPane === 'conv' ? 'var(--text)' : 'var(--dim)' }}>conv</span>
        <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
        <span style={{ color: focusPane === 'work' ? 'var(--text)' : 'var(--dim)' }}>work</span>
        {surface && (
          <>
            <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
            <span>{surface} {surfaceIdx}/{surfaceTotal}</span>
          </>
        )}
        <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
        <span>{tokens.in} in / {tokens.out} out</span>
      </div>
      <div>
        <button onClick={onToggleTheme} style={{ cursor: 'pointer' }}>theme: {theme}</button>
      </div>
    </div>
  )
}
