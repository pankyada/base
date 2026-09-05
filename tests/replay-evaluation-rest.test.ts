import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createRestHandler } from '../src/server/rest.js'
import { newJournal, recordEvent } from '../src/replay/index.js'
import { ReplayStore } from '../src/replay/store.js'
import { createDataset, EvaluationStore } from '../src/evaluation/index.js'
import { userPaths } from '../src/session/user-paths.js'

describe('replay and evaluation REST entrypoints', () => {
  let base = ''; let server: ReturnType<typeof createServer>; const user = `rest-user-${process.pid}-${Date.now()}`
  beforeAll(async () => {
    const journal = newJournal({ user, session_id: 's', profile: 'fixture', config_fingerprint: 'c', mode: 'fixture' }); recordEvent(journal, 'result', 'done'); new ReplayStore(user).save(journal)
    const dataset = createDataset('fixture', [{ input: 'x', fixture_refs: [], expected: { ok: true }, split: 'development' }]); new EvaluationStore(user).saveDataset(dataset)
    const profile = { name: 'fixture', artifact_dir: '/tmp/fixture' } as any
    const runStore = { create: vi.fn(), update: vi.fn(), get: vi.fn(), list: vi.fn().mockReturnValue([]), scanRunning: vi.fn().mockReturnValue([]) } as any
    const handler = createRestHandler({ defaultProfile: profile, runStore, abortRegistry: new Map(), skills: [] }); server = createServer((req, res) => { void handler(req, res) }); await new Promise<void>(resolve => server.listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; resolve() }))
  })
  afterAll(() => { server.close(); rmSync(userPaths(user, '').evaluationsDir, { recursive: true, force: true }); rmSync(userPaths(user, '').artifactsDir, { recursive: true, force: true }); rmSync(join(process.env.HOME ?? '', '.harness', 'replays', user), { recursive: true, force: true }) })

  it('replays persisted journal and runs persisted fixture dataset', async () => {
    const replay = await fetch(`${base}/replay?user=${user}`); const journals = (await replay.json()).journals; expect(journals).toHaveLength(1)
    const played = await fetch(`${base}/replay/${journals[0].id}/playback?user=${user}`, { method: 'POST' }); expect((await played.json()).events).toHaveLength(1)
    const listed = await fetch(`${base}/evaluations?user=${user}`); const dataset = (await listed.json()).datasets[0]; expect(dataset.cases).toHaveLength(1)
    const run = await fetch(`${base}/evaluations/${dataset.id}/run?user=${user}`, { method: 'POST' }); expect(run.status).toBe(201); expect((await run.json()).run.status).toBe('completed')
    const createdCorrection = await fetch(`${base}/corrections?user=${user}`, { method: 'POST', body: JSON.stringify({ scope: 'skill/demo', source_mission_id: 'm', before: 'old', after: 'new', regression_case_ids: ['c'] }) }); expect(createdCorrection.status).toBe(201); const correction = (await createdCorrection.json()).proposal
    const evaluated = await fetch(`${base}/corrections/${correction.id}/evaluate?user=${user}`, { method: 'POST', body: JSON.stringify({ passed: true, complete: true }) }); expect((await evaluated.json()).proposal.status).toBe('passed')
    const promoted = await fetch(`${base}/corrections/${correction.id}/promote?user=${user}`, { method: 'POST', body: JSON.stringify({ current: 'old' }) }); expect((await promoted.json()).proposal.status).toBe('promoted')
  })
})
