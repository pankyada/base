'use client'
import React, { useEffect, useRef, useState } from 'react'
import type { CanvasArtifact, PinnedArtifact, Provenance } from '../../lib/canvas'
import { clampWidth, loadCanvas, pinArtifact, refreshArtifact, reorderArtifacts, saveCanvas } from '../../lib/canvas'
import { GenWidget } from '../../widgets/GenWidget'
import { artifactExportMetadata, downloadPdf, downloadPng, downloadSvg } from '../../lib/export'

interface CanvasProps {
  initial?: PinnedArtifact[]
  available?: PinnedArtifact[]
  projectId?: string
  onRefresh?: (artifact: CanvasArtifact) => Promise<CanvasArtifact>
  onPromote?: (artifact: CanvasArtifact, provenance: Provenance) => Promise<CanvasArtifact>
}

function provenanceText(provenance?: Provenance): string {
  if (!provenance?.session || !provenance.toolCall) return 'source lineage unavailable'
  return `session ${provenance.session} · tool call ${provenance.toolCall}${provenance.code ? ` · code ${provenance.code}` : ''}`
}

export function Canvas({ initial = [], available = initial, projectId = 'inbox', onRefresh, onPromote }: CanvasProps) {
  const [items, setItems] = useState(initial)
  const [width, setWidth] = useState(320)
  const [promoted, setPromoted] = useState<Record<string, boolean>>({})
  const articleRefs = useRef<Array<HTMLElement | null>>([])
  const skipSave = useRef(true)

  useEffect(() => {
    skipSave.current = true
    const saved = loadCanvas(projectId)
    setItems(saved)
    const savedWidth = globalThis.localStorage?.getItem(`harness-canvas-width:${projectId}`)
    if (savedWidth) setWidth(clampWidth(Number(savedWidth)))
  }, [projectId])

  useEffect(() => {
    if (skipSave.current) { skipSave.current = false; return }
    const safe = saveCanvas(projectId, items)
    if (JSON.stringify(safe) !== JSON.stringify(items)) setItems(safe)
  }, [items, projectId])

  const refresh = async (index: number) => {
    const current = items[index]
    if (!current || !onRefresh || !current.artifact.recipeId) return
    try {
      const artifact = await onRefresh(current.artifact)
      setItems(value => value.map((entry, itemIndex) => itemIndex === index ? refreshArtifact(entry, artifact, true) : entry))
    } catch (cause) {
      setItems(value => value.map((entry, itemIndex) => itemIndex === index ? refreshArtifact(entry, entry.artifact, false, cause instanceof Error ? cause.message : String(cause)) : entry))
    }
  }

  const promote = async (candidate: PinnedArtifact) => {
    if (!onPromote || !candidate.provenance.session || !candidate.provenance.toolCall || !candidate.artifact.generatingTool) return
    try {
      const artifact = await onPromote(candidate.artifact, candidate.provenance)
      setPromoted(value => ({ ...value, [candidate.artifact.id]: true }))
      if (artifact.recipeId) setItems(value => value.map(item => item.artifact.id === artifact.id ? { ...item, artifact } : item))
    } catch {
      setPromoted(value => ({ ...value, [candidate.artifact.id]: false }))
    }
  }

  return (
    <section className="canvas" aria-label="Canvas" style={{ width }}>
      <label>panel width <input type="range" min={160} max={960} value={width} onChange={event => { const next = clampWidth(Number(event.target.value)); setWidth(next); globalThis.localStorage?.setItem(`harness-canvas-width:${projectId}`, String(next)) }} /></label>
      {items.length === 0 ? <p>No pinned artifacts yet.</p> : items.map((item, index) => {
        const data = item.artifact.data
        const truncated = Boolean(data && typeof data === 'object' && (data as Record<string, unknown>).__truncated)
        return <article key={item.artifact.id} ref={element => { articleRefs.current[index] = element }}>
          <header>{item.artifact.title ?? item.artifact.id}{item.stale || item.artifact.freshness === 'stale' ? <small role="status"> stale{item.staleReason ? `: ${item.staleReason}` : ''}</small> : null}</header>
          <small className="canvas-lineage">{provenanceText(item.provenance)}</small>
          {item.artifact.kind && !truncated ? <GenWidget artifact={{ id: item.artifact.id, kind: item.artifact.kind, title: item.artifact.title ?? item.artifact.id, icon: '', data }} /> : truncated ? <p>refresh to reload full data</p> : <pre>{JSON.stringify(data, null, 2)}</pre>}
          <button onClick={() => setItems(current => reorderArtifacts(current, index, Math.max(0, index - 1)))}>↑</button>
          {onRefresh && item.artifact.recipeId ? <button onClick={() => void refresh(index)}>refresh</button> : null}
          <button onClick={() => { const root = articleRefs.current[index]; if (root) downloadSvg(root, item.artifact.title ?? item.artifact.id, artifactExportMetadata(item)) }} disabled={!articleRefs.current[index]?.querySelector('svg')}>export SVG</button>
          <button onClick={() => { const root = articleRefs.current[index]; if (root) void downloadPng(root, item.artifact.title ?? item.artifact.id, artifactExportMetadata(item)) }} disabled={!articleRefs.current[index]?.querySelector('svg')}>export PNG</button>
          <button onClick={() => { const root = articleRefs.current[index]; if (root) downloadPdf(root, item.artifact.title ?? item.artifact.id, artifactExportMetadata(item)) }}>export PDF</button>
        </article>
      })}
      <aside aria-label="Available artifacts">
        <h3>Available artifacts</h3>
        {available.filter(candidate => !items.some(item => item.artifact.id === candidate.artifact.id)).map(candidate => {
          const canPin = Boolean(candidate.provenance.session && candidate.provenance.toolCall)
          const canPromote = Boolean(onPromote && candidate.provenance.session && candidate.provenance.toolCall && candidate.artifact.generatingTool)
          return <article key={candidate.artifact.id} className="available-artifact">
            <strong>{candidate.artifact.title ?? candidate.artifact.id}</strong>
            <small className="canvas-lineage">{provenanceText(candidate.provenance)}</small>
            <button disabled={!canPin} title={canPin ? undefined : 'Source lineage required'} onClick={() => setItems(current => pinArtifact(current, candidate.artifact, candidate.provenance))}>pin {candidate.artifact.title ?? candidate.artifact.id}</button>
            {onPromote ? <button disabled={!canPromote || promoted[candidate.artifact.id] === true} onClick={() => void promote(candidate)}>{promoted[candidate.artifact.id] ? 'promoted' : 'promote'}</button> : null}
          </article>
        })}
      </aside>
    </section>
  )
}
