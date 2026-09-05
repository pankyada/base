import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createRestHandler } from '../src/server/rest.js'
import type { Profile } from '../src/profiles/schema.js'

describe('mission REST entrypoints', () => {
  let base = ''; let server: ReturnType<typeof createServer>; const oldHome = process.env.HOME
  beforeAll(async () => { process.env.HOME = mkdtempSync(join(tmpdir(), 'harness-mission-rest-')); const profile = { name: 'fixture', artifact_dir: '/tmp/fixture' } as unknown as Profile; const runStore = { create: vi.fn(), update: vi.fn(), get: vi.fn(), list: vi.fn().mockReturnValue([]), scanRunning: vi.fn().mockReturnValue([]) } as any; const handler = createRestHandler({ defaultProfile: profile, runStore, abortRegistry: new Map(), skills: [] }); server = createServer((req, res) => { void handler(req, res) }); await new Promise<void>(resolve => server.listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; resolve() })) })
  afterAll(() => { server.close(); if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome })
  it('creates, lists, reads and explicitly completes human criterion', async () => {
    const created = await fetch(`${base}/missions`, { method: 'POST', body: JSON.stringify({ user: 'rest-user', profile: 'fixture', project: 'inbox', outcome: 'ship', constraints: [], criteria: [{ id: 'human', description: 'operator accepts', kind: 'human' }] }) }); expect(created.status).toBe(201); const body = await created.json(); expect(body.mission.status).toBe('open'); const missionId = body.mission.id
    const listed = await fetch(`${base}/missions?user=rest-user`); expect((await listed.json()).missions).toHaveLength(1)
    const completed = await fetch(`${base}/missions/${missionId}/human`, { method: 'POST', body: JSON.stringify({ user: 'rest-user', criterion_id: 'human', revision: 1 }) }); expect(completed.status).toBe(200); expect((await completed.json()).mission.status).toBe('accepted')
    const read = await fetch(`${base}/missions/${missionId}?user=rest-user`); expect((await read.json()).mission.criteria[0].state).toBe('verified')
  })
})
