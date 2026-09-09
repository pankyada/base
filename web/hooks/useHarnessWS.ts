'use client'
import { useRef, useState, useEffect, useCallback } from 'react'
import type { ClientMessage, ServerMessage } from '../lib/types'
import { PROTOCOL_VERSION } from '../lib/protocol'

interface Options {
  userId?: string
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'not-connected' | 'write-failed'; detail?: string }

/** Minimal socket surface used for writing, so delivery can be tested without a DOM. */
interface WritableSocket {
  readonly readyState: number
  send(data: string): void
}

const SOCKET_OPEN = 1

/**
 * Write a frame and report what actually happened. A caller must not render a
 * message as sent until this returns `ok`.
 */
export function sendFrame(socket: WritableSocket | null | undefined, msg: ClientMessage): SendResult {
  if (!socket || socket.readyState !== SOCKET_OPEN) return { ok: false, reason: 'not-connected' }
  try {
    socket.send(JSON.stringify(msg))
    return { ok: true }
  } catch (cause) {
    return { ok: false, reason: 'write-failed', detail: cause instanceof Error ? cause.message : String(cause) }
  }
}

/** Operator-facing reason for a refused frame. */
export function sendFailureReason(result: SendResult): string {
  if (result.ok) return ''
  return result.reason === 'not-connected'
    ? 'not connected — message not sent'
    : `send failed — ${result.detail ?? 'transport error'}`
}

export function useHarnessWS(url: string, onMessage: (m: ServerMessage) => void, opts: Options = {}) {
  const ws = useRef<WebSocket | null>(null)
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatus] = useState<'connecting'|'open'|'closed'|'error'>('connecting')
  const backoff = useRef(1000)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const optsRef = useRef(opts)
  optsRef.current = opts

  const connect = useCallback(() => {
    if (retry.current) { clearTimeout(retry.current); retry.current = null }
    setStatus('connecting')
    const sock = new WebSocket(url)
    ws.current = sock
    sock.onopen = () => {
      if (ws.current !== sock) return
      setStatus('open')
      backoff.current = 1000
      sendFrame(sock, {
        type: 'hello',
        protocol_version: PROTOCOL_VERSION,
        wasm_supported: true,
        user_id: optsRef.current.userId ?? 'web-user',
      } as ClientMessage)
    }
    sock.onmessage = e => {
      // Ignore frames from a socket this hook has already superseded.
      if (ws.current !== sock) return
      try { onMessageRef.current(JSON.parse(e.data)) } catch {}
    }
    sock.onclose = () => {
      if (ws.current !== sock) return
      setStatus('closed')
      const delay = backoff.current
      backoff.current = Math.min(backoff.current * 2, 30000)
      retry.current = setTimeout(connect, delay)
    }
    sock.onerror = () => { if (ws.current === sock) setStatus('error') }
  }, [url])

  useEffect(() => {
    const sock = ws.current
    ws.current = null
    sock?.close()
    connect()
    return () => {
      if (retry.current) { clearTimeout(retry.current); retry.current = null }
      const s = ws.current
      ws.current = null
      s?.close()
    }
  }, [connect, opts.userId])

  const send = useCallback((msg: ClientMessage): SendResult => sendFrame(ws.current, msg), [])

  return { send, status, reconnect: connect }
}
