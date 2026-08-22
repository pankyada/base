import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FRAME_CSP, MAX_SURFACE_BYTES, buildFrameDocument } from '../surface/frame'
import { acceptFrameMessage } from '../surface/bridge'
import { SurfaceHost, buildSurfacePythonRequest } from '../surface/SurfaceHost'
import { mergeSurface } from '../lib/reducer'
import escapeCorpus from '../surface/escape-corpus.json'

describe('surface isolation', () => {
  it('uses opaque-origin sandbox and restrictive CSP', () => {
    const document = buildFrameDocument({ id: 's1', mode: 'replace', html: '<p>ok</p>' })
    expect(FRAME_CSP).toContain("default-src 'none'")
    expect(document).toContain(FRAME_CSP)
    expect(MAX_SURFACE_BYTES).toBe(512 * 1024)
    expect(document).not.toContain('allow-same-origin')
    expect(document).toContain("type:'ui_result'")
    expect(document).toContain("window.state=window.__SURFACE_STATE__")
    expect(document).toContain("type:'emit'")
    expect(escapeCorpus).toHaveLength(6)
  })

  it('keeps the surface iframe sandbox exactly at allow-scripts', () => {
    const markup = renderToStaticMarkup(
      createElement(SurfaceHost, {
        surface: { id: 's1', mode: 'replace', html: '<p>ok</p>' },
        onResult: () => undefined,
      }),
    )
    expect(markup).toContain('sandbox="allow-scripts"')
    expect(markup).not.toMatch(/sandbox="[^"]*\ballow-same-origin\b/)
    expect(markup.match(/sandbox="([^"]*)"/)?.[1]).toBe('allow-scripts')
  })

  it('keeps a permanent six-entry browser escape corpus fixture', () => {
    expect(escapeCorpus).toEqual([
      'window.parent.document.body',
      'top.location.href',
      'document.cookie',
      "localStorage.setItem('x','y')",
      "fetch('http://localhost:7337/health')",
      'document.forms[0].submit()'
    ])
  })

  it('passes profile allowlisted packages to surface Python and removes duplicates', () => {
    expect(buildSurfacePythonRequest({ value: 1 }, ['numpy', 'numpy', ' pandas '])).toEqual({ data: { value: 1 }, allowedPackages: ['numpy', ' pandas '] })
    expect(buildSurfacePythonRequest(null, [])).toEqual({ data: {}, allowedPackages: [] })
  })

  it('only forwards allowlisted frame messages and never evaluates payloads', () => {
    const onMessage = vi.fn()
    expect(acceptFrameMessage({ data: { type: 'ui_result', id: 's1', ok: true } }, onMessage)).toBe(true)
    expect(acceptFrameMessage({ data: { type: 'surface_py_run', id: 's1', request_id: 'p1', code: '1+1' } }, onMessage)).toBe(true)
    expect(acceptFrameMessage({ data: { type: 'emit', id: 's1', name: 'select', payload: { value: 1 } } }, onMessage)).toBe(true)
    expect(acceptFrameMessage({ data: { type: 'eval', code: 'alert(1)' } }, onMessage)).toBe(false)
    expect(onMessage).toHaveBeenCalledTimes(3)
  })

  it('patches an existing surface and replaces only when requested', () => {
    const first = { id: 's1', mode: 'replace' as const, html: '<p>one</p>', css: 'a{}' }
    const patched = mergeSurface([{ surface: first }], { id: 's1', mode: 'patch', html: '<p>two</p>' })
    expect(patched[0].surface.css).toBe('a{}')
    const replaced = mergeSurface(patched, { id: 's1', mode: 'replace', html: '<p>three</p>' })
    expect(replaced[0].surface.css).toBeUndefined()
  })
})
