'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIMessage } from '../lib/types'
import { buildScopedUrl, isStaleScope, type RequestScope } from '../lib/scopedRequest'
import { fetchRemote } from '../lib/remoteData'

export function transcriptRequestIsCurrent(requestedSessionId: string, currentSessionId: string, requestedScope: RequestScope, currentScope: RequestScope): boolean {
  return requestedSessionId === currentSessionId && !isStaleScope(requestedScope, currentScope)
}

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
  const [retryToken, setRetryToken] = useState(0)
  // Tracks the scope in effect right now so an in-flight response tagged with a superseded scope (identity/profile switched mid-request) can be discarded on arrival.
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const request = useCallback(async (cursor?: string) => {
    if (!sessionId || sessionId === '…') return
    const requestedScope = scopeRef.current
    const requestedSessionId = sessionId
    setLoading(true); setError(undefined)
    // fetchRemote turns both a network failure and a non-ok status into `failed` — no silent fallback
    // to an empty transcript when the read never actually succeeded.
    const result = await fetchRemote<TranscriptResponse>(transcriptUrl(baseUrl, sessionId, requestedScope, cursor), body => (body.messages ?? []).length === 0)
    if (!transcriptRequestIsCurrent(requestedSessionId, sessionIdRef.current, requestedScope, scopeRef.current)) return
    if (result.status === 'failed') {
      setError(result.reason)
    } else {
      const body = result.status === 'ready' ? result.data : {}
      onMessages(normalizeTranscript(body.messages ?? []), Boolean(cursor))
      setBefore(body.before)
    }
    setLoading(false)
  }, [baseUrl, onMessages, sessionId, retryToken])
  // Scope change (identity or profile) clears the transcript cursor and re-fetches from scratch — the caller's onMessages(prepend=false) replaces stale content.
  useEffect(() => { setBefore(undefined); setError(undefined); void request() }, [request, scope.userId, scope.profile])
  return { loading, error, retry: () => setRetryToken(token => token + 1), hasEarlier: Boolean(before), loadEarlier: () => before ? request(before) : undefined }
}
