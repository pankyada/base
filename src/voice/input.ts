import type { AudioCodec, SpeechToText } from './types.js'
import { AudioChunkStream } from './stream.js'

export class VoiceInput {
  private readonly stream = new AudioChunkStream()
  private readonly controller = new AbortController()
  private started = false
  private silenceTimer: ReturnType<typeof setTimeout> | undefined
  private utteranceTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(private readonly stt: SpeechToText, private readonly opts: { codec: AudioCodec; sample_rate: number; silence_ms?: number; max_utterance_s?: number }, private readonly onTranscript: (part: { text: string; final: boolean }) => void) {}

  start(): void {
    if (this.started) return
    this.started = true
    if (this.opts.max_utterance_s) this.utteranceTimer = setTimeout(() => this.end(), this.opts.max_utterance_s * 1000)
    void (async () => {
      try {
        for await (const part of this.stt.transcribe(this.stream, { ...this.opts, signal: this.controller.signal })) this.onTranscript(part)
      } catch {
        // Transport callers report provider errors; an aborted stream is expected on barge-in.
      }
    })()
  }

  push(data: Uint8Array): void {
    if (this.closed) return
    this.stream.push(data)
    if (this.opts.silence_ms) {
      if (this.silenceTimer) clearTimeout(this.silenceTimer)
      this.silenceTimer = setTimeout(() => this.end(), this.opts.silence_ms)
    }
  }
  end(): void {
    if (this.closed) return
    this.closed = true
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    if (this.utteranceTimer) clearTimeout(this.utteranceTimer)
    this.stream.close()
  }
  cancel(): void { this.controller.abort(); this.end() }
}
