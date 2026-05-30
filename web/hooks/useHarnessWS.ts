'use client'
import { useRef, useState, useEffect, useCallback } from 'react'
import type { ClientMessage, ServerMessage } from '../lib/types.js'

export function useHarnessWS(url: string, onMessage: (m: ServerMessage) => void) {
  const ws = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<'connecting'|'open'|'closed'|'error'>('connecting')
  const backoff = useRef(1000)

  const connect = useCallback(() => {
    setStatus('connecting')
    const sock = new WebSocket(url)
    ws.current = sock
    sock.onopen = () => { setStatus('open'); backoff.current = 1000 }
    sock.onmessage = e => { try { onMessage(JSON.parse(e.data)) } catch {} }
    sock.onclose = () => {
      setStatus('closed')
      setTimeout(connect, backoff.current)
      backoff.current = Math.min(backoff.current * 2, 30000)
    }
    sock.onerror = () => setStatus('error')
  }, [url, onMessage])

  useEffect(() => { connect(); return () => ws.current?.close() }, [connect])

  const send = useCallback((msg: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg))
  }, [])

  return { send, status, reconnect: connect }
}
