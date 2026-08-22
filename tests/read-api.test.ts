import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createReadApiHandler, decodeCursor, encodeCursor } from '../src/server/read-api.js'
import { createRestHandler } from '../src/server/rest.js'
import { DatasetStore } from '../src/datasets/store.js'

const profile = { name: 'test', artifact_dir: '/tmp/test', triggers: { cron: '0 8 * * *', watch: [{ name: 'watch', path: '/tmp' }], poll: [{ name: 'poll', every: '5m', probe: { tool: 'Read' }, cursor_path: 'id' }] } } as any

describe('read API routes', () => {
  let server: ReturnType<typeof createServer>
  let base: string
  let deletedDataset: string | undefined

  beforeAll(async () => {
    const handler = createReadApiHandler({
      defaultProfile: profile,
      queryEvents: () => [{ ts: '2026-08-16T00:00:00Z', session: 's1', profile: 'test', kind: 'tool', name: 'Read', ok: true, duration_ms: 10 }],
      readUsage: user => ({ user, total: { input: 1, output: 2, cost_usd: 0.3 }, by_month: { '2026-08': { input: 1, output: 2, cost_usd: 0.3 } }, updated_at: '2026-08-16T00:00:00Z' }),
      listAudit: () => [{ id: 'a1', ts: '2026-08-16T00:00:00Z', session_id: 's1', user: 'u', profile: 'test', tool: 'Write', input_digest: 'digest', effect: 'write', decision: 'prompt', decided_by: 'human', decided_reason: 'asked', tainted: true, ok: true }],
      memoryFor: () => ({ list: async () => [{ key: 'fact', preview: 'fact', content: 'fact' }], query: async () => [{ key: 'fact', preview: 'fact', content: 'fact' }] }) as any,
      loadSession: (_user, id) => id === 's1' ? ({ id: 's1', messages: [{ role: 'user', content: 'hello' }], tool_calls: [] }) as any : null,
      datasetStore: { list: () => [{ id: 'd1', name: 'data', bytes: 1 }], upload: () => ({ id: 'd1' }), schema: () => ({ columns: [] }), preview: () => ({ columns: [], rows: [] }), delete: (_user: string, id: string) => { deletedDataset = id } } as any,
    })
    server = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>(resolve => server.listen(0, resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

  it('returns all read resources with defined empty-safe shapes', async () => {
    expect((await fetch(`${base}/metrics`)).status).toBe(200)
    expect(await (await fetch(`${base}/usage?user=u`)).json()).toMatchObject({ user: 'u', months: [{ month: '2026-08' }] })
    expect(await (await fetch(`${base}/audit?tainted=true`)).json()).toMatchObject({ entries: [expect.objectContaining({ id: 'a1', undo: false })] })
    expect(await (await fetch(`${base}/memory?scope=user`)).json()).toMatchObject({ entries: [{ key: 'fact' }] })
    expect(await (await fetch(`${base}/datasets`)).json()).toMatchObject({ datasets: [{ id: 'd1' }] })
    expect(await (await fetch(`${base}/triggers`)).json()).toMatchObject({ triggers: [expect.objectContaining({ name: 'cron', kind: 'cron' }), expect.objectContaining({ name: 'watch', kind: 'watch' }), expect.objectContaining({ name: 'poll', kind: 'poll' })] })
    expect(await (await fetch(`${base}/sessions/s1/messages`)).json()).toMatchObject({ messages: [{ role: 'user', content: 'hello' }] })
    expect((await fetch(`${base}/stats/routing`)).status).toBe(200)
  })

  it('accepts the single dataset write route as multipart data', async () => {
    const boundary = 'test-boundary'
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="data.csv"\r\nContent-Type: text/csv\r\n\r\na\n1\n\r\n--${boundary}--\r\n`
    const response = await fetch(`${base}/datasets?user=u`, { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ id: 'd1' })
  })

  it('deletes a dataset through the dataset route', async () => {
    const response = await fetch(`${base}/datasets/d1?user=u`, { method: 'DELETE' })
    expect(response.status).toBe(204)
    expect(deletedDataset).toBe('d1')
  })

  it('enforces dataset DELETE ownership and returns 404 for unknown ids over HTTP', async () => {
    const root = mkdtempSync(join(tmpdir(), 'read-api-datasets-'))
    const datasets = new DatasetStore(root)
    const saved = datasets.upload('alice', { filename: 'data.csv', content: Buffer.from('a\n1\n') })
    const handler = createReadApiHandler({ defaultProfile: profile, datasetStore: datasets })
    const datasetServer = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>(resolve => datasetServer.listen(0, resolve))
    const base = `http://127.0.0.1:${(datasetServer.address() as AddressInfo).port}`

    try {
      expect((await fetch(`${base}/datasets/${saved.id}?user=bob`, { method: 'DELETE' })).status).toBe(404)
      expect((await fetch(`${base}/datasets/does-not-exist?user=alice`, { method: 'DELETE' })).status).toBe(404)
      expect((await fetch(`${base}/datasets/${saved.id}?user=alice`, { method: 'DELETE' })).status).toBe(204)
    } finally {
      await new Promise<void>(resolve => datasetServer.close(() => resolve()))
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not handle memory writes in the read API', async () => {
    const readHandler = createReadApiHandler({ defaultProfile: profile })
    expect(await readHandler({ method: 'POST', url: '/memory', headers: {} } as any, {} as any)).toBe(false)
  })

  it('rejects bad parameters, clamps limits, and returns 404 for an unknown session', async () => {
    expect((await fetch(`${base}/metrics?since=nope`)).status).toBe(400)
    expect((await fetch(`${base}/sessions/missing/messages`)).status).toBe(404)
    expect((await fetch(`${base}/audit?limit=2000`)).headers.get('cache-control')).toBe('no-store')
  })

  it('round-trips opaque cursors', () => {
    expect(decodeCursor(encodeCursor({ file: 'a.jsonl', offset: 42 }))).toEqual({ file: 'a.jsonl', offset: 42 })
  })

  it('exposes channel binding status without channel configuration secrets', async () => {
    const handler = createRestHandler({
      defaultProfile: profile,
      runStore: {} as any,
      abortRegistry: new Map(),
      skills: [],
      channels: { statusForUser: () => [{ name: 'in', transport: 'test', binding: 'paired', capabilities: { text: true } }] },
    } as any)
    const channelServer = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>(resolve => channelServer.listen(0, resolve))
    const url = 'http://127.0.0.1:' + (channelServer.address() as AddressInfo).port + '/channels?user=u'
    expect(await (await fetch(url)).json()).toMatchObject({ channels: [{ name: 'in', binding: 'paired' }] })
    await new Promise<void>(resolve => channelServer.close(() => resolve()))
  })
})
