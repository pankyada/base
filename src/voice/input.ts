import type { AudioCodec, SpeechToText } from './types.js'
import { AudioChunkStream } from './stream.js'

export class VoiceInput {
  private readonly stream = new AudioChunkStream()
  private readonly controller = new AbortController()
  private started = false

  constructor(private readonly stt: SpeechToText, private readonly opts: { codec: AudioCodec; sample_rate: number }, private readonly onTranscript: (part: { text: string; final: boolean }) => void) {}

  start(): void {
    if (this.started) return
    this.started = true
    void (async () => {
      try {
        for await (const part of this.stt.transcribe(this.stream, { ...this.opts, signal: this.controller.signal })) this.onTranscript(part)
      } catch {
        // Transport callers report provider errors; an aborted stream is expected on barge-in.
      }
    })()
  }

  push(data: Uint8Array): void { this.stream.push(data) }
  end(): void { this.stream.close() }
  cancel(): void { this.controller.abort(); this.stream.close() }
}
