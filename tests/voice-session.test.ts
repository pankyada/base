import { describe, expect, it, vi } from 'vitest'
import { sentenceChunks, VoiceTurn } from '../src/voice/session.js'

async function* stream(...parts: string[]) { for (const part of parts) yield part }

describe('voice turn', () => {
  it('starts speech at sentence boundaries and keeps a final fragment', async () => {
    const chunks: string[] = []
    for await (const chunk of sentenceChunks(stream('First sentence. Second', ' sentence! trailing'))) chunks.push(chunk)
    expect(chunks).toEqual(['First sentence.', 'Second sentence!', 'trailing'])
  })

  it('barge-in aborts speech and model exactly once', () => {
    const abortModel = vi.fn(); const interrupted = vi.fn(); const turn = new VoiceTurn(abortModel, interrupted)
    turn.bargeIn(); turn.bargeIn()
    expect(turn.signal.aborted).toBe(true)
    expect(turn.isInterrupted).toBe(true)
    expect(abortModel).toHaveBeenCalledOnce(); expect(interrupted).toHaveBeenCalledOnce()
  })
})
