'use client'
import { useRef, useState, useEffect, useCallback } from 'react'
import type { ClientMessage, ServerMessage } from '../lib/types'
import { createConnect, makeConnectionRefs, teardownConnection, type SocketLike } from '../lib/wsLifecycle'

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
  const [status, setStatus] = useState<'connecting'|'open'|'closed'|'error'>('connecting')
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const optsRef = useRef(opts)
  optsRef.current = opts
  // The single-socket / reconnect-recovery state machine lives in lib/wsLifecycle.ts so it can
  // be unit-tested against a fake socket (tests/wsConnectionLifecycle.test.ts) — this hook only
  // wires it to real browser APIs (WebSocket, React state, refs).
  const refs = useRef(makeConnectionRefs()).current

  const connect = useCallback(() => {
    const runner = createConnect(
      {
        url,
        userId: () => optsRef.current.userId ?? 'web-user',
        socketFactory: (u: string) => new WebSocket(u) as unknown as SocketLike,
        setStatus,
        onMessage: m => onMessageRef.current(m),
      },
      refs,
    )
    runner()
  }, [url, refs])

  useEffect(() => {
    // A new identity/URL is a fresh start, not a network reconnect — do not try to `resume` the
    // previous identity's session onto this one.
    teardownConnection(refs)
    refs.recovery.current = {}
    refs.hasConnectedBefore.current = false
    connect()
    return () => teardownConnection(refs)
  }, [connect, opts.userId, refs])

  const send = useCallback((msg: ClientMessage): SendResult => sendFrame(refs.ws.current as unknown as WritableSocket | null, msg), [refs])

  return { send, status, reconnect: connect }
}
