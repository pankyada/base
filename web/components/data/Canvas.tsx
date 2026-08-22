'use client'
import React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { CanvasArtifact, PinnedArtifact, Provenance } from '../../lib/canvas'
import { clampWidth, loadCanvas, pinArtifact, refreshArtifact, reorderArtifacts, saveCanvas } from '../../lib/canvas'
import { GenWidget } from '../../widgets/GenWidget'
import { downloadPdf, downloadPng, downloadSvg } from '../../lib/export'
export function Canvas({ initial = [], projectId = 'inbox', onRefresh }: { initial?: PinnedArtifact[]; projectId?: string; onRefresh?: (artifact: CanvasArtifact) => Promise<CanvasArtifact> }) {
  const [items, setItems] = useState(initial)
  const [width, setWidth] = useState(320)
  const articleRefs = useRef<Array<HTMLElement | null>>([])
  const skipSave = useRef(true)
  useEffect(() => { skipSave.current = true; const saved = loadCanvas(projectId); setItems(saved.length ? saved : initial); const savedWidth = globalThis.localStorage?.getItem(`harness-canvas-width:${projectId}`); if (savedWidth) setWidth(clampWidth(Number(savedWidth))) }, [initial, projectId])
  useEffect(() => { if (skipSave.current) { skipSave.current = false; return }; const safe = saveCanvas(projectId, items); if (JSON.stringify(safe) !== JSON.stringify(items)) setItems(safe) }, [items, projectId])
  const add = (artifact: CanvasArtifact, provenance: Provenance) => setItems(current => pinArtifact(current, artifact, provenance))
  const refresh = async (index: number) => { if (!onRefresh) return; const current = items[index]; try { const artifact = await onRefresh(current.artifact); setItems(value => value.map((entry, itemIndex) => itemIndex === index ? refreshArtifact(entry, artifact, true) : entry)) } catch { setItems(value => value.map((entry, itemIndex) => itemIndex === index ? refreshArtifact(entry, entry.artifact, false) : entry)) } }
  return (
    <section className="canvas" aria-label="Canvas" style={{ width }}>
      <label>panel width <input type="range" min={160} max={960} value={width} onChange={event => { const next = clampWidth(Number(event.target.value)); setWidth(next); globalThis.localStorage?.setItem(`harness-canvas-width:${projectId}`, String(next)) }} /></label>
      {items.length === 0 ? <p>No pinned artifacts yet.</p> : items.map((item, index) => {
        const data = item.artifact.data
        const truncated = Boolean(data && typeof data === 'object' && (data as Record<string, unknown>).__truncated)
        return <article key={item.artifact.id} ref={element => { articleRefs.current[index] = element }}>
          <header>{item.artifact.title ?? item.artifact.id}{item.stale ? <small> stale</small> : null}</header>
          {item.artifact.kind && !truncated ? <GenWidget artifact={{ id: item.artifact.id, kind: item.artifact.kind, title: item.artifact.title ?? item.artifact.id, icon: '', data }} /> : truncated ? <p>refresh to reload full data</p> : <pre>{JSON.stringify(data, null, 2)}</pre>}
          <button onClick={() => setItems(current => reorderArtifacts(current, index, Math.max(0, index - 1)))}>↑</button>
          <button onClick={() => void refresh(index)}>refresh</button>
          <button onClick={() => { const root = articleRefs.current[index]; if (root) downloadSvg(root, item.artifact.title ?? item.artifact.id) }} disabled={!articleRefs.current[index]?.querySelector('svg')}>export SVG</button>
          <button onClick={() => { const root = articleRefs.current[index]; if (root) void downloadPng(root, item.artifact.title ?? item.artifact.id) }} disabled={!articleRefs.current[index]?.querySelector('svg')}>export PNG</button>
          <button onClick={() => { const root = articleRefs.current[index]; if (root) downloadPdf(root, item.artifact.title ?? item.artifact.id) }}>export PDF</button>
        </article>
      })}
    </section>
  )
}
