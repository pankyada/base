interface Props {
  busy: boolean
  focusPane: 'conv' | 'work'
  tokens: { in: number, out: number }
  theme: string
  onToggleTheme: () => void
  approvalMode?: string
  context?: { tokens: number; window?: number }
  costUsd?: number
}

import { ContextGauge } from './chrome/ContextGauge'
import { CostTicker } from './chrome/CostTicker'

export function StatusBar({ busy, focusPane, tokens, theme, approvalMode, onToggleTheme, context, costUsd }: Props) {
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
        <ContextGauge tokens={context?.tokens} window={context?.window} />
        <CostTicker costUsd={costUsd} tokensIn={tokens.in} tokensOut={tokens.out} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span>approval: {approvalMode ?? '…'}</span>
        <button onClick={onToggleTheme} style={{ cursor: 'pointer', color: 'var(--faint)' }}>
          theme: {theme}
        </button>
      </div>
    </div>
  )
}
