import { describe, it, expect, vi } from 'vitest'
import { askUserTool } from '../src/tools/builtin/ask-user.js'

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
})
