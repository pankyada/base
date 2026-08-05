import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { askUserTool } from '../src/tools/builtin/ask-user.js'
import { PendingStore } from '../src/runs/pending.js'

describe('AskUser tool', () => {
  it('calls onInputRequest with text kind and returns the response', async () => {
    const onInputRequest = vi.fn().mockResolvedValue('Paris')
    const ctx: any = { events: { onInputRequest } }

    const result = await askUserTool.execute(
      { prompt: 'What city?', kind: 'text' },
      ctx
    )

    expect(onInputRequest).toHaveBeenCalledWith(
      expect.any(String), 'What city?', 'text', undefined
    )
    expect(result).toBe('Paris')
  })

  it('calls onInputRequest with select kind and options', async () => {
    const onInputRequest = vi.fn().mockResolvedValue('red')
    const ctx: any = { events: { onInputRequest } }

    const result = await askUserTool.execute(
      { prompt: 'Pick a color', kind: 'select', options: ['red', 'blue', 'green'] },
      ctx
    )

    expect(onInputRequest).toHaveBeenCalledWith(
      expect.any(String), 'Pick a color', 'select', ['red', 'blue', 'green']
    )
    expect(result).toBe('red')
  })

  it('falls back to prompt text when onInputRequest not wired', async () => {
    const ctx: any = { events: {} }

    const result = await askUserTool.execute(
      { prompt: 'What city?', kind: 'text' },
      ctx
    )

    expect(result).toBe('[input_request not supported in this environment]')
  })

  it('parks a deferred question durably and sends its correlation id', async () => {
    const pendingInputs = new PendingStore(mkdtempSync(join(tmpdir(), 'harness-ask-')))
    const channels = { enabled: true, send: vi.fn().mockResolvedValue({ ok: true }) }
    const ctx: any = {
      events: {}, runId: 'run-1', currentToolCallId: 'tool-1', pendingInputs, channels,
      session: { id: 'session-1', user: 'alice' }, profile: { name: 'p' },
    }

    await expect(askUserTool.execute(
      { prompt: 'Pick a color', kind: 'select', options: ['red', 'blue'], defer: true, ttl: '2h', channel: 'stdout' },
      ctx,
    )).rejects.toMatchObject({ name: 'ParkSignal' })

    const record = pendingInputs.list()[0]
    expect(record).toMatchObject({ run_id: 'run-1', session_id: 'session-1', prompt: 'Pick a color', state: 'open', channel: 'stdout' })
    expect(channels.send).toHaveBeenCalledWith('alice', 'stdout', expect.objectContaining({ correlation_id: record.id }))
  })
})
