import { describe, expect, it } from 'vitest'
import { AudioChunkStream } from '../src/voice/stream.js'

describe('AudioChunkStream', () => {
  it('streams ordered frames and completes on close', async () => {
    const stream = new AudioChunkStream(); const iterator = stream[Symbol.asyncIterator]()
    const waiting = iterator.next(); stream.push(new Uint8Array([1, 2])); stream.push(new Uint8Array([3])); stream.close()
    expect(await waiting).toMatchObject({ value: new Uint8Array([1, 2]), done: false })
    expect(await iterator.next()).toMatchObject({ value: new Uint8Array([3]), done: false })
    expect(await iterator.next()).toMatchObject({ done: true })
  })
})
