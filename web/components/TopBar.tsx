import { useClock } from '../hooks/useClock.js'

interface Props {
  profileName: string
  sessionId: string
  busy: boolean
  onPalette: () => void
}

export function TopBar({ profileName, sessionId, busy, onPalette }: Props) {
  const time = useClock()
  return (
    <div className="topbar">
      <div>
        <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>◆ harness</span>
        <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
        <span>model {profileName}</span>
        <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
        <span>session #{sessionId.slice(0, 4)}</span>
        <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
        <span style={{ color: busy ? 'var(--accent)' : 'var(--ok)' }}>●</span>
        <span style={{ marginLeft: '0.25rem' }}>{busy ? 'working' : 'ready'}</span>
      </div>
      <div>
        <span>{time}</span>
        <button onClick={onPalette} style={{ marginLeft: '1rem', background: 'var(--border)', padding: '0.1rem 0.5rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
          ⌘K palette
        </button>
      </div>
    </div>
  )
}
