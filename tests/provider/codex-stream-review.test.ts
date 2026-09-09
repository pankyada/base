import { describe, expect, it } from 'vitest'
import { parseCodexSse } from '../../src/provider/codex/stream.js'

function frame(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`
}

async function* chunks(values: Array<string | Uint8Array>) {
  yield* values
}

async function collect(values: Array<string | Uint8Array>, options = {}) {
  const events = []
  for await (const event of parseCodexSse(chunks(values), options)) events.push(event)
  return events
}

function completed(output: unknown[] = []) {
  return {
    type: 'response.completed',
    response: {
      status: 'completed', output,
      usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 2 } },
    },
  }
}

describe('independent Codex stream acceptance review', () => {
  it('decodes split UTF-8 and split SSE delimiters without corrupting text', async () => {
    const bytes = Buffer.from(frame({ type: 'response.output_text.delta', delta: 'héllo 🌍' }) + frame(completed()))
    const events = await collect([...bytes].map(byte => Uint8Array.of(byte)))
    expect(events.filter(event => event.type === 'text').map(event => event.delta).join('')).toBe('héllo 🌍')
    const terminal = events.filter(event => event.type === 'done')
    expect(terminal).toHaveLength(1)
    expect(terminal[0].result.usage?.inputTokens).toBe(10)
  })

  it('requires a terminal response before accepting output', async () => {
    await expect(collect([frame({ type: 'response.output_text.delta', delta: 'partial' })]))
      .rejects.toThrow(/terminal|ended|EOF/i)
  })

  it('rejects an oversized unterminated event before waiting for a delimiter', async () => {
    await expect(collect(['data: ' + 'x'.repeat(200)], { maxEventBytes: 64 }))
      .rejects.toThrow(/size|limit|large/i)
  })

  it('uses completed output text when no text deltas arrived', async () => {
    const events = await collect([frame(completed([
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'final snapshot' }] },
    ]))])
    expect(events.find(event => event.type === 'done')?.result.text).toBe('final snapshot')
  })

  it('uses a top-level terminal output_text item when no text deltas arrived', async () => {
    const events = await collect([frame(completed([
      { type: 'output_text', text: 'terminal text item' },
    ]))])
    expect(events.find(event => event.type === 'done')?.result.text).toBe('terminal text item')
  })

  it('keeps item IDs distinct from executable call IDs', async () => {
    const call = { type: 'function_call', id: 'item_1', call_id: 'call_1', name: 'Read', arguments: '{"path":"a"}' }
    const events = await collect([
      frame({ type: 'response.output_item.added', output_index: 0, item: { ...call, arguments: '' } }),
      frame({ type: 'response.function_call_arguments.delta', item_id: 'item_1', output_index: 0, delta: '{"path":' }),
      frame({ type: 'response.function_call_arguments.delta', item_id: 'item_1', output_index: 0, delta: '"a"}' }),
      frame({ type: 'response.output_item.done', output_index: 0, item: call }),
      frame(completed([call])),
    ])
    expect(events.find(event => event.type === 'done')?.result.toolCalls).toEqual([
      { id: 'call_1', name: 'Read', arguments: '{"path":"a"}' },
    ])
    expect(events.filter(event => event.type === 'tool_delta').every(event => event.id === 'call_1')).toBe(true)
  })

  it('treats the terminal output as authoritative when a streamed call is retracted', async () => {
    const speculative = { type: 'function_call', id: 'item_speculative', call_id: 'call_speculative', name: 'Read', arguments: '' }
    const events = await collect([
      frame({ type: 'response.output_item.added', output_index: 0, item: speculative }),
      frame(completed([{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'final answer' }] }])),
    ])
    const result = events.find(event => event.type === 'done')?.result
    expect(result?.text).toBe('final answer')
    expect(result?.toolCalls).toEqual([])
  })

  it('uses a completed streamed call when Codex sends an empty terminal output', async () => {
    const call = { type: 'function_call', id: 'item_streamed', call_id: 'call_streamed', name: 'Read', arguments: '{"path":"a"}' }
    const events = await collect([
      frame({ type: 'response.output_item.added', output_index: 0, item: { ...call, arguments: '' } }),
      frame({ type: 'response.function_call_arguments.delta', item_id: 'item_streamed', output_index: 0, delta: call.arguments }),
      frame({ type: 'response.output_item.done', output_index: 0, item: call }),
      frame(completed()),
    ])
    expect(events.find(event => event.type === 'done')?.result.toolCalls).toEqual([
      { id: 'call_streamed', name: 'Read', arguments: '{"path":"a"}' },
    ])
  })

  it.each(['{bad', 'null', '[]', '"string"'])('rejects invalid executable argument object %s', async argumentsText => {
    await expect(collect([frame(completed([
      { type: 'function_call', id: 'item_1', call_id: 'call_1', name: 'Write', arguments: argumentsText },
    ]))])).rejects.toThrow(/argument|JSON|object/i)
  })

  it('does not treat failed or incomplete responses as successful completion', async () => {
    for (const type of ['response.failed', 'response.incomplete']) {
      await expect(collect([frame({ type, response: { status: type.slice(9), error: { code: 'test_failure', message: 'failure' } } })]))
        .rejects.toThrow()
    }
  })

  it('rejects unknown executable output types instead of silently dropping actions', async () => {
    await expect(collect([frame(completed([
      { type: 'computer_call', call_id: 'computer_1', action: { type: 'click', x: 1, y: 2 } },
    ]))])).rejects.toThrow(/unsupported|unknown|computer/i)
  })

  it('normalizes refusal without inventing a successful answer or tool call', async () => {
    const events = await collect([frame(completed([
      { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Cannot perform this request.' }] },
    ]))])
    const result = events.find(event => event.type === 'done')?.result
    expect(result?.finishReason).toBe('refusal')
    expect(result?.toolCalls).toEqual([])
  })

  it('emits at most one terminal result for duplicate final snapshots', async () => {
    const final = frame(completed())
    const events = await collect([final, final])
    expect(events.filter(event => event.type === 'done')).toHaveLength(1)
  })

  it('propagates cancellation rather than returning an empty successful stream', async () => {
    const controller = new AbortController()
    controller.abort(new Error('review cancellation'))
    await expect(collect([frame(completed())], { signal: controller.signal })).rejects.toThrow(/cancel|abort/i)
  })

  it('finishes at terminal without waiting for a server to close its stream', async () => {
    async function* stillOpen() {
      yield frame(completed())
      throw new Error('must not read beyond terminal')
    }
    const events = []
    for await (const event of parseCodexSse(stillOpen())) events.push(event)
    expect(events.filter(event => event.type === 'done')).toHaveLength(1)
  })

  it('rejects duplicate executable call ids', async () => {
    const call = { type: 'function_call', id: 'item', call_id: 'call', name: 'Write', arguments: '{}' }
    await expect(collect([frame(completed([call, call]))])).rejects.toThrow(/duplicate/i)
  })

  it('bounds aggregate output across individually small events', async () => {
    const delta = frame({ type: 'response.output_text.delta', delta: 'x'.repeat(40) })
    await expect(collect([delta, delta, frame(completed())], { maxOutputBytes: 64 })).rejects.toThrow(/size|limit|large/i)
  })

  it('does not accept a completed event carrying failed status', async () => {
    await expect(collect([frame({ type: 'response.completed', response: { status: 'failed', output: [] } })])).rejects.toThrow(/status|completed|failed/i)
  })
})
