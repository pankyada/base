import type { TextToSpeech } from './types.js'
import { sentenceChunks } from './session.js'

class TextStream implements AsyncIterable<string> {
  private queued: string[] = []
  private waiter: ((result: IteratorResult<string>) => void) | null = null
  private closed = false
  push(text: string): void { if (!this.closed) { if (this.waiter) { const resolve = this.waiter; this.waiter = null; resolve({ value: text, done: false }) } else this.queued.push(text) } }
  close(): void { this.closed = true; if (this.waiter) { const resolve = this.waiter; this.waiter = null; resolve({ value: undefined as never, done: true }) } }
  [Symbol.asyncIterator](): AsyncIterator<string> { return { next: () => { const value = this.queued.shift(); if (value !== undefined) return Promise.resolve({ value, done: false }); if (this.closed) return Promise.resolve({ value: undefined as never, done: true }); return new Promise(resolve => { this.waiter = resolve }) } } }
}

export class VoiceOutput {
  private readonly text = new TextStream()
  private readonly controller = new AbortController()
  private started = false

  constructor(private readonly tts: TextToSpeech, private readonly opts: { voice?: string; sample_rate: number }, private readonly callbacks: { start(): void; chunk(data: Uint8Array): void; end(reason: 'complete' | 'interrupted' | 'error'): void }) {}

  start(): void {
    if (this.started) return
    this.started = true; this.callbacks.start()
    void (async () => {
      try { for await (const chunk of this.tts.synthesize(sentenceChunks(this.text), { ...this.opts, signal: this.controller.signal })) this.callbacks.chunk(chunk); this.callbacks.end(this.controller.signal.aborted ? 'interrupted' : 'complete') }
      catch { this.callbacks.end(this.controller.signal.aborted ? 'interrupted' : 'error') }
    })()
  }
  push(text: string): void { this.text.push(text) }
  end(): void { this.text.close() }
  cancel(): void { this.controller.abort(); this.text.close() }
}
