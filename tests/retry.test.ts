import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withRetry } from '../src/loop/retry.js'

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries on 429 and succeeds on 2nd attempt', async () => {
    const err429 = Object.assign(new Error('Rate limited'), { status: 429 })
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls === 1) throw err429
      return 'ok'
    })

    const promise = withRetry(fn, 3, 0)
    // Let timers run (delay = 0 * 2^0 = 0ms)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on 400 (not retryable)', async () => {
    const err400 = Object.assign(new Error('Bad request'), { status: 400 })
    const fn = vi.fn(async () => { throw err400 })

    await expect(withRetry(fn, 3, 0)).rejects.toThrow('Bad request')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws after maxAttempts on persistent 503', async () => {
    const err503 = Object.assign(new Error('Service unavailable'), { status: 503 })
    const fn = vi.fn(async () => { throw err503 })

    const promise = withRetry(fn, 3, 0)
    // attach rejection handler immediately to avoid unhandled rejection
    const caught = promise.catch(e => e)
    await vi.runAllTimersAsync()
    const result = await caught
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('Service unavailable')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('retries on ECONNRESET', async () => {
    const errReset = Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' })
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls < 3) throw errReset
      return 'recovered'
    })

    const promise = withRetry(fn, 3, 0)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('calls onRetry callback before sleeping', async () => {
    const err429 = Object.assign(new Error('Rate limited'), { status: 429 })
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls === 1) throw err429
      return 'ok'
    })
    const onRetry = vi.fn()

    const promise = withRetry(fn, 3, 0, onRetry)
    await vi.runAllTimersAsync()
    await promise

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, 0)
  })

  it('respects Retry-After header', async () => {
    const err429 = Object.assign(new Error('Rate limited'), {
      status: 429,
      response: { headers: { 'retry-after': '5' } },
    })
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls === 1) throw err429
      return 'ok'
    })
    const onRetry = vi.fn()

    const promise = withRetry(fn, 3, 1000, onRetry)
    await vi.runAllTimersAsync()
    await promise

    // delay should be 5000ms (from Retry-After: 5)
    expect(onRetry).toHaveBeenCalledWith(1, 5000)
  })
})
