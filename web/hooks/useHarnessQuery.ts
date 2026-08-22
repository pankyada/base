'use client'
import { useCallback, useEffect, useState } from 'react'
import type { UIMessage } from '../lib/types'

export function normalizeTranscript(rows: unknown[]): UIMessage[] {
  return rows.map((row, index) => {
    const item = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
    const role = item.role === 'user' ? 'user' : item.role === 'tool-call' || item.role === 'tool-prompt' ? item.role : 'agent'
    return { id: typeof item.id === 'string' ? item.id : `history-${index}`, role, content: typeof item.content === 'string' ? item.content : undefined, name: typeof item.name === 'string' ? item.name : undefined, result: typeof item.result === 'string' ? item.result : undefined }
  })
}

interface TranscriptResponse { messages?: unknown[]; before?: string }
export function transcriptUrl(baseUrl: string, sessionId: string, before?: string): string { const query = before ? `?before=${encodeURIComponent(before)}` : ''; return `${baseUrl.replace(/\/$/, '')}/sessions/${encodeURIComponent(sessionId)}/messages${query}` }

export function useHarnessQuery(baseUrl: string, sessionId: string, onMessages: (messages: UIMessage[], prepend: boolean) => void) {
  const [before, setBefore] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const request = useCallback(async (cursor?: string) => {
    if (!sessionId || sessionId === '…') return
    setLoading(true); setError(undefined)
    try {
      const response = await fetch(transcriptUrl(baseUrl, sessionId, cursor))
      if (!response.ok) throw new Error(`transcript request failed (${response.status})`)
      const body = await response.json() as TranscriptResponse
      onMessages(normalizeTranscript(body.messages ?? []), Boolean(cursor))
      setBefore(body.before)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'transcript request failed')
    } finally { setLoading(false) }
  }, [baseUrl, onMessages, sessionId])
  useEffect(() => { setBefore(undefined); void request() }, [request])
  return { loading, error, hasEarlier: Boolean(before), loadEarlier: () => before ? request(before) : undefined }
}
