import { useState, useEffect, KeyboardEvent } from 'react'
import { Project, SessionSummary } from '../lib/types'

export type PaletteMode = 'root' | 'project_switch' | 'project_new' | 'history' | 'history_all' | 'assign'

interface Props {
  onClose: () => void
  onRun: (id: string) => void
  onReset: () => void
  activeProject: string
  projects: Project[]
  history: SessionSummary[]
  onRequestProjects: () => void
  onRequestHistory: (projectId?: string) => void
  onSwitchProject: (id: string, name: string) => void
  onNewProject: (name: string) => void
  onResume: (sessionId: string, project: string) => void
  onAssign: (projectId: string) => void
}

const RUN_SCENARIOS = [
  { id: 'data', title: 'Run Data Analysis' },
  { id: 'coding', title: 'Run Coding Task' },
  { id: 'writing', title: 'Run Writing Task' },
  { id: 'research', title: 'Run Research Task' },
]

export const ROOT_COMMANDS: { id: string; title: string; group: string; mode: PaletteMode }[] = [
  { id: 'switch', title: 'Switch project…', group: 'PROJECT', mode: 'project_switch' },
  { id: 'newproj', title: 'New project…', group: 'PROJECT', mode: 'project_new' },
  { id: 'assign', title: 'Move session to project…', group: 'PROJECT', mode: 'assign' },
  { id: 'history', title: 'Browse history…', group: 'HISTORY', mode: 'history' },
  { id: 'history_all', title: 'Browse all history…', group: 'HISTORY', mode: 'history_all' },
]

const MODE_LABEL: Record<PaletteMode, string> = {
  root: '',
  project_switch: 'Switch project',
  project_new: 'New project',
  history: 'History',
  history_all: 'All history',
  assign: 'Move to project',
}

export function Palette(props: Props) {
  const { onClose, onRun, onReset, activeProject, projects, history } = props
  const [mode, setMode] = useState<PaletteMode>('root')
  const [filter, setFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Fetch data on entering a data-backed mode.
  useEffect(() => {
    if (mode === 'project_switch' || mode === 'assign') props.onRequestProjects()
    if (mode === 'history') props.onRequestHistory(activeProject)
    if (mode === 'history_all') props.onRequestHistory('')
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSelectedIndex(0) }, [filter, mode])

  const lower = filter.toLowerCase()

  // Build the list of selectable rows for the current mode.
  type Row = { key: string; label: string; group?: string; act: () => void }
  let rows: Row[] = []

  if (mode === 'root') {
    rows = [
      ...RUN_SCENARIOS.map(s => ({ key: s.id, label: s.title, group: 'RUN TASK', act: () => { onRun(s.id); onClose() } })),
      { key: 'reset', label: 'Clear Session', group: 'SESSION', act: () => { onReset(); onClose() } },
      ...ROOT_COMMANDS.map(c => ({ key: c.id, label: c.title, group: c.group, act: () => setMode(c.mode) })),
    ].filter(r => r.label.toLowerCase().includes(lower))
  } else if (mode === 'project_switch') {
    rows = projects.filter(p => p.name.toLowerCase().includes(lower))
      .map(p => ({ key: p.id, label: p.name, act: () => { props.onSwitchProject(p.id, p.name); onClose() } }))
  } else if (mode === 'assign') {
    rows = projects.filter(p => p.name.toLowerCase().includes(lower))
      .map(p => ({ key: p.id, label: p.name, act: () => { props.onAssign(p.id); onClose() } }))
  } else if (mode === 'history' || mode === 'history_all') {
    rows = history
      .filter(h => h.id.toLowerCase().includes(lower) || h.project.toLowerCase().includes(lower))
      .map(h => ({ key: h.id, label: h.id.slice(0, 8), group: h.project, act: () => { props.onResume(h.id, h.project); onClose() } }))
  }

  const submitNewProject = () => {
    const name = filter.trim()
    if (name) { props.onNewProject(name); onClose() }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { mode === 'root' ? onClose() : (setMode('root'), setFilter('')) ; return }
    if (mode === 'project_new') {
      if (e.key === 'Enter') submitNewProject()
      return
    }
    if (e.key === 'ArrowDown') setSelectedIndex(i => Math.min(i + 1, rows.length - 1))
    if (e.key === 'ArrowUp') setSelectedIndex(i => Math.max(i - 1, 0))
    if (e.key === 'Enter' && rows.length > 0) rows[selectedIndex]?.act()
  }

  const placeholder = mode === 'project_new' ? 'New project name, then Enter…' : 'Search…'

  return (
    <div className="palette-scrim" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', paddingTop: '10vh', zIndex: 100 }}>
      <div className="palette" style={{ width: '600px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '50vh' }}>
        {mode !== 'root' && (
          <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>
            {MODE_LABEL[mode]} ›  <span style={{ opacity: 0.6 }}>(Esc to go back)</span>
          </div>
        )}
        <input
          autoFocus
          value={filter}
          onChange={e => setFilter(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{ padding: '1rem', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text)', outline: 'none' }}
        />
        <div style={{ overflowY: 'auto' }}>
          {mode === 'project_new' ? (
            <div style={{ padding: '0.75rem 1rem', color: 'var(--dim)', fontSize: '0.85rem' }}>Type a name and press Enter to create.</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '0.75rem 1rem', color: 'var(--dim)', fontSize: '0.85rem' }}>{(mode === 'history' || mode === 'history_all' || mode === 'project_switch' || mode === 'assign') ? 'Loading…' : 'No matches'}</div>
          ) : rows.map((row, i) => (
            <div
              key={row.key}
              onClick={() => row.act()}
              style={{ padding: '0.5rem 1rem', background: selectedIndex === i ? 'var(--accent)' : 'transparent', color: selectedIndex === i ? 'var(--bg)' : 'var(--text)', cursor: 'pointer' }}
            >
              {row.group && <span style={{ fontSize: '0.75rem', opacity: 0.7, marginRight: '1rem' }}>{row.group}</span>}
              {row.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
