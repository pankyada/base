import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PendingStore } from '../src/runs/pending.js'
import { createRestHandler } from '../src/server/rest.js'
import { createReadApiHandler } from '../src/server/read-api.js'
import { normalizeUserScope } from '../src/server/scope.js'

const profile = { name: 'fixture', model: { base_url: 'https://example.test/v1', api_key_env: 'KEY', id: 'fixture' } } as any
function run(id: string, user: string, status: any = 'waiting_input') { return { id, user, profile: 'fixture', status, started_at: '2026-09-07T00:00:00.000Z', updated_at: '2026-09-07T00:00:00.000Z' } as any }
function request(server: ReturnType<typeof createServer>, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise(resolve => {
    const address = server.address() as any
    const req = fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    void req.then(async response => resolve({ status: response.status, json: await response.json() }))
  })
}

describe('Core request scope', () => {
  it('rejects non-string and oversized explicit scope before sanitization', () => {
    expect(() => normalizeUserScope(42)).toThrow('invalid user scope')
    expect(() => normalizeUserScope('x'.repeat(257))).toThrow('invalid user scope')
  })

  it('enforces explicit scope on run reads and cancellation without leaking or mutating', async () => {
    const runs = new Map([['r1', run('r1', 'alice')]])
    const runStore: any = { get: (id: string) => runs.get(id) ?? null, list: () => [...runs.values()], update: (id: string, patch: any) => runs.set(id, { ...runs.get(id), ...patch }), create() {}, scanRunning: () => [] }
    const handler = createRestHandler({ defaultProfile: profile, runStore, abortRegistry: new Map(), skills: [] })
    const server = createServer((req, res) => void handler(req, res)); await new Promise<void>(resolve => server.listen(0, resolve))
    try {
      expect((await request(server, 'GET', '/runs/r1?user=bob')).status).toBe(404)
      expect((await request(server, 'DELETE', '/runs/r1?user=bob')).status).toBe(404)
      expect(runs.get('r1')?.status).toBe('waiting_input')
      expect((await request(server, 'GET', '/runs/r1?user=alice')).status).toBe(200)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('rejects contradictory answer scopes and wrong-scope pending actions', async () => {
    const pendingRoot = mkdtempSync(join(tmpdir(), 'core-uplift-scope-'))
    const pendingStore = new PendingStore(pendingRoot)
    pendingStore.create({ id: 'p1', run_id: 'r1', session_id: 's1', user: 'alice', profile: 'fixture', prompt: 'Pick', kind: 'select', options: ['yes'], created_at: '2026-09-07T00:00:00.000Z', expires_at: '2099-09-07T00:00:00.000Z' })
    const runStore: any = { get: (id: string) => id === 'r1' ? run('r1', 'alice') : null, list: () => [], update() {}, create() {}, scanRunning: () => [] }
    const handler = createRestHandler({ defaultProfile: profile, runStore, pendingStore, abortRegistry: new Map(), skills: [] })
    const server = createServer((req, res) => void handler(req, res)); await new Promise<void>(resolve => server.listen(0, resolve))
    try {
      expect((await request(server, 'POST', '/runs/r1/input?user=alice', { user: 'bob', pending_id: 'p1', value: 'yes' })).status).toBe(400)
      expect((await request(server, 'POST', '/runs/r1/input?user=bob', { pending_id: 'p1', value: 'yes' })).status).toBe(404)
      expect(pendingStore.get('p1')?.state).toBe('open')
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(pendingRoot, { recursive: true, force: true }) }
  })

  it('rejects null and array request bodies at Core boundaries', async () => {
    const runStore: any = { get: () => null, list: () => [], update() {}, create() {}, scanRunning: () => [] }
    const handler = createRestHandler({ defaultProfile: profile, runStore, abortRegistry: new Map(), skills: [] })
    const server = createServer((req, res) => void handler(req, res)); await new Promise<void>(resolve => server.listen(0, resolve))
    try {
      expect((await request(server, 'POST', '/run', null)).status).toBe(400)
      expect((await request(server, 'POST', '/runs/r1/input', [])).status).toBe(400)
      expect((await request(server, 'POST', '/run?user=alice', { user: 'bob', input: 'x' })).status).toBe(400)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('rejects unknown explicit profile on read API instead of falling back', async () => {
    const handler = createReadApiHandler({ defaultProfile: profile, profiles: new Map([['fixture', profile]]), memoryFor: () => ({ list: async () => [], query: async () => [] }) as any })
    const server = createServer((req, res) => void handler(req, res)); await new Promise<void>(resolve => server.listen(0, resolve))
    try {
      const address = server.address() as any
      expect((await fetch(`http://127.0.0.1:${address.port}/memory?profile=missing`)).status).toBe(404)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('enforces profile/session relationship on scoped read routes', async () => {
    const handler = createReadApiHandler({
      defaultProfile: profile,
      profiles: new Map([['fixture', profile], ['other', { ...profile, name: 'other' }]]),
      loadSession: (_user, id) => id === 's1' ? ({ id: 's1', user: 'alice', profile: 'fixture', messages: [], tool_calls: [] }) as any : null,
      memoryFor: () => ({ list: async () => [], query: async () => [] }) as any,
    })
    const server = createServer((req, res) => void handler(req, res)); await new Promise<void>(resolve => server.listen(0, resolve))
    try {
      const address = server.address() as any
      expect((await fetch(`http://127.0.0.1:${address.port}/sessions/s1/messages?user=alice&profile=other`)).status).toBe(404)
      expect((await fetch(`http://127.0.0.1:${address.port}/memory?user=alice&scope=session&session=missing`)).status).toBe(404)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('rejects contradictory mission query/body scope', async () => {
    const handler = createRestHandler({ defaultProfile: profile, runStore: { get: () => null, list: () => [], update() {}, create() {}, scanRunning: () => [] } as any, abortRegistry: new Map(), skills: [] })
    const server = createServer((req, res) => void handler(req, res)); await new Promise<void>(resolve => server.listen(0, resolve))
    try {
      const address = server.address() as any
      const response = await fetch(`http://127.0.0.1:${address.port}/missions?user=alice`, { method: 'POST', body: JSON.stringify({ user: 'bob', profile: 'fixture', project: 'inbox', outcome: 'x', criteria: [] }) })
      expect(response.status).toBe(400)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('rejects empty list scopes instead of broadening to aggregate results', async () => {
    const handler = createRestHandler({ defaultProfile: profile, runStore: { get: () => null, list: () => [], update() {}, create() {}, scanRunning: () => [] } as any, abortRegistry: new Map(), skills: [] })
    const server = createServer((req, res) => void handler(req, res)); await new Promise<void>(resolve => server.listen(0, resolve))
    try {
      const address = server.address() as any
      expect((await fetch(`http://127.0.0.1:${address.port}/runs?user=`)).status).toBe(400)
      expect((await fetch(`http://127.0.0.1:${address.port}/pending?user=`)).status).toBe(400)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('keeps run and pending list routes bound to the requested user', async () => {
    const pendingRoot = mkdtempSync(join(tmpdir(), 'core-uplift-list-'))
    const pendingStore = new PendingStore(pendingRoot)
    pendingStore.create({ id: 'pa', run_id: 'ra', session_id: 'sa', user: 'alice', profile: 'fixture', prompt: 'Pick', kind: 'text', created_at: '2026-09-07T00:00:00.000Z', expires_at: '2099-09-07T00:00:00.000Z' })
    pendingStore.create({ id: 'pb', run_id: 'rb', session_id: 'sb', user: 'bob', profile: 'fixture', prompt: 'Pick', kind: 'text', created_at: '2026-09-07T00:00:00.000Z', expires_at: '2099-09-07T00:00:00.000Z' })
    const runs = [run('ra', 'alice'), run('rb', 'bob')]
    const runStore: any = { get: (id: string) => runs.find(item => item.id === id) ?? null, list: (options: any) => runs.filter(item => !options.user || item.user === options.user), update() {}, create() {}, scanRunning: () => [] }
    const handler = createRestHandler({ defaultProfile: profile, runStore, pendingStore, abortRegistry: new Map(), skills: [] })
    const server = createServer((req, res) => void handler(req, res)); await new Promise<void>(resolve => server.listen(0, resolve))
    try {
      const address = server.address() as any
      const runResponse = await request(server, 'GET', '/runs?user=alice')
      expect(runResponse.status).toBe(200); expect(runResponse.json.runs.map((item: any) => item.user)).toEqual(['alice'])
      const pendingResponse = await request(server, 'GET', '/pending?user=alice')
      expect(pendingResponse.status).toBe(200); expect(pendingResponse.json.pending.map((item: any) => item.user)).toEqual(['alice'])
      expect((await fetch(`http://127.0.0.1:${address.port}/runs?user=bob`)).status).toBe(200)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(pendingRoot, { recursive: true, force: true }) }
  })
})
