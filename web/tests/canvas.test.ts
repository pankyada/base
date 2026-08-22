import { describe, expect, it } from 'vitest'
import { pinArtifact, reorderArtifacts, refreshArtifact, clampWidth, loadCanvas, saveCanvas } from '../lib/canvas'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { Canvas } from '../components/data/Canvas'

describe('canvas', () => {
  it('stores provenance, persists order, and keeps last good refresh', () => {
    const pinned = pinArtifact([], { id: 'a', kind: 'metrics', data: 1 }, { session: 's', toolCall: 't', code: 'x' })
    expect(pinned[0].provenance.session).toBe('s')
    expect(reorderArtifacts(pinned, 0, 0)).toEqual(pinned)
    expect(refreshArtifact(pinned[0], { id: 'a', kind: 'metrics', data: 2 }, false).stale).toBe(true)
    expect(refreshArtifact(pinned[0], { id: 'a', kind: 'metrics', data: 2 }, true).artifact.data).toBe(2)
    expect(clampWidth(20)).toBe(160)
  })

  it('renders pinned widget artifacts through the widget kit and degrades missing kind', () => {
    const artifact = { id: 'bar-1', kind: 'bar' as const, title: 'Revenue', data: { x: { key: 'month', type: 'category' as const }, series: [{ key: 'value' }], rows: [{ month: 'Jan', value: 2 }] } }
    const markup = renderToStaticMarkup(React.createElement(Canvas, { initial: [{ artifact, provenance: { session: 's', toolCall: 't' } }] }))
    expect(markup).toContain('class="plot"')
    const fallback = renderToStaticMarkup(React.createElement(Canvas, { initial: [{ artifact: { id: 'raw', data: { ok: true } } as any, provenance: { session: 's', toolCall: 't' } }] }))
    expect(fallback).toContain('<pre>')
  })

  it('persists per project and truncates oversized pins safely', () => {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } } })
    const item = { artifact: { id: 'a', kind: 'doc' as const, data: 'small' }, provenance: { session: 's', toolCall: 't' } }
    saveCanvas('project-a', [item])
    expect(loadCanvas('project-a')).toEqual([item])
    expect(loadCanvas('project-b')).toEqual([])
    const huge = { ...item, artifact: { ...item.artifact, data: 'x'.repeat(600_000) } }
    saveCanvas('project-a', [huge])
    const saved = loadCanvas('project-a')
    expect(JSON.stringify(saved)).toContain('truncated')
    expect(JSON.stringify(saved)).not.toContain('x'.repeat(10_000))
  })
})
