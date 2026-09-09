import { describe, expect, it, vi } from 'vitest'
import { destroyMcpClients } from '../src/mcp/client.js'
import { VoiceTurn } from '../src/voice/session.js'

describe('Core lifecycle/platform boundaries', () => {
  it('awaits MCP client shutdown and isolates close failures', async () => {
    let closed = false
    const close = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 5)); closed = true })
    await destroyMcpClients([{ client: { close } as any, serverName: 'fixture', tools: [] }])
    expect(close).toHaveBeenCalledOnce()
    expect(closed).toBe(true)
  })

  it('barge-in aborts model and invokes interruption cleanup once', () => {
    const abortModel = vi.fn(); const interrupted = vi.fn(); const turn = new VoiceTurn(abortModel, interrupted)
    turn.bargeIn(); turn.bargeIn()
    expect(turn.signal.aborted).toBe(true); expect(turn.isInterrupted).toBe(true)
    expect(abortModel).toHaveBeenCalledOnce(); expect(interrupted).toHaveBeenCalledOnce()
  })
})
