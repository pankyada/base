'use client'
import { useState } from 'react'
import type { SurfaceRenderResult, SurfaceSpec, WorkspaceTab } from '../lib/types'
import type { CanvasArtifact, PinnedArtifact, Provenance } from '../lib/canvas'
import { GenWidget } from '../widgets/GenWidget'
import { SurfaceHost } from '../surface/SurfaceHost'
import { DatasetDrawer } from './data/DatasetDrawer'
import { Canvas } from './data/Canvas'
import { buildScopedUrl } from '../lib/scopedRequest'

interface Props {
  tabs: WorkspaceTab[]
  activeTab: number
  onTabChange: (index: number) => void
  surfaces?: { surface: SurfaceSpec; runId?: string }[]
  onSurfaceResult?: (result: SurfaceRenderResult) => void
  onSurfaceEmit?: (name: string, payload: unknown) => void
  projectId?: string
  datasetBaseUrl?: string
  datasetUser?: string
  onDatasetContext?: (context: string) => void
  allowedPackages?: string[]
  onRefreshArtifact?: (artifact: CanvasArtifact) => Promise<CanvasArtifact>
  onPromoteArtifact?: (artifact: CanvasArtifact, provenance: Provenance) => Promise<CanvasArtifact>
}

function canvasItem(artifact: any): PinnedArtifact {
  const session = typeof artifact.source_session_id === 'string' && artifact.source_session_id ? artifact.source_session_id : undefined
  const toolCall = typeof artifact.source_tool_call_id === 'string' && artifact.source_tool_call_id ? artifact.source_tool_call_id : undefined
  const provenance = session && toolCall ? {
    session,
    toolCall,
    ...(typeof artifact.source_code_id === 'string' && artifact.source_code_id ? { code: artifact.source_code_id } : typeof artifact.code_ref === 'string' && artifact.code_ref ? { code: artifact.code_ref } : {}),
    ...(typeof artifact.source === 'string' && artifact.source ? { source: artifact.source } : {}),
  } : undefined
  return {
    artifact: {
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      data: artifact.data,
      recipeId: typeof artifact.recipe_id === 'string' ? artifact.recipe_id : typeof artifact.source_recipe_id === 'string' ? artifact.source_recipe_id : undefined,
      version: typeof artifact.version === 'number' ? artifact.version : undefined,
      freshness: artifact.freshness,
      sourceCursor: typeof artifact.source_cursor === 'string' ? artifact.source_cursor : undefined,
      generatingTool: typeof artifact.generating_tool === 'string' ? artifact.generating_tool : typeof artifact.source_tool_name === 'string' ? artifact.source_tool_name : undefined,
    },
    provenance: provenance ?? { session: '', toolCall: '' },
  }
}

export function Workspace({ tabs, activeTab, surfaces = [], onTabChange, onSurfaceResult, onSurfaceEmit, projectId = 'inbox', datasetBaseUrl, datasetUser, onDatasetContext, allowedPackages = [], onRefreshArtifact, onPromoteArtifact }: Props) {
  const tab = tabs[activeTab]
  const [view, setView] = useState<'artifacts' | 'surfaces' | 'canvas'>('artifacts')
  const [datasetOpen, setDatasetOpen] = useState(true)
  const scopedUrl = (path: string) => buildScopedUrl(datasetBaseUrl ?? '', path, { userId: datasetUser })
  const refreshArtifact = onRefreshArtifact ?? (datasetBaseUrl ? async (artifact: CanvasArtifact): Promise<CanvasArtifact> => {
    if (!artifact.recipeId) throw new Error('artifact has no persisted recipe')
    const response = await fetch(scopedUrl(`/artifacts/${encodeURIComponent(artifact.recipeId)}/refresh`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) })
    if (!response.ok) throw new Error('artifact refresh failed')
    const body = await response.json() as { recipe?: { id: string; revision: number; freshness: CanvasArtifact['freshness']; last_good?: { payload?: unknown; source_cursor?: string; version?: number } } }
    if (!body.recipe?.last_good) throw new Error('artifact refresh returned no last-good version')
    return { ...artifact, recipeId: body.recipe.id, version: body.recipe.last_good.version, freshness: body.recipe.freshness, sourceCursor: body.recipe.last_good.source_cursor, data: body.recipe.last_good.payload }
  } : undefined)
  const promoteArtifact = onPromoteArtifact ?? (datasetBaseUrl ? async (artifact: CanvasArtifact, provenance: Provenance): Promise<CanvasArtifact> => {
    if (!artifact.generatingTool) throw new Error('artifact has no generating tool lineage')
    const response = await fetch(scopedUrl('/artifacts'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ generating_tool: artifact.generatingTool, payload: artifact.data, session_id: provenance.session, tool_call_id: provenance.toolCall, code_ref: provenance.code, source: provenance.source }) })
    if (!response.ok) throw new Error('artifact promotion failed')
    const body = await response.json() as { recipe?: { id: string; freshness: CanvasArtifact['freshness']; last_good?: { payload?: unknown; version?: number; source_cursor?: string } } }
    if (!body.recipe) throw new Error('artifact promotion returned no recipe')
    return { ...artifact, recipeId: body.recipe.id, freshness: body.recipe.freshness, version: body.recipe.last_good?.version, sourceCursor: body.recipe.last_good?.source_cursor, data: body.recipe.last_good?.payload ?? artifact.data }
  } : undefined)
  const canvasArtifacts = tabs.flatMap(tab => tab.artifacts.map(canvasItem))

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
        {view === 'artifacts' && datasetBaseUrl ? <><button onClick={() => setDatasetOpen(open => !open)}>{datasetOpen ? 'hide datasets' : 'show datasets'}</button>{datasetOpen ? <DatasetDrawer baseUrl={datasetBaseUrl} userId={datasetUser} onContext={onDatasetContext ?? (() => undefined)} /> : null}</> : null}
        {view === 'surfaces' && surfaces.map(item => <SurfaceHost key={item.surface.id} surface={item.surface} allowedPackages={allowedPackages} onResult={result => onSurfaceResult?.(result)} onEmit={onSurfaceEmit} />)}
        {view === 'canvas' ? <Canvas projectId={projectId} onRefresh={refreshArtifact} onPromote={promoteArtifact} initial={[]} available={canvasArtifacts} /> : null}
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
