'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIMessage } from '../lib/types'
import { buildScopedUrl, isStaleScope, type RequestScope } from '../lib/scopedRequest'

export function normalizeTranscript(rows: unknown[]): UIMessage[] {
  return rows.map((row, index) => {
    const item = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
    const role = item.role === 'user' ? 'user' : item.role === 'tool-call' || item.role === 'tool-prompt' ? item.role : 'agent'
    return { id: typeof item.id === 'string' ? item.id : `history-${index}`, role, content: typeof item.content === 'string' ? item.content : undefined, name: typeof item.name === 'string' ? item.name : undefined, result: typeof item.result === 'string' ? item.result : undefined }
  })
}

interface TranscriptResponse { messages?: unknown[]; before?: string }
export function transcriptUrl(baseUrl: string, sessionId: string, scope: RequestScope = {}, before?: string): string {
  return buildScopedUrl(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/messages`, scope, { before })
}

export function useHarnessQuery(baseUrl: string, sessionId: string, onMessages: (messages: UIMessage[], prepend: boolean) => void, scope: RequestScope = {}) {
  const [before, setBefore] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  // Tracks the scope in effect right now so an in-flight response tagged with a superseded scope (identity/profile switched mid-request) can be discarded on arrival.
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const request = useCallback(async (cursor?: string) => {
    if (!sessionId || sessionId === '…') return
    const requestedScope = scopeRef.current
    setLoading(true); setError(undefined)
    try {
      const response = await fetch(transcriptUrl(baseUrl, sessionId, requestedScope, cursor))
      if (isStaleScope(requestedScope, scopeRef.current)) return
      if (!response.ok) throw new Error(`transcript request failed (${response.status})`)
      const body = await response.json() as TranscriptResponse
      onMessages(normalizeTranscript(body.messages ?? []), Boolean(cursor))
      setBefore(body.before)
    } catch (cause) {
      if (isStaleScope(requestedScope, scopeRef.current)) return
      setError(cause instanceof Error ? cause.message : 'transcript request failed')
    } finally {
      if (!isStaleScope(requestedScope, scopeRef.current)) setLoading(false)
    }
  }, [baseUrl, onMessages, sessionId])
  // Scope change (identity or profile) clears the transcript cursor and re-fetches from scratch — the caller's onMessages(prepend=false) replaces stale content.
  useEffect(() => { setBefore(undefined); void request() }, [request, scope.userId, scope.profile])
  return { loading, error, hasEarlier: Boolean(before), loadEarlier: () => before ? request(before) : undefined }
}
