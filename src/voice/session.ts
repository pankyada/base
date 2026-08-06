/** Split streamed text into speakable sentence chunks without waiting for turn end. */
export async function* sentenceChunks(text: AsyncIterable<string>): AsyncIterable<string> {
  let buffer = ''
  for await (const part of text) {
    buffer += part
    while (true) {
      const match = /[.!?](?:\s|$)/.exec(buffer)
      if (!match) break
      const end = match.index + match[0].length
      const sentence = buffer.slice(0, end).trim()
      buffer = buffer.slice(end)
      if (sentence) yield sentence
    }
  }
  if (buffer.trim()) yield buffer.trim()
}

/** Owns a voice turn's cancellation boundary: speech, playback, and LLM stop together. */
export class VoiceTurn {
  private readonly controller = new AbortController()
  private interrupted = false

  constructor(private readonly abortModel: () => void, private readonly onInterrupted: () => void) {}

  get signal(): AbortSignal { return this.controller.signal }
  get isInterrupted(): boolean { return this.interrupted }

  bargeIn(): void {
    if (this.interrupted) return
    this.interrupted = true
    this.controller.abort()
    this.abortModel()
    this.onInterrupted()
  }
}
