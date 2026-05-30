'use client'
import { useRef, useState, useEffect, useCallback } from 'react'
import type { ClientMessage, ServerMessage } from '../lib/types.js'

export function useHarnessWS(url: string, onMessage: (m: ServerMessage) => void) {
  const ws = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<'connecting'|'open'|'closed'|'error'>('connecting')
  const backoff = useRef(1000)
  // Keep onMessage stable — store in ref so connect() doesn't need it as a dep
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    setStatus('connecting')
    const sock = new WebSocket(url)
    ws.current = sock
    sock.onopen = () => { setStatus('open'); backoff.current = 1000 }
    sock.onmessage = e => { try { onMessageRef.current(JSON.parse(e.data)) } catch {} }
    sock.onclose = () => {
      // Guard: if ws.current was nulled by cleanup, this socket is stale — don't reconnect
      if (ws.current !== sock) return
      setStatus('closed')
      const delay = backoff.current
      backoff.current = Math.min(backoff.current * 2, 30000)
      setTimeout(connect, delay)
    }
    sock.onerror = () => setStatus('error')
  }, [url]) // onMessage excluded — accessed via ref

  useEffect(() => {
    connect()
    return () => {
      // Null first so onclose guard bails before scheduling reconnect
      const sock = ws.current
      ws.current = null
      sock?.close()
    }
  }, [connect])

  const send = useCallback((msg: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg))
  }, [])

  return { send, status, reconnect: connect }
}
