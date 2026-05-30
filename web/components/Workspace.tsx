import { ArtifactKind, WorkspaceTab } from '../lib/types.js'
import { GenWidget } from '../widgets/GenWidget.js'

interface Props {
  tabs: WorkspaceTab[]
  activeTab: number
  onTabChange: (index: number) => void
}

export function Workspace({ tabs, activeTab, onTabChange }: Props) {
  const tab = tabs[activeTab]

  return (
    <div className="pane">
      <div className="wtabs" style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {tabs.map((t, i) => (
          <div
            key={t.id}
            className="wtab"
            style={{
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              color: activeTab === i ? 'var(--accent)' : 'var(--dim)',
              borderBottom: activeTab === i ? '2px solid var(--accent)' : 'none'
            }}
            onClick={() => onTabChange(i)}
          >
            {i + 1} {t.label}
          </div>
        ))}
      </div>
      <div className="pane-body" style={{ flexGrow: 1, padding: '1rem', overflowY: 'auto' }}>
        {tab && tab.artifacts.map((a, i) => (
          <div key={a.id || i} style={{ marginBottom: '2rem' }}>
            <div className="cap">
              {a.icon} {a.title} {a.meta && `· ${a.meta}`}
            </div>
            <GenWidget artifact={a} />
          </div>
        ))}
      </div>
    </div>
  )
}
