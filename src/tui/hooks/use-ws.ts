import { useState, useEffect, useCallback, useRef } from 'react'
import WebSocket from 'ws'
import type { ClientMessage, ServerMessage } from '../../types.js'

const HARNESS_PORT = process.env.HARNESS_PORT ?? '7337'

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    return JSON.parse(raw) as ServerMessage
  } catch {
    return null
  }
}

export interface UseWsResult {
  connected: boolean
  send: (msg: ClientMessage) => void
}

/**
 * Manages WebSocket lifecycle. Calls onMessage synchronously for every
 * incoming message — no intermediate state, so no tokens are dropped
 * when streaming arrives faster than React can re-render.
 */
export function useWs(onMessage: (msg: ServerMessage) => void): UseWsResult {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep a stable ref to the latest onMessage so the WS handler never becomes stale
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    const ws = new WebSocket(`ws://localhost:${HARNESS_PORT}`)
    wsRef.current = ws

    ws.on('open', () => setConnected(true))

    ws.on('message', (data) => {
      const msg = parseServerMessage(data.toString())
      if (msg) onMessageRef.current(msg)
    })

    ws.on('close', () => {
      setConnected(false)
      reconnectTimer.current = setTimeout(connect, 1000)
    })

    ws.on('error', () => {
      // close fires after error — let it handle reconnect
    })
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { connected, send }
}
