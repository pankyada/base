import { useState, useEffect, KeyboardEvent } from 'react'
import type { ApprovalMode, CommandSummary, ModelInfo, Project, SessionSummary } from '../lib/types'
import type { ProfileInfo } from '../lib/protocol'

export type PaletteMode = 'root' | 'project_switch' | 'project_new' | 'history' | 'history_all' | 'assign' | 'models' | 'profiles'

export interface ModelRow { key: string; label: string; disabled: boolean; act: () => void }
export function modelRows(models: ModelInfo[], onSetModel: (id: string) => void): ModelRow[] {
  return models.map(model => ({ key: model.id, label: `${model.label} · $${model.input_price}/$${model.output_price}${model.available ? '' : ` · unavailable${model.reason ? ` (${model.reason})` : ''}`}`, disabled: !model.available, act: () => { if (model.available) onSetModel(model.id) } }))
}

export interface ProfileRow { key: string; label: string; disabled: boolean; act: () => void }
export function profileRows(profiles: ProfileInfo[], onSetProfile: (name: string) => void): ProfileRow[] {
  return profiles.map(p => ({ key: p.name, label: `${p.name}${p.mode ? ` · ${p.mode}` : ''}${p.description ? ` · ${p.description}` : ''}`, disabled: false, act: () => onSetProfile(p.name) }))
}
export function shouldOfferCompact(tokens: number | undefined, window: number | undefined): boolean { return tokens != null && window != null && window > 0 && tokens / window >= 0.8 }

interface Props {
  onClose: () => void
  onRun: (id: string) => void
  onReset: () => void
  activeProject: string
  projects: Project[]
  history: SessionSummary[]
  onRequestProjects: () => void
  onRequestHistory: (projectId: string) => void
  onSwitchProject: (id: string, name: string) => void
  onNewProject: (name: string) => void
  onResume: (sessionId: string, project: string) => void
  onAssign: (projectId: string) => void
  models?: ModelInfo[]
  commands?: CommandSummary[]
  onSetModel?: (model: string) => void
  profiles?: ProfileInfo[]
  onSetProfile?: (name: string) => void
  approvalMode?: ApprovalMode
  onSetApprovalMode?: (mode: ApprovalMode) => void
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
  models: 'Switch model',
  profiles: 'Switch profile',
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
      ...(props.models?.length ? [{ key: 'models', label: 'Switch model…', group: 'MODEL', act: () => setMode('models') }] : []),
      ...(props.profiles && props.profiles.length > 1 ? [{ key: 'profiles', label: 'Switch profile…', group: 'PROFILE', act: () => setMode('profiles') }] : []),
      ...(props.commands ?? []).map(command => ({ key: `command:${command.name}`, label: `/${command.name} · ${command.description}`, group: 'COMMAND', act: () => { onRun(command.template); onClose() } })),
    ].filter(r => r.label.toLowerCase().includes(lower))
  } else if (mode === 'project_switch') {
    rows = projects.filter(p => p.name.toLowerCase().includes(lower))
      .map(p => ({ key: p.id, label: p.name, act: () => { props.onSwitchProject(p.id, p.name); onClose() } }))
  } else if (mode === 'assign') {
    rows = projects.filter(p => p.name.toLowerCase().includes(lower))
      .map(p => ({ key: p.id, label: p.name, act: () => { props.onAssign(p.id); onClose() } }))
  } else if (mode === 'history' || mode === 'history_all') {
    rows = history
      .filter(h => (h.title ?? h.id).toLowerCase().includes(lower))
      .map(h => ({ key: h.id, label: h.title ?? h.id.slice(0, 8), group: h.summary, act: () => { props.onResume(h.id, h.project); onClose() } }))
  } else if (mode === 'models') {
    rows = modelRows(props.models ?? [], model => { props.onSetModel?.(model); onClose() })
  } else if (mode === 'profiles') {
    rows = profileRows(props.profiles ?? [], name => { props.onSetProfile?.(name); onClose() })
  }

  const submitNewProject = () => {
    const name = filter.trim()
    if (name) { props.onNewProject(name); onClose() }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); mode === 'root' ? onClose() : (setMode('root'), setFilter('')) ; return }
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
        {props.approvalMode && props.onSetApprovalMode ? <label style={{ padding: '0.4rem 1rem', color: 'var(--dim)', fontSize: '0.75rem' }}>approval
          <select value={props.approvalMode} onChange={event => props.onSetApprovalMode?.(event.target.value as ApprovalMode)} style={{ marginLeft: '0.5rem', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)' }}>
            {(['strict', 'bash', 'danger', 'yolo'] as ApprovalMode[]).map(modeValue => <option key={modeValue} value={modeValue}>{modeValue}</option>)}
          </select>
        </label> : null}
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
