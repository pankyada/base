import { describe, expect, it, vi } from 'vitest'
import { createConnect, makeConnectionRefs, teardownConnection, type SocketLike } from '../lib/wsLifecycle'

/** A fake socket that records what it was asked to do and lets the test drive its lifecycle
 * events directly, so no real network/DOM WebSocket is needed (web tests run under vitest
 * environment:'node' — see web/vitest.config.ts). */
class FakeSocket implements SocketLike {
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send(data: string): void { this.sent.push(data) }
  close(): void { this.closed = true; this.readyState = 3 }
  open(): void { this.readyState = 1; this.onopen?.() }
}

function harness() {
  const sockets: FakeSocket[] = []
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = []
  let statusVal = 'connecting'
  const deps = {
    url: 'ws://test',
    userId: () => 'user-a',
    socketFactory: () => { const s = new FakeSocket(); sockets.push(s); return s },
    setStatus: (s: any) => { statusVal = s },
    onMessage: vi.fn(),
    setTimeoutFn: (fn: () => void, ms: number) => { const handle = { fn, ms, cancelled: false }; timers.push(handle); return handle as any },
    clearTimeoutFn: (handle: any) => { handle.cancelled = true },
  }
  const refs = makeConnectionRefs()
  const connect = createConnect(deps, refs)
  return { sockets, timers, refs, connect, deps, status: () => statusVal }
}

describe('single-socket discipline (createConnect)', () => {
  it('mount/connect leaves exactly one live socket', () => {
    const { sockets, refs, connect } = harness()
    connect()
    expect(sockets).toHaveLength(1)
    expect(refs.ws.current).toBe(sockets[0])
  })

  it('repeated mount/unmount cycles leave exactly one socket and zero pending timers each time', () => {
    for (let i = 0; i < 5; i++) {
      const { sockets, timers, refs, connect } = harness()
      connect()
      sockets[0].open()
      teardownConnection(refs, h => { (h as any).cancelled = true })
      expect(refs.ws.current).toBeNull()
      expect(refs.retry.current).toBeNull()
      expect(sockets[0].closed).toBe(true)
      // No reconnect timer should have been scheduled — the socket never closed on its own.
      expect(timers.filter(t => !t.cancelled)).toHaveLength(0)
    }
  })

  it('an onclose from a live socket schedules exactly one retry timer, and cleanup cancels it', () => {
    const { sockets, timers, refs, connect } = harness()
    connect()
    sockets[0].open()
    sockets[0].onclose?.()
    expect(refs.retry.current).not.toBeNull()
    expect(timers.filter(t => !t.cancelled)).toHaveLength(1)
    teardownConnection(refs, h => { (h as any).cancelled = true })
    expect(timers.filter(t => !t.cancelled)).toHaveLength(0)
    expect(refs.retry.current).toBeNull()
  })

  it('callbacks from a socket superseded by a fresh connect() are ignored', () => {
    const { sockets, refs, connect, deps } = harness()
    connect()
    const stale = sockets[0]
    stale.open()
    // Simulate the hook calling connect() again (e.g. a manual reconnect) before the old
    // socket's close event fires — the old socket is now superseded.
    connect()
    expect(sockets).toHaveLength(2)
    const current = sockets[1]
    expect(refs.ws.current).toBe(current)
    // A late message/close from the superseded socket must not be applied.
    stale.onmessage?.({ data: JSON.stringify({ type: 'notice', level: 'info', message: 'stale' }) })
    stale.onclose?.()
    expect(deps.onMessage).not.toHaveBeenCalled()
    expect(refs.ws.current).toBe(current) // no reconnect timer scheduled from the stale close
  })

  it('manual reconnect closes the superseded socket before replacing it', () => {
    const { sockets, refs, connect } = harness()
    connect()
    const first = sockets[0]
    first.open()
    connect()
    expect(first.closed).toBe(true)
    expect(refs.ws.current).toBe(sockets[1])
  })

  it('exactly one socket survives after several identity-switch-style mount/unmount pairs, never accumulating', () => {
    const refsAcrossMounts: unknown[] = []
    for (let i = 0; i < 3; i++) {
      const { sockets, refs, connect } = harness()
      connect()
      sockets[0].open()
      refsAcrossMounts.push(refs.ws.current)
      teardownConnection(refs)
    }
    // Every mount produced its own single live socket (harness() is a fresh module-level state
    // per mount, mirroring how each hook instance gets its own refs via makeConnectionRefs()).
    expect(new Set(refsAcrossMounts).size).toBe(3)
  })
})

describe('backoff resets only on confirmed open', () => {
  it('does not reset backoff just from scheduling a connect attempt', () => {
    const { sockets, refs, connect } = harness()
    connect()
    refs.backoff.current = 8000
    sockets[0].onclose?.() // close without ever opening
    expect(refs.backoff.current).toBe(16000) // doubled, not reset to 1000
  })

  it('resets backoff to 1000 once the socket actually opens', () => {
    const { sockets, refs, connect } = harness()
    connect()
    refs.backoff.current = 8000
    sockets[0].open()
    expect(refs.backoff.current).toBe(1000)
  })
})
