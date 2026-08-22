'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { SurfaceRenderResult, SurfaceSpec } from '../lib/protocol'
import { acceptFrameMessage } from './bridge'
import { buildFrameDocument, MAX_SURFACE_BYTES } from './frame'

interface Props { surface: SurfaceSpec; onResult: (result: SurfaceRenderResult) => void; onLog?: (message: string) => void; onEmit?: (name: string, payload: unknown) => void; allowedPackages?: string[] }

export function buildSurfacePythonRequest(data: unknown, allowedPackages: string[] = []): { data: Record<string, unknown>; allowedPackages: string[] } {
  return {
    data: typeof data === 'object' && data ? data as Record<string, unknown> : {},
    allowedPackages: [...new Set(allowedPackages.filter(item => typeof item === 'string' && item.trim()))]
  }
}

export function SurfaceHost({ surface, onResult, onLog, onEmit, allowedPackages = [] }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const initialized = useRef(false)
  const [error, setError] = useState<string>()
  const [mounted, setMounted] = useState(true)
  const python = useRef<Worker | null>(null)
  const onResultRef = useRef(onResult)
  const onLogRef = useRef(onLog)
  const onEmitRef = useRef(onEmit)
  onResultRef.current = onResult
  onLogRef.current = onLog
  onEmitRef.current = onEmit
  const documentText = useMemo(() => buildFrameDocument(surface), [surface])
  const tooLarge = new TextEncoder().encode(documentText).byteLength > MAX_SURFACE_BYTES

  useEffect(() => {
    try {
      python.current = new Worker(new URL('../components/data/python.worker.ts', import.meta.url), { type: 'module' })
    } catch { python.current = null }
    const worker = python.current
    worker?.addEventListener('message', event => {
      const result = event.data as { id?: string }
      if (!result.id || !frame.current?.contentWindow) return
      frame.current.contentWindow.postMessage({ ...event.data, type: 'surface_py_result', id: surface.id, request_id: result.id }, '*')
    })
    const cleanupWorker = () => { worker?.terminate(); if (python.current === worker) python.current = null }
    setMounted(true)
    if (tooLarge) { setError('surface payload exceeds 512 KB'); setMounted(false); onResultRef.current({ id: surface.id, ok: false, errors: ['surface payload exceeds 512 KB'], duration_ms: 0, bytes: new TextEncoder().encode(documentText).byteLength }); return cleanupWorker }
    const started = performance.now()
    if (surface.mode === 'patch' && initialized.current && frame.current?.contentWindow) {
      frame.current.contentWindow.postMessage({ type: 'surface_patch', id: surface.id, surface }, '*')
      onResultRef.current({ id: surface.id, ok: true, errors: [], duration_ms: Math.round(performance.now() - started), bytes: new TextEncoder().encode(documentText).byteLength })
      return cleanupWorker
    }
    const timeout = window.setTimeout(() => { setError('render timeout'); setMounted(false); onResult({ id: surface.id, ok: false, errors: ['render timeout'], duration_ms: 10000, bytes: new TextEncoder().encode(documentText).byteLength }) }, 10000)
    const onWindowMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      acceptFrameMessage(event, data => {
        if (data.type === 'emit') {
          const name = typeof data.name === 'string' ? data.name.trim() : ''
          if (name && name.length <= 100) onEmitRef.current?.(name, data.payload)
          return
        }
        if (data.type === 'surface_py_run') {
          const requestId = typeof data.request_id === 'string' ? data.request_id : ''
          const code = typeof data.code === 'string' ? data.code : ''
          if (!requestId || !code || !python.current) {
            frame.current?.contentWindow?.postMessage({ type: 'surface_py_result', id: surface.id, request_id: requestId, exit_code: 1, stderr: 'python worker unavailable' }, '*')
            return
          }
          python.current.postMessage({ id: requestId, code, ...buildSurfacePythonRequest(data.data, allowedPackages) })
          return
        }
        if (data.type !== 'ui_result' || data.id !== surface.id) return
        window.clearTimeout(timeout); setError(undefined)
        onResultRef.current({ id: surface.id, ok: data.ok === true, errors: Array.isArray(data.errors) ? data.errors.filter((item): item is string => typeof item === 'string') : [], stdout: typeof data.stdout === 'string' ? data.stdout : undefined, duration_ms: typeof data.duration_ms === 'number' ? data.duration_ms : Math.round(performance.now() - started), bytes: typeof data.bytes === 'number' ? data.bytes : documentText.length })
      }, message => onLogRef.current?.(message))
    }
    window.addEventListener('message', onWindowMessage)
    return () => { window.clearTimeout(timeout); window.removeEventListener('message', onWindowMessage); cleanupWorker() }
  }, [allowedPackages, documentText, surface.id, tooLarge])

  return <div className="surface-host">{error ? <div role="alert">{error}</div> : null}{mounted ? <iframe ref={frame} title={surface.title ?? 'Generated surface'} sandbox="allow-scripts" srcDoc={documentText} onLoad={() => { initialized.current = true; frame.current?.contentWindow?.postMessage({ type: 'surface_init', id: surface.id }, '*') }} style={{ width: '100%', minHeight: 320, border: 0 }} /> : null}</div>
}
