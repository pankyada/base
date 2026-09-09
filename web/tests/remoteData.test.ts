import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fetchRemote, fetchScopedRemote, fetchBatch, batchHasFailure, batchFailureReasons, remoteOr, defaultIsEmpty } from '../lib/remoteData'

function mockFetchOnce(impl: () => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

describe('remoteData', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('a rejected fetch yields failed, not empty', async () => {
    mockFetchOnce(() => Promise.reject(new Error('network down')))
    const result = await fetchRemote('http://x/y')
    expect(result).toEqual({ status: 'failed', reason: 'network down' })
  })

  it('a non-ok HTTP status yields failed with the status in the reason', async () => {
    mockFetchOnce(() => new Response(JSON.stringify({ pending: [] }), { status: 500 }))
    const result = await fetchRemote('http://x/y')
    expect(result.status).toBe('failed')
    expect((result as { reason: string }).reason).toContain('500')
  })

  it('an empty successful body yields empty, distinct from failed', async () => {
    mockFetchOnce(() => new Response(JSON.stringify([]), { status: 200 }))
    const result = await fetchRemote('http://x/y')
    expect(result).toEqual({ status: 'empty' })
  })

  it('a non-empty successful body yields ready with the data', async () => {
    mockFetchOnce(() => new Response(JSON.stringify({ pending: [{ id: '1' }] }), { status: 200 }))
    const result = await fetchRemote<{ pending: unknown[] }>('http://x/y')
    expect(result).toEqual({ status: 'ready', data: { pending: [{ id: '1' }] } })
  })

  it('defaultIsEmpty treats an empty array/object as empty and other values as data', () => {
    expect(defaultIsEmpty([])).toBe(true)
    expect(defaultIsEmpty({})).toBe(true)
    expect(defaultIsEmpty([1])).toBe(false)
    expect(defaultIsEmpty({ a: 1 })).toBe(false)
    expect(defaultIsEmpty(0)).toBe(false)
  })

  it('a stale-scope response is discarded even though the fetch itself succeeded', async () => {
    mockFetchOnce(() => new Response(JSON.stringify({ a: 1 }), { status: 200 }))
    let current = { userId: 'user-a' }
    const promise = fetchScopedRemote('http://x', '/thing', { userId: 'user-a' }, () => current)
    current = { userId: 'user-b' } // scope switches while the request is in flight
    const result = await promise
    expect(result).toBe('stale')
  })

  it('a same-scope response is returned normally', async () => {
    mockFetchOnce(() => new Response(JSON.stringify({ a: 1 }), { status: 200 }))
    const scope = { userId: 'user-a' }
    const result = await fetchScopedRemote('http://x', '/thing', scope, () => scope)
    expect(result).toEqual({ status: 'ready', data: { a: 1 } })
  })

  // Regression: a route whose URL legitimately omits `profile` (urlScope narrower than the ambient
  // scope) must not be judged stale just because the ambient `profile` differs from what the URL
  // carried -- staleness has to compare the full ambient scope, not the truncated URL scope. Before
  // the fix, passing the truncated object as both the URL scope AND the staleness-comparison scope
  // meant this exact case (profile arrives on the ambient scope after the request went out, while the
  // request's own ambient scope never actually changed) was permanently discarded as 'stale'.
  it('a route whose URL omits profile is not marked stale when the ambient profile is set', async () => {
    mockFetchOnce(() => new Response(JSON.stringify({ a: 1 }), { status: 200 }))
    const ambientScope = { userId: 'user-a', profile: 'coding' }
    const result = await fetchScopedRemote('http://x', '/thing', ambientScope, () => ambientScope, { urlScope: { userId: ambientScope.userId } })
    expect(result).not.toBe('stale')
    expect(result).toEqual({ status: 'ready', data: { a: 1 } })
  })

  it('a route whose URL omits profile is not marked stale when the profile arrives mid-flight (no real ambient scope change)', async () => {
    mockFetchOnce(() => new Response(JSON.stringify({ a: 1 }), { status: 200 }))
    let ambient = { userId: 'user-a', profile: undefined as string | undefined }
    const requestedScope = { ...ambient }
    const promise = fetchScopedRemote('http://x', '/thing', requestedScope, () => ambient, { urlScope: { userId: requestedScope.userId } })
    ambient = { userId: 'user-a', profile: 'coding' } // profile lands from session_ready while the request is in flight -- but the request's OWN ambient scope (captured at fetch time) never changed, so this must not be treated as a scope switch.
    const result = await promise
    expect(result).not.toBe('stale')
  })

  it('a genuine identity switch mid-flight is still discarded even when the URL omits profile', async () => {
    mockFetchOnce(() => new Response(JSON.stringify({ a: 1 }), { status: 200 }))
    let ambient = { userId: 'user-a', profile: 'coding' }
    const requestedScope = { ...ambient }
    const promise = fetchScopedRemote('http://x', '/thing', requestedScope, () => ambient, { urlScope: { userId: requestedScope.userId } })
    ambient = { userId: 'user-b', profile: 'coding' } // real identity switch
    const result = await promise
    expect(result).toBe('stale')
  })

  it('a profile switch mid-flight does NOT discard a route whose URL omits profile -- the route never depended on it', async () => {
    mockFetchOnce(() => new Response(JSON.stringify({ a: 1 }), { status: 200 }))
    let ambient = { userId: 'user-a', profile: 'coding' }
    const requestedScope = { ...ambient }
    const promise = fetchScopedRemote('http://x', '/thing', requestedScope, () => ambient, { urlScope: { userId: requestedScope.userId } })
    ambient = { userId: 'user-a', profile: 'data' } // profile switch, irrelevant to this route's URL scope
    const result = await promise
    expect(result).not.toBe('stale')
  })

  it('a genuine profile switch mid-flight IS discarded for a route whose URL carries profile', async () => {
    mockFetchOnce(() => new Response(JSON.stringify({ a: 1 }), { status: 200 }))
    let ambient = { userId: 'user-a', profile: 'coding' }
    const requestedScope = { ...ambient }
    const promise = fetchScopedRemote('http://x', '/thing', requestedScope, () => ambient) // urlScope defaults to the full ambient scope, so profile is relevant here
    ambient = { userId: 'user-a', profile: 'data' } // real profile switch
    const result = await promise
    expect(result).toBe('stale')
  })

  it('a partial batch reports per-part success and failure independently', async () => {
    const batch = await fetchBatch({
      metrics: () => Promise.resolve({ status: 'ready' as const, data: { m: 1 } }),
      usage: () => Promise.reject(new Error('usage down')),
      routing: () => Promise.resolve({ status: 'empty' as const }),
    })
    expect(batch.metrics).toEqual({ status: 'ready', data: { m: 1 } })
    expect(batch.usage).toEqual({ status: 'failed', reason: 'usage down' })
    expect(batch.routing).toEqual({ status: 'empty' })
    expect(batchHasFailure(batch)).toBe(true)
  })

  it('a batch with no failures reports batchHasFailure false', async () => {
    const batch = await fetchBatch({ a: () => Promise.resolve({ status: 'empty' as const }) })
    expect(batchHasFailure(batch)).toBe(false)
  })

  it('retry re-issues the read and can succeed after a prior failure', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('first attempt down'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await fetchRemote('http://x/y')
    expect(first.status).toBe('failed')
    const second = await fetchRemote('http://x/y') // simulates the user pressing "retry"
    expect(second).toEqual({ status: 'ready', data: { ok: true } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('batchFailureReasons names only the failed parts', async () => {
    const batch = await fetchBatch({
      metrics: () => Promise.resolve({ status: 'ready' as const, data: {} }),
      usage: () => Promise.reject(new Error('usage down')),
    })
    expect(batchFailureReasons(batch)).toEqual(['usage: usage down'])
  })

  it('remoteOr returns the data only when ready, and the fallback for loading/empty/failed', () => {
    expect(remoteOr({ status: 'ready', data: [1] }, [])).toEqual([1])
    expect(remoteOr({ status: 'empty' }, ['fallback'])).toEqual(['fallback'])
    expect(remoteOr({ status: 'failed', reason: 'x' }, ['fallback'])).toEqual(['fallback'])
    expect(remoteOr({ status: 'loading' }, ['fallback'])).toEqual(['fallback'])
  })
})
