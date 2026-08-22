'use client'
import { useState } from 'react'
import type { SurfaceRenderResult, SurfaceSpec, WorkspaceTab } from '../lib/types'
import { GenWidget } from '../widgets/GenWidget'
import { SurfaceHost } from '../surface/SurfaceHost'
import { DatasetDrawer } from './data/DatasetDrawer'
import { Canvas } from './data/Canvas'

interface Props {
  tabs: WorkspaceTab[]
  activeTab: number
  onTabChange: (index: number) => void
  surfaces?: { surface: SurfaceSpec; runId?: string }[]
  onSurfaceResult?: (result: SurfaceRenderResult) => void
  onSurfaceEmit?: (name: string, payload: unknown) => void
  projectId?: string
  datasetBaseUrl?: string
  onDatasetContext?: (context: string) => void
  allowedPackages?: string[]
}

export function Workspace({ tabs, activeTab, onTabChange, surfaces = [], onSurfaceResult, onSurfaceEmit, projectId = 'inbox', datasetBaseUrl, onDatasetContext, allowedPackages = [] }: Props) {
  const tab = tabs[activeTab]
  const [view, setView] = useState<'artifacts' | 'surfaces' | 'canvas'>('artifacts')
  const [datasetOpen, setDatasetOpen] = useState(true)

  return (
    <div className="pane">
      <div className="wtabs" style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {(['artifacts', 'surfaces', 'canvas'] as const).map(item => <button key={item} onClick={() => setView(item)} style={{ padding: '0.5rem 1rem', color: view === item ? 'var(--accent)' : 'var(--dim)', border: 0, borderBottom: view === item ? '2px solid var(--accent)' : 'none', background: 'transparent', cursor: 'pointer' }}>{item}</button>)}
        {view === 'artifacts' && tabs.map((t, i) => (
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
        {view === 'artifacts' && datasetBaseUrl ? <><button onClick={() => setDatasetOpen(open => !open)}>{datasetOpen ? 'hide datasets' : 'show datasets'}</button>{datasetOpen ? <DatasetDrawer baseUrl={datasetBaseUrl} onContext={onDatasetContext ?? (() => undefined)} /> : null}</> : null}
        {view === 'surfaces' && surfaces.map(item => <SurfaceHost key={item.surface.id} surface={item.surface} allowedPackages={allowedPackages} onResult={result => onSurfaceResult?.(result)} onEmit={onSurfaceEmit} />)}
        {view === 'canvas' ? <Canvas projectId={projectId} initial={tabs.flatMap(tab => tab.artifacts.map(artifact => ({ artifact: { id: artifact.id, kind: artifact.kind, title: artifact.title, data: artifact.data }, provenance: { session: 'current', toolCall: 'artifact' } })))} /> : null}
        {view === 'artifacts' && tab && tab.artifacts.map((a, i) => (
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
