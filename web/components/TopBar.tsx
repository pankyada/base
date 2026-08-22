import { useClock } from '../hooks/useClock'
import type { ProfileInfo } from '../lib/protocol'

interface Props {
  profileName: string
  profiles?: ProfileInfo[]
  onSetProfile?: (name: string) => void
  projectName: string
  sessionId: string
  busy: boolean
  onPalette: () => void
  onExportSession?: () => void
  model?: string
}

export function TopBar({ profileName, profiles, onSetProfile, projectName, sessionId, busy, onPalette, onExportSession, model }: Props) {
  const time = useClock()
  return (
    <div className="topbar">
      <div>
        <span style={{ color: 'var(--accent)' }}>◆ harness</span>
        <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
        {profiles && profiles.length > 1 && onSetProfile ? (
          <select
            aria-label="profile"
            value={profileName}
            onChange={e => onSetProfile(e.target.value)}
            style={{ background: 'transparent', color: 'inherit', border: 'none', font: 'inherit', cursor: 'pointer' }}
          >
            {profiles.map(p => <option key={p.name} value={p.name}>profile {p.name}</option>)}
          </select>
        ) : (
          <span>profile {profileName}</span>
        )}
        {model ? <><span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span><span>model {model}</span></> : null}
        <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
        <span>project {projectName}</span>
        <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
        <span>session #{sessionId.slice(0, 4)}</span>
        <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
        <span style={{ color: busy ? 'var(--accent)' : 'var(--ok)' }}>●</span>
        <span style={{ marginLeft: '0.25rem' }}>{busy ? 'working' : 'ready'}</span>
      </div>
      <div>
        <span>{time}</span>
        {onExportSession ? <button onClick={onExportSession} style={{ marginLeft: '1rem', background: 'var(--border)', padding: '0.1rem 0.5rem', borderRadius: '0.25rem', cursor: 'pointer' }}>export session</button> : null}
        <button onClick={onPalette} style={{ marginLeft: '1rem', background: 'var(--border)', padding: '0.1rem 0.5rem', borderRadius: '0.25rem', cursor: 'pointer' }}>
          ⌘K palette
        </button>
      </div>
    </div>
  )
}
