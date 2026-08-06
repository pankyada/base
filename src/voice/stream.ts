/** Small abort-aware async queue used to bridge WebSocket binary frames to STT. */
export class AudioChunkStream implements AsyncIterable<Uint8Array> {
  private readonly queued: Uint8Array[] = []
  private waiter: ((result: IteratorResult<Uint8Array>) => void) | null = null
  private closed = false

  push(chunk: Uint8Array): void {
    if (this.closed) return
    if (this.waiter) { const resolve = this.waiter; this.waiter = null; resolve({ value: chunk, done: false }); return }
    this.queued.push(chunk)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.waiter) { const resolve = this.waiter; this.waiter = null; resolve({ value: undefined as never, done: true }) }
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: () => {
        const value = this.queued.shift()
        if (value) return Promise.resolve({ value, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise(resolve => { this.waiter = resolve })
      },
    }
  }
}
