// Pure bookkeeping for the WS reconnect lifecycle, split out of useHarnessWS so it can be
// unit-tested without a DOM/React tree (the web test env is vitest environment:'node' — see
// web/vitest.config.ts). Two concerns live here:
//
// 1. Recovery state: which session/profile the client last had confirmed by Core, tracked from
//    inbound `session_ready`/`session_resumed` frames (src/types.ts). Used to rebuild the
//    `hello` + `resume` frames a reconnect must send — `resume` (src/server/index.ts, `msg.type
//    === 'resume'`) is the existing Core contract for re-attaching to a prior session; there is
//    no bespoke recovery protocol here.
// 2. Socket-guard bookkeeping: a tiny "is this callback still current" predicate, so the actual
//    single-socket discipline in useHarnessWS (one live WebSocket ref, one retry-timer ref,
//    stale-handler rejection) can be exercised against a fake socket/timer pair in a test.

import type { ClientMessage, ServerMessage } from './types'
import { PROTOCOL_VERSION } from './protocol'

export interface RecoveryState {
  sessionId?: string
  profile?: string
}

/** Fold one inbound server frame into recovery state. Pure — no I/O. */
export function nextRecoveryState(current: RecoveryState, msg: ServerMessage): RecoveryState {
  if (msg && typeof msg === 'object') {
    if ((msg as any).type === 'session_ready') {
      return { sessionId: (msg as any).sessionId, profile: (msg as any).profile }
    }
    if ((msg as any).type === 'session_resumed') {
      // Resume can switch profiles server-side (src/server/index.ts re-resolves baseProfile to
      // the resumed session's own profile), so adopt the reported profile instead of keeping
      // whatever the connection was on before the resume.
      return { ...current, sessionId: (msg as any).sessionId, profile: (msg as any).profile }
    }
  }
  return current
}

/** The `hello` frame to open a connection with. On a reconnect, carries the last confirmed
 * profile so a fresh session (if `resume` below fails) still starts on the right profile instead
 * of silently falling back to the server default. */
export function buildHelloFrame(userId: string, recovery: RecoveryState, isReconnect: boolean): ClientMessage {
  return {
    type: 'hello',
    protocol_version: PROTOCOL_VERSION,
    wasm_supported: true,
    user_id: userId,
    ...(isReconnect && recovery.profile ? { profile: recovery.profile } : {}),
  } as ClientMessage
}

/** The `resume` frame to send right after `hello` on a reconnect, when a prior session is known.
 * `null` when there is nothing to recover (first connect, or no session confirmed yet). */
export function buildResumeFrame(recovery: RecoveryState, isReconnect: boolean): ClientMessage | null {
  if (!isReconnect || !recovery.sessionId) return null
  return { type: 'resume', sessionId: recovery.sessionId } as ClientMessage
}

// --- Single-socket connection manager -------------------------------------------------------
//
// The actual reconnect state machine used by useHarnessWS, pulled out so the single-socket /
// zero-orphaned-timer guarantee can be asserted directly (tests/wsConnectionLifecycle.test.ts)
// against a fake socket instead of only being "exercised" incidentally through a DOM-rendered
// hook. A plain `{ current: T }` box stands in for a React ref — useHarnessWS passes real
// `useRef` objects, which have the identical shape.

export interface Box<T> { current: T }

export interface SocketLike {
  readyState: number
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}

export interface ConnectionDeps {
  url: string
  userId: () => string
  socketFactory: (url: string) => SocketLike
  setStatus: (status: 'connecting' | 'open' | 'closed' | 'error') => void
  onMessage: (m: ServerMessage) => void
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void
  maxBackoffMs?: number
}

export interface ConnectionRefs {
  ws: Box<SocketLike | null>
  retry: Box<ReturnType<typeof setTimeout> | null>
  backoff: Box<number>
  recovery: Box<RecoveryState>
  hasConnectedBefore: Box<boolean>
}

export function makeConnectionRefs(): ConnectionRefs {
  return { ws: { current: null }, retry: { current: null }, backoff: { current: 1000 }, recovery: { current: {} }, hasConnectedBefore: { current: false } }
}

/** Build a `connect` function closing over `deps`/`refs`. Every guard mirrors useHarnessWS:
 * exactly one live socket in `refs.ws`, at most one pending timer in `refs.retry`, and every
 * socket callback checks `refs.ws.current === sock` before acting so a superseded socket's late
 * events are inert. */
export function createConnect(deps: ConnectionDeps, refs: ConnectionRefs): () => void {
  const scheduleTimeout = deps.setTimeoutFn ?? setTimeout
  const cancelTimeout = deps.clearTimeoutFn ?? clearTimeout
  const maxBackoff = deps.maxBackoffMs ?? 30000

  const connect = (): void => {
    if (refs.retry.current) { cancelTimeout(refs.retry.current); refs.retry.current = null }
    // Manual reconnect can happen while the current socket is open. Close it before replacing
    // the ref so the old transport cannot remain connected as an unobserved orphan.
    const previous = refs.ws.current
    if (previous) {
      refs.ws.current = null
      previous.close()
    }
    deps.setStatus('connecting')
    const sock = deps.socketFactory(deps.url)
    refs.ws.current = sock
    sock.onopen = () => {
      if (refs.ws.current !== sock) return
      deps.setStatus('open')
      refs.backoff.current = 1000
      const isReconnect = refs.hasConnectedBefore.current
      refs.hasConnectedBefore.current = true
      sendFrameToSocket(sock, buildHelloFrame(deps.userId(), refs.recovery.current, isReconnect))
      const resumeFrame = buildResumeFrame(refs.recovery.current, isReconnect)
      if (resumeFrame) sendFrameToSocket(sock, resumeFrame)
    }
    sock.onmessage = ev => {
      if (refs.ws.current !== sock) return
      try {
        const parsed = JSON.parse(ev.data)
        refs.recovery.current = nextRecoveryState(refs.recovery.current, parsed)
        deps.onMessage(parsed)
      } catch { /* malformed frame from Core — drop it */ }
    }
    sock.onclose = () => {
      if (refs.ws.current !== sock) return
      deps.setStatus('closed')
      const delay = refs.backoff.current
      refs.backoff.current = Math.min(refs.backoff.current * 2, maxBackoff)
      refs.retry.current = scheduleTimeout(connect, delay)
    }
    sock.onerror = () => { if (refs.ws.current === sock) deps.setStatus('error') }
  }
  return connect
}

/** Close the live socket (if any) and cancel any pending retry timer. Leaves `refs` ready for a
 * fresh `connect()` or for the hook to be torn down for good. */
export function teardownConnection(refs: ConnectionRefs, clearTimeoutFn: (h: ReturnType<typeof setTimeout>) => void = clearTimeout): void {
  if (refs.retry.current) { clearTimeoutFn(refs.retry.current); refs.retry.current = null }
  const sock = refs.ws.current
  refs.ws.current = null
  sock?.close()
}

function sendFrameToSocket(sock: SocketLike, msg: ClientMessage): void {
  try { sock.send(JSON.stringify(msg)) } catch { /* delivery result is not observed here; useHarnessWS.send handles caller-facing writes */ }
}
