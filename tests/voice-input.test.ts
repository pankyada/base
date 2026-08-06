import { describe, expect, it, vi } from 'vitest'
import { VoiceInput } from '../src/voice/input.js'

describe('VoiceInput', () => {
  it('forwards binary chunks into streaming STT partials', async () => {
    const seen: number[] = []
    const stt = { name: 'fixture', async *transcribe(stream: AsyncIterable<Uint8Array>) { for await (const chunk of stream) { seen.push(...chunk); yield { text: `heard ${chunk[0]}`, final: false } }; yield { text: 'done', final: true } } }
    const transcript = vi.fn(); const input = new VoiceInput(stt, { codec: 'pcm16', sample_rate: 16_000 }, transcript)
    input.start(); input.push(new Uint8Array([7])); input.end()
    await vi.waitFor(() => expect(transcript).toHaveBeenLastCalledWith({ text: 'done', final: true }))
    expect(seen).toEqual([7])
  })

  it('does not deliver chunks after cancellation', async () => {
    const stt = { name: 'fixture', async *transcribe(stream: AsyncIterable<Uint8Array>) { for await (const chunk of stream) yield { text: String(chunk[0]), final: false } } }
    const transcript = vi.fn(); const input = new VoiceInput(stt, { codec: 'opus', sample_rate: 48_000 }, transcript)
    input.start(); input.cancel(); input.push(new Uint8Array([1]))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(transcript).not.toHaveBeenCalled()
  })
})
