import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>

function makeFakeChild(exitAfterMs?: number) {
  const child: any = { kill: vi.fn(), pid: 1234 }
  if (exitAfterMs !== undefined) {
    setTimeout(() => child.emit?.('close', 0), exitAfterMs)
  }
  return child
}

function mockFetch(responses: Array<{ ok: boolean; status: number } | 'throw'>) {
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)]
    if (r === 'throw') throw new Error('connection refused')
    return { ok: r.ok, status: r.status }
  }))
}

describe('ensureServer', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.resetModules() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('reuses existing server — no child spawned, spawnedByUs false', async () => {
    mockFetch([{ ok: true, status: 200 }])

    const { ensureServer } = await import('../src/tui/bootstrap.js')
    const result = await ensureServer(7337)

    expect(result.spawnedByUs).toBe(false)
    expect(mockSpawn).not.toHaveBeenCalled()
    result.cleanup()
  })

  it('spawns server when not running, returns spawnedByUs true', async () => {
    mockFetch(['throw', { ok: true, status: 200 }])
    mockSpawn.mockReturnValue(makeFakeChild())

    const { ensureServer } = await import('../src/tui/bootstrap.js')
    const resultPromise = ensureServer(7337)
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.spawnedByUs).toBe(true)
    expect(mockSpawn).toHaveBeenCalledOnce()
  })

  it('cleanup kills the spawned child', async () => {
    mockFetch(['throw', { ok: true, status: 200 }])
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child)

    const { ensureServer } = await import('../src/tui/bootstrap.js')
    const resultPromise = ensureServer(7337)
    await vi.runAllTimersAsync()
    const result = await resultPromise

    result.cleanup()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('rejects with timeout error if server never becomes healthy', async () => {
    mockFetch(['throw'])
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child)

    const { ensureServer } = await import('../src/tui/bootstrap.js')
    const resultPromise = ensureServer(7337)
    // Attach rejection handler immediately so it's never unhandled
    const rejection = expect(resultPromise).rejects.toThrow('failed to become healthy within 10s')
    await vi.advanceTimersByTimeAsync(11_000)
    await rejection

    expect(child.kill).toHaveBeenCalled()
  })
})

describe('resolveServerCommand', () => {
  it('returns tsx command in dev context (src/ present)', async () => {
    const { resolveServerCommand } = await import('../src/tui/bootstrap.js')
    const cmd = resolveServerCommand(true)
    expect(cmd.command).toBe('tsx')
    expect(cmd.args[0]).toContain('src/server/index.ts')
  })

  it('returns sibling harness-server in compiled context', async () => {
    const { resolveServerCommand } = await import('../src/tui/bootstrap.js')
    const cmd = resolveServerCommand(false)
    expect(cmd.command).toContain('harness-server')
    expect(cmd.args).toEqual([])
  })
})
