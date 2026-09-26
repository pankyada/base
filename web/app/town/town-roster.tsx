'use client'

import { useEffect, useMemo, useState } from 'react'
import { ARTISAN_LOOKS, artisanLook, CRAFT_LABEL, READ_ONLY_CRAFTS, type ArtisanCraft, type ArtisanStatus } from './town-artisans'

export const ARTISAN_DRAG_TYPE = 'application/x-town-artisan'

const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`

/** Small line emblem per craft; decorative, the accessible name carries the meaning. */
export function CraftEmblem({ craft }: { craft?: ArtisanCraft }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const paths: Record<ArtisanCraft, JSX.Element> = {
    planner: <><rect x="5" y="4" width="14" height="16" rx="1.5" {...common}/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" {...common}/></>,
    designer: <><path d="M12 4v3M12 7l-5 13M12 7l5 13" {...common}/><path d="M7.8 15.5a7 7 0 0 0 8.4 0" {...common}/></>,
    builder: <><path d="M5 19l8-8" {...common}/><rect x="11" y="4" width="8" height="5" rx="1" transform="rotate(45 15 6.5)" {...common}/></>,
    reviewer: <><path d="M6 18l11-11 1.5 1.5-11 11H6z" {...common}/><path d="M14.5 6.5l3 3" {...common}/></>,
    tester: <><circle cx="12" cy="12" r="7" {...common}/><ellipse cx="12" cy="12" rx="7" ry="2.8" {...common}/><path d="M12 5v14" {...common}/></>,
    debugger: <><circle cx="10.5" cy="10.5" r="5" {...common}/><path d="M14.3 14.3L19 19M10.5 8v5M8 10.5h5" {...common}/></>,
    researcher: <><path d="M5 7c3-2 5-2 7 0 2-2 4-2 7 0v11c-3-2-5-2-7 0-2-2-4-2-7 0z" {...common}/><path d="M12 7v11" {...common}/></>,
    scribe: <><path d="M18 5c-6 1-10 6-11 13l3-3c4-1 7-5 8-10z" {...common}/><path d="M5 20l3-3" {...common}/></>,
    guardian: <><path d="M12 4l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z" {...common}/><path d="M9 12l2 2 4-4" {...common}/></>,
  }
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">{craft ? paths[craft] : <circle cx="12" cy="12" r="6" {...common}/>}</svg>
}

export interface RosterProject { id: string; display: { name: string }; path: string }

export interface AssignRequest { agentId: string; projectId: string; prompt: string; workspaceMode: 'read_only' | 'shared_checkout' }

interface RosterProps {
  statuses: ArtisanStatus[]
  hiredPersonas: Set<string>
  projects: RosterProject[]
  selectedId?: string
  pickedProjectId?: string
  pickMode: boolean
  busy: boolean
  onSelect: (id: string | undefined) => void
  onFocusArtisan: (id: string) => void
  onFocusProject: (id: string) => void
  onPickStart: () => void
  onPickCancel: () => void
  onProjectChange: (id: string | undefined) => void
  onAssign: (request: AssignRequest) => Promise<boolean>
  onHire: (persona: string) => void
}

export function TownRoster(props: RosterProps) {
  const { statuses, selectedId, pickMode } = props
  const [hireOpen, setHireOpen] = useState(false)
  const selected = statuses.find(status => status.id === selectedId)
  const apprentices = ARTISAN_LOOKS.filter(look => look.apprentice && !props.hiredPersonas.has(look.key))
  useEffect(() => {
    if (!pickMode && !selectedId && !hireOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (pickMode) props.onPickCancel()
      else if (hireOpen) setHireOpen(false)
      else props.onSelect(undefined)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pickMode, selectedId, hireOpen, props])
  return <div className="town-roster-layer">
    {pickMode && selected ? <div className="town-pick-banner" role="status">Choose a house for <b>{selected.name}</b> · click a building · <button type="button" onClick={props.onPickCancel}>Cancel (Esc)</button></div> : null}
    {selected && !pickMode ? <AssignCard key={selected.id} status={selected} {...props}/> : null}
    <nav className="town-roster" aria-label="Artisan roster">
      <ol>
        {statuses.map(status => {
          const look = artisanLook(status.persona, status.craft)
          return <li key={status.id}>
            <button
              type="button"
              className={`town-roster-portrait${status.id === selectedId ? ' is-selected' : ''}`}
              data-lamp={status.lamp}
              data-needs-you={status.needsYou ? 'true' : 'false'}
              data-ghost={status.ghost ? 'true' : 'false'}
              draggable
              onDragStart={event => { event.dataTransfer.setData(ARTISAN_DRAG_TYPE, status.id); event.dataTransfer.effectAllowed = 'link'; props.onSelect(status.id) }}
              onClick={() => { props.onSelect(status.id === selectedId ? undefined : status.id); if (status.id !== selectedId) props.onFocusArtisan(status.id) }}
              aria-pressed={status.id === selectedId}
              aria-label={`${status.name}, ${status.craft ? CRAFT_LABEL[status.craft] : 'artisan'}: ${status.detail}`}
              title={`${status.name} · ${status.detail}`}
            >
              <span className="town-roster-face" style={{ background: look ? hex(look.robe) : undefined, color: look && [0xe9e1cc, 0xebe6dc, 0xe0b43a].includes(look.robe) ? '#3a2a1a' : '#fff8ea' }}><CraftEmblem craft={status.craft}/></span>
              <span className="town-roster-name">{status.name.split(' ')[0]}</span>
              <span className="town-roster-state">{status.label}{status.queuedCount ? ` +${status.queuedCount}` : ''}</span>
            </button>
          </li>
        })}
        <li className="town-roster-hire">
          <button type="button" className="town-roster-portrait town-roster-add" aria-expanded={hireOpen} aria-label="Hire an apprentice builder" onClick={() => setHireOpen(value => !value)} disabled={!apprentices.length}>
            <span className="town-roster-face">+</span><span className="town-roster-name">Hire</span><span className="town-roster-state">{apprentices.length ? `${apprentices.length} apprentices` : 'Guild full'}</span>
          </button>
          {hireOpen ? <div className="town-hire-menu" role="menu">
            <p>Apprentices of Vishwakarma join the guild as persistent builders.</p>
            {apprentices.map(look => <button type="button" role="menuitem" key={look.key} disabled={props.busy} onClick={() => { props.onHire(look.key); setHireOpen(false) }}><b>{look.name}</b><small>{look.epithet}</small></button>)}
          </div> : null}
        </li>
      </ol>
    </nav>
  </div>
}

function AssignCard(props: RosterProps & { status: ArtisanStatus }) {
  const { status } = props
  const look = artisanLook(status.persona, status.craft)
  const planner = status.craft === 'planner'
  const [search, setSearch] = useState('')
  const [prompt, setPrompt] = useState('')
  const [mayChange, setMayChange] = useState(() => !READ_ONLY_CRAFTS.has(status.craft ?? 'builder'))
  const project = props.projects.find(item => item.id === props.pickedProjectId)
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase()
    return props.projects.filter(item => !query || `${item.display.name} ${item.path}`.toLowerCase().includes(query)).slice(0, 6)
  }, [props.projects, search])
  const taskProject = status.task ? props.projects.find(item => item.id === status.task!.project_id) : undefined
  const send = async () => {
    if (!project || !prompt.trim()) return
    const ok = await props.onAssign({ agentId: status.id, projectId: project.id, prompt: prompt.trim(), workspaceMode: planner || !mayChange ? 'read_only' : 'shared_checkout' })
    // Close the card so the walk from the Guild Hall is visible.
    if (ok) { setPrompt(''); props.onSelect(undefined) }
  }
  return <section className="town-assign-card" aria-label={`Assign work to ${status.name}`} data-lamp={status.lamp}>
    <header>
      <span className="town-roster-face" style={{ background: look ? hex(look.robe) : undefined }}><CraftEmblem craft={status.craft}/></span>
      <div><h2>{status.name}</h2><p>{status.craft ? CRAFT_LABEL[status.craft] : 'Artisan'}{look ? ` · ${look.epithet}` : ''}</p></div>
      <button type="button" className="town-assign-close" aria-label="Close assignment card" onClick={() => props.onSelect(undefined)}>×</button>
    </header>
    <p className="town-assign-status" data-lamp={status.lamp}><i aria-hidden="true"/>{status.detail}{status.queuedCount ? ` · ${status.queuedCount} more order${status.queuedCount === 1 ? '' : 's'} waiting` : ''}</p>
    {status.task && taskProject ? <button type="button" className="town-link-project" onClick={() => props.onFocusProject(taskProject.id)}>{taskProject.display.name} office ↗</button> : null}
    <div className="town-assign-form">
      <span className="town-panel-kicker">NEW WORK ORDER</span>
      <div className="town-assign-project">
        {project ? <div className="town-assign-chosen"><b>{project.display.name}</b><small>{project.path}</small><button type="button" onClick={() => props.onProjectChange(undefined)}>Change</button></div> : <>
          <div className="town-assign-search">
            <label><span className="town-sr-only">Search projects</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search a project…"/></label>
            <button type="button" onClick={props.onPickStart}>Pick on map</button>
          </div>
          <div className="town-assign-matches">{matches.map(item => <button type="button" key={item.id} onClick={() => props.onProjectChange(item.id)} title={item.path}>{item.display.name}</button>)}{matches.length ? null : <small>No matching projects</small>}</div>
          <small className="town-muted">Tip: drag a portrait onto a house.</small>
        </>}
      </div>
      <label className="town-assign-prompt"><span>{planner ? 'Charge for the planner' : 'Work order'}</span><textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={20000} placeholder={planner ? 'Describe the goal; Chanakya plans and assigns the artisans…' : `What should ${status.name.split(' ')[0]} do?`}/></label>
      <label className="town-assign-toggle"><input type="checkbox" checked={!planner && mayChange} disabled={planner} onChange={event => setMayChange(event.target.checked)}/><span>May change files{planner ? ' (planner only reads)' : ''}</span></label>
      <button type="button" className="town-assign-send" onClick={() => void send()} disabled={props.busy || !project || !prompt.trim()}>{props.busy ? 'Sending…' : `Send ${status.name.split(' ')[0]}`}</button>
    </div>
  </section>
}
