interface Props {
  busy: boolean
  focusPane: 'conv' | 'work'
  tokens: { in: number, out: number }
  theme: string
  yolo: boolean
  onToggleTheme: () => void
  onToggleYolo: () => void
}

export function StatusBar({ busy, focusPane, tokens, theme, yolo, onToggleTheme, onToggleYolo }: Props) {
  return (
    <div className="statusbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
        <span style={{ background: busy ? 'var(--accent)' : 'var(--panel-hi)', color: busy ? 'var(--bg)' : 'var(--dim)', padding: '0 0.3rem', borderRadius: '2px' }}>
          {busy ? 'RUN' : 'RDY'}
        </span>
        <span style={{ color: 'var(--border-hi)', margin: '0 0.5rem' }}>│</span>
        <span style={{ color: focusPane === 'conv' ? 'var(--dim)' : 'var(--faint)' }}>conv</span>
        <span style={{ color: 'var(--border-hi)', margin: '0 0.5rem' }}>│</span>
        <span style={{ color: focusPane === 'work' ? 'var(--dim)' : 'var(--faint)' }}>work</span>
        <span style={{ color: 'var(--border-hi)', margin: '0 0.5rem' }}>│</span>
        <span style={{ color: 'var(--faint)' }}>{tokens.in} in / {tokens.out} out</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          onClick={onToggleYolo}
          title="YOLO mode: allow all tool calls without approval"
          style={{
            cursor: 'pointer',
            color: yolo ? 'var(--del)' : 'var(--faint)',
            background: yolo ? 'var(--accent-sub)' : 'transparent',
            border: yolo ? '1px solid var(--accent-dim)' : '1px solid transparent',
            borderRadius: '3px',
            padding: '0 0.3rem',
            fontSize: '0.7rem',
            lineHeight: '1.4',
            letterSpacing: '0.04em',
          }}
        >
          ⚡ {yolo ? 'yolo: on' : 'yolo: off'}
        </button>
        <button onClick={onToggleTheme} style={{ cursor: 'pointer', color: 'var(--faint)' }}>
          theme: {theme}
        </button>
      </div>
    </div>
  )
}
