'use client'
import { useRef, useState, useEffect, useCallback } from 'react'
import type { ClientMessage, ServerMessage } from '../lib/types'

interface Options {
  yolo?: boolean
}

export function useHarnessWS(url: string, onMessage: (m: ServerMessage) => void, opts: Options = {}) {
  const ws = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<'connecting'|'open'|'closed'|'error'>('connecting')
  const backoff = useRef(1000)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const optsRef = useRef(opts)
  optsRef.current = opts

  const connect = useCallback(() => {
    setStatus('connecting')
    const sock = new WebSocket(url)
    ws.current = sock
    sock.onopen = () => {
      setStatus('open')
      backoff.current = 1000
      sock.send(JSON.stringify({
        type: 'hello',
        user_id: 'web-user',
        wasm_supported: true,
        yolo: optsRef.current.yolo ?? false,
      }))
    }
    sock.onmessage = e => { try { onMessageRef.current(JSON.parse(e.data)) } catch {} }
    sock.onclose = () => {
      if (ws.current !== sock) return
      setStatus('closed')
      const delay = backoff.current
      backoff.current = Math.min(backoff.current * 2, 30000)
      setTimeout(connect, delay)
    }
    sock.onerror = () => setStatus('error')
  }, [url])

  // Reconnect when yolo changes so a new hello is sent with the updated flag
  useEffect(() => {
    const sock = ws.current
    ws.current = null
    sock?.close()
    connect()
    return () => {
      const s = ws.current
      ws.current = null
      s?.close()
    }
  }, [connect, opts.yolo])

  const send = useCallback((msg: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg))
  }, [])

  return { send, status, reconnect: connect }
}
