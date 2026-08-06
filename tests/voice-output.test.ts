import { describe, expect, it, vi } from 'vitest'
import { VoiceOutput } from '../src/voice/output.js'

describe('VoiceOutput', () => {
  it('starts once, synthesizes sentence chunks, and emits binary output', async () => {
    const spoken: string[] = []
    const tts = { name: 'fixture', async *synthesize(text: AsyncIterable<string>) { for await (const sentence of text) { spoken.push(sentence); yield new Uint8Array([sentence.length]) } } }
    const callbacks = { start: vi.fn(), chunk: vi.fn(), end: vi.fn() }
    const output = new VoiceOutput(tts, { sample_rate: 24_000 }, callbacks)
    output.start(); output.push('Hello world. Next bit'); output.push('!'); output.end()
    await vi.waitFor(() => expect(callbacks.end).toHaveBeenCalledWith('complete'))
    expect(callbacks.start).toHaveBeenCalledOnce(); expect(spoken).toEqual(['Hello world.', 'Next bit!']); expect(callbacks.chunk).toHaveBeenCalledTimes(2)
  })
})
