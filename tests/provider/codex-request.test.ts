import { describe, expect, it } from 'vitest'
import { prepareCodexHistory, serializeCodexRequest } from '../../src/provider/codex/request.js'

describe('Codex Responses request serializer', () => {
  it('uses instructions and flat function items with opaque continuation only', () => {
    const request = serializeCodexRequest({ model: 'gpt-5.4-mini', instructions: 'system', messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: null, providerState: { version: 1, accountGeneration: 'generation', model: 'gpt-5.4-mini', anchorCallIds: ['call_1'], items: [{ type: 'reasoning', encrypted_content: 'opaque', id: 'reason_1' }] }, tool_calls: [{ id: 'call_1', name: 'Read', arguments: '{"path":"a"}' }] }, { role: 'tool', tool_call_id: 'call_1', content: 'ok' }], tools: [{ name: 'Read', parameters: { type: 'object' } }] })
    expect(request).toMatchObject({ model: 'gpt-5.4-mini', instructions: 'system', stream: true, store: false })
    expect(request.tools?.[0]).toEqual({ type: 'function', name: 'Read', parameters: { type: 'object' } })
    expect(request.input).toContainEqual({ type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{"path":"a"}' })
    expect(request.input).toContainEqual({ type: 'function_call_output', call_id: 'call_1', output: 'ok' })
    expect(request.input).toContainEqual({ type: 'reasoning', id: 'reason_1', encrypted_content: 'opaque' })
    expect(request.include).toEqual(['reasoning.encrypted_content'])
    expect(request.reasoning).toBeUndefined()
    expect(JSON.stringify(request)).not.toContain('accountGeneration')
  })

  it('rejects unsupported content and invalid continuation', () => {
    expect(() => serializeCodexRequest({ model: 'gpt-5.4-mini', messages: [{ role: 'user', content: [{ type: 'audio', data: 'secret' }] }] })).toThrow(/unsupported/i)
    expect(() => serializeCodexRequest({ model: 'gpt-5.4-mini', messages: [{ role: 'user', content: 'x', providerState: { version: 99 } }] })).toThrow(/continuation/i)
  })
})

it('normalizes OpenAI image parts and assistant text arrays', () => {
  const body = serializeCodexRequest({ model: 'gpt-5.4-mini', messages: [
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==', detail: 'low' } }] },
    { role: 'assistant', content: [{ type: 'text', text: 'seen' }] },
  ] })
  expect(body.input).toEqual([
    { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'low' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'seen' }] },
  ])
})

it('drops stale opaque state only for completed history, preserving saved provenance', () => {
  const assistant = { role: 'assistant' as const, content: null, tool_calls: [{ id: 'call_1', name: 'Read', arguments: '{}' }], providerState: {
    version: 1, accountGeneration: 'old', model: 'gpt-5.4-mini', anchorCallIds: ['call_1'], items: [],
  } }
  expect(() => prepareCodexHistory({ model: 'gpt-5.4-mini', messages: [assistant] }, 'new')).toThrow(/pending/)
  const prepared = prepareCodexHistory({ model: 'gpt-5.4-mini', messages: [assistant, { role: 'tool', tool_call_id: 'call_1', content: 'ok' }] }, 'new')
  expect(prepared.messages[0].providerState).toBeUndefined()
  expect(assistant.providerState.accountGeneration).toBe('old')
})

it('rejects oversized aggregate continuation and incomplete anchors', () => {
  const state = { version: 1, accountGeneration: 'generation', model: 'gpt-5.4-mini', anchorCallIds: [] as string[], items: [
    { type: 'reasoning', encrypted_content: 'x'.repeat(510_000) },
    { type: 'reasoning', encrypted_content: 'y'.repeat(510_000) },
  ] }
  expect(() => serializeCodexRequest({ model: 'gpt-5.4-mini', messages: [{ role: 'assistant', content: 'x', providerState: state }] })).toThrow(/size limit/)
  expect(() => serializeCodexRequest({ model: 'gpt-5.4-mini', messages: [{ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', name: 'Read', arguments: '{}' }], providerState: { ...state, items: [] } }] })).toThrow(/anchors/)
})

it('excludes opaque state from replay exports and branches', async () => {
  const { redactSensitive, branchSession } = await import('../../src/replay/index.js')
  const { createSession } = await import('../../src/session/store.js')
  const state = { encrypted_content: 'private-reasoning' }
  const value = { messages: [{ role: 'assistant', content: 'public', providerState: state }] }
  expect(JSON.stringify(redactSensitive(value))).not.toContain('private-reasoning')
  const session = createSession('fixture', 'fixture')
  session.messages = value.messages
  expect(JSON.stringify(branchSession(session, 'parent').messages)).not.toContain('private-reasoning')
  expect(session.messages).toEqual(value.messages)
})


it('keeps the required instructions field for helper calls with only a user message', () => {
  expect(serializeCodexRequest({ model: 'gpt-5.4-mini', messages: [{ role: 'user', content: 'summarize' }] }).instructions).toBe('')
})
