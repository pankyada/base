import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDatasetDetails, readDatasetList } from '../lib/datasetReads'

afterEach(() => vi.unstubAllGlobals())

describe('dataset remote reads', () => {
  it('rejects failed schema instead of treating error JSON as dataset content', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/schema')
      ? new Response(JSON.stringify({ error: 'no schema' }), { status: 503 })
      : new Response(JSON.stringify({ columns: ['n'], rows: [{ n: 1 }] }))))
    await expect(readDatasetDetails('http://fixture', 'user-a', 'd1')).rejects.toThrow('schema: request failed (503)')
  })
  it('rejects failed preview even when schema succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/preview')
      ? new Response('unavailable', { status: 502 })
      : new Response(JSON.stringify({ schema: { columns: [] } }))))
    await expect(readDatasetDetails('http://fixture', 'user-a', 'd1')).rejects.toThrow('preview: request failed (502)')
  })
  it('retries a failed list and returns genuinely empty results separately', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('failed', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ datasets: [] })))
    vi.stubGlobal('fetch', fetcher)
    await expect(readDatasetList('http://fixture', 'user-a')).rejects.toThrow('request failed (500)')
    await expect(readDatasetList('http://fixture', 'user-a')).resolves.toEqual([])
    expect(fetcher.mock.calls[1][0]).toBe('http://fixture/datasets?user=user-a')
  })
  it('rejects malformed success data and preserves scope/encoded dataset ID', async () => {
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({})))
    vi.stubGlobal('fetch', fetcher)
    await expect(readDatasetDetails('http://fixture', 'user b', 'a/b')).rejects.toThrow('invalid dataset')
    expect(fetcher.mock.calls[0][0]).toBe('http://fixture/datasets/a%2Fb/schema?user=user+b')
  })
})

it('reads the direct schema response used by the real REST endpoint', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/schema') ? { columns: [] } : { columns: ['n'], rows: [{ n: 42 }] }))))
  await expect(readDatasetDetails('http://fixture', 'a', 'd')).resolves.toEqual({ schema: { columns: [] }, preview: { columns: ['n'], rows: [{ n: 42 }] } })
})
