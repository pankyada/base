import { KeyboardEvent } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  busy: boolean
  compact: boolean
  onCancel?: () => void
  onCompact?: () => void
  compactOffer?: boolean
  sendError?: string
}

export function Composer({ value, onChange, onSubmit, busy, compact, onCancel, onCompact, compactOffer, sendError }: Props) {
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="composer" style={{ padding: '1rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '1rem' }}>
      <span style={{ color: 'var(--accent)' }}>›</span>
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={busy}
          placeholder="Message harness..."
          style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none', resize: 'none', fontFamily: 'inherit' }}
          rows={compact ? 1 : 3}
        />
        {sendError && (
          <div role="alert" className="composer-send-error" style={{ fontSize: '0.75rem', color: 'var(--danger, #d66)', marginTop: '0.5rem' }}>
            {sendError} — your message is still here; retry when reconnected.
          </div>
        )}
        {!compact && (
          <div style={{ fontSize: '0.75rem', color: 'var(--dim)', marginTop: '0.5rem', textAlign: 'right' }}>
            Enter to send, Shift+Enter for new line
          </div>
        )}
      </div>
      {busy && onCancel ? <button type="button" onClick={onCancel}>cancel</button> : null}
      {!busy && compactOffer && onCompact ? <button type="button" onClick={onCompact}>compact</button> : null}
    </div>
  )
}
