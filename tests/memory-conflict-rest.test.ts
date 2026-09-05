import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createRestHandler } from '../src/server/rest.js'
import { userPaths } from '../src/session/user-paths.js'

describe('memory conflict REST desk', () => {
  const user = `memory-rest-${process.pid}-${Date.now()}`
  let server: ReturnType<typeof createServer>
  let base = ''
  beforeAll(async () => {
    const handler = createRestHandler({ defaultProfile: { name: 'fixture', artifact_dir: '/tmp/fixture' } as any, runStore: { create() {}, update() {}, get() { return null }, list() { return [] }, scanRunning() { return [] } } as any, abortRegistry: new Map(), skills: [] })
    server = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>(resolve => server.listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; resolve() }))
  })
  afterAll(() => { server.close(); rmSync(userPaths(user, '').privateMemDir, { recursive: true, force: true }) })

  it('persists conflict, rejects stale resolution, and isolates users', async () => {
    const entries = [
      { key: 'city-a', preview: 'Sydney', claim: { entity: 'user', predicate: 'city', normalized_value: 'Sydney', source_evidence: ['receipt-a'] }, temporal: { valid_from: '2026-01-01T00:00:00Z', valid_until: '2026-12-31T00:00:00Z' } },
      { key: 'city-b', preview: 'Melbourne', claim: { entity: 'user', predicate: 'city', normalized_value: 'Melbourne', source_evidence: ['receipt-b'] }, temporal: { valid_from: '2026-02-01T00:00:00Z', valid_until: '2026-11-01T00:00:00Z' } },
    ]
    const missionResponse = await fetch(`${base}/missions`, { method: 'POST', body: JSON.stringify({ user, profile: 'fixture', project: 'inbox', outcome: 'verify memory', criteria: [{ id: 'memory', description: 'memory claim', kind: 'tool_result_match', expected: 'ok', state: 'verified' }] }) })
    const mission = (await missionResponse.json()).mission
    const detected = await fetch(`${base}/memory/conflicts/detect`, { method: 'POST', body: JSON.stringify({ user, scope: 'user', entries, dependent_missions: [mission.id] }) })
    expect(detected.status).toBe(201)
    const conflict = (await detected.json()).conflicts[0]
    expect(conflict.state).toBe('open')
    expect((await (await fetch(`${base}/memory/conflicts?user=${user}`)).json()).conflicts).toHaveLength(1)
    const stale = await fetch(`${base}/memory/conflicts/${conflict.id}/resolve`, { method: 'POST', body: JSON.stringify({ user, revision: 0, chosen_key: 'city-a' }) })
    expect(stale.status).toBe(409)
    const resolved = await fetch(`${base}/memory/conflicts/${conflict.id}/resolve`, { method: 'POST', body: JSON.stringify({ user, revision: 1, chosen_key: 'city-a', reason: 'latest receipt' })
    })
    expect(resolved.status).toBe(200)
    expect((await resolved.json()).conflict.state).toBe('superseded')
    const missionAfter = (await (await fetch(`${base}/missions/${mission.id}?user=${user}`)).json()).mission
    expect(missionAfter.status).toBe('needs_human')
    expect(missionAfter.criteria[0].state).toBe('needs_human')
    expect((await (await fetch(`${base}/memory/conflicts?user=other`)).json()).conflicts).toHaveLength(0)
  })
})
