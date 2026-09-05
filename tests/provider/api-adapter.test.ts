import { describe, expect, it, vi } from 'vitest'
import { createApiKeyProvider } from '../../src/provider/api-key.js'

const profile: any = { name: 'api', model: { base_url: 'https://api.example.test/v1', api_key_env: 'TEST_API_KEY', id: 'gpt-4o' } }

describe('API provider adapter', () => {
  it('preserves model, nested tool schema, sampling and token options', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'ok', tool_calls: [] }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1 } })
    const provider = createApiKeyProvider(profile, { chat: { completions: { create } } } as any)
    const result = await provider.generate({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'Read', description: 'read', parameters: { type: 'object' } }], stream: false, maxTokens: 12, maxCompletionTokens: 11, temperature: 0, topP: 0.2 }, { purpose: 'test' })
    const request = create.mock.calls[0][0]
    expect(request).toMatchObject({ model: 'gpt-4o', stream: false, max_tokens: 12, max_completion_tokens: 11, temperature: 0, top_p: 0.2 })
    expect(request.tools[0]).toEqual({ type: 'function', function: { name: 'Read', description: 'read', parameters: { type: 'object' } } })
    expect(result.text).toBe('ok')
  })

  it('keeps legacy assistant tool call message shape and propagates cancellation', async () => {
    async function* stream() {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'Read', arguments: '{' } }] } }] } as any
      yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] } }] } as any
    }
    const create = vi.fn().mockResolvedValue(stream())
    const provider = createApiKeyProvider(profile, { chat: { completions: { create } } } as any)
    const result = await provider.generate({ model: 'gpt-4o', messages: [{ role: 'assistant', content: null, tool_calls: [{ id: 'call', name: 'Read', arguments: '{}' }] }] })
    expect(result.toolCalls).toEqual([{ id: 'call', name: 'Read', arguments: '{}' }])
    const controller = new AbortController(); controller.abort()
    const abortCreate = vi.fn().mockRejectedValue(new Error('aborted'))
    await expect(createApiKeyProvider(profile, { chat: { completions: { create: abortCreate } } } as any).generate({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }], signal: controller.signal })).rejects.toThrow()
  })
})
