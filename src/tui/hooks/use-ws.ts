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
  lastMessage: ServerMessage | null
}

export function useWs(): UseWsResult {
  const [connected, setConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<ServerMessage | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    const ws = new WebSocket(`ws://localhost:${HARNESS_PORT}`)
    wsRef.current = ws

    ws.on('open', () => setConnected(true))

    ws.on('message', (data) => {
      const msg = parseServerMessage(data.toString())
      if (msg) setLastMessage(msg)
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

  return { connected, send, lastMessage }
}
