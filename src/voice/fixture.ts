import type { VoiceProvider } from './types.js'

/** Deterministic no-network provider for transport and plugin integration tests. */
export const fixtureVoiceProvider: VoiceProvider = {
  name: 'fixture',
  stt: {
    name: 'fixture-stt',
    async *transcribe(stream) {
      const decoder = new TextDecoder()
      let text = ''
      for await (const chunk of stream) {
        text += decoder.decode(chunk, { stream: true })
        if (text) yield { text, final: false }
      }
      const finalText = text + decoder.decode()
      if (finalText) yield { text: finalText, final: true }
    },
  },
  tts: {
    name: 'fixture-tts',
    async *synthesize(text) {
      const encoder = new TextEncoder()
      for await (const sentence of text) yield encoder.encode(sentence)
    },
  },
}
