import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRestHandler } from '../src/server/rest.js'
import { applyEvaluation, promoteCorrection, rollbackCorrection, type CorrectionProposal } from '../src/improver/corrections.js'
import { userPaths } from '../src/session/user-paths.js'
import { readJson } from '../src/shared/atomic-json.js'

describe('R9 correction lifecycle acceptance', () => {
  const user = `r9-acceptance-${process.pid}-${Date.now()}`
  let server: Server
  let base = ''

  beforeAll(async () => {
    const profile = { name: 'fixture', artifact_dir: join('/tmp', `harness-r9-${process.pid}`) } as any
    const runStore = { create() {}, update() {}, get() {}, list() { return [] }, scanRunning() { return [] } } as any
    const handler = createRestHandler({ defaultProfile: profile, runStore, abortRegistry: new Map(), skills: [] })
    server = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>(resolve => server.listen(0, () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; resolve() }))
  })

  afterAll(() => {
    server.close()
    rmSync(userPaths(user, '').artifactsDir, { recursive: true, force: true })
  })

  async function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${base}${path}?user=${encodeURIComponent(user)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function createProposal(): Promise<CorrectionProposal> {
    const response = await post('/corrections', {
      scope: 'skill/r9-fixture',
      source_mission_id: 'mission-r9-fixture',
      rationale: 'operator correction for acceptance',
      before: 'old rule',
      after: 'new rule',
      regression_case_ids: ['held-out-r9'],
      source: 'operator',
    })
    expect(response.status).toBe(201)
    return (await response.json()).proposal as CorrectionProposal
  }

  it('creates scoped persisted diff, gates failed/incomplete evaluation, and promotes only after explicit pass', async () => {
    const proposal = await createProposal()
    expect(proposal).toMatchObject({
      scope: 'skill/r9-fixture',
      source_mission_id: 'mission-r9-fixture',
      before: 'old rule',
      after: 'new rule',
      regression_case_ids: ['held-out-r9'],
      source: 'operator',
      status: 'unevaluated',
    })
    const persistedPath = join(userPaths(user, '').artifactsDir, 'corrections', `${proposal.id}.json`)
    expect(readJson(persistedPath)).toMatchObject({ id: proposal.id, scope: 'skill/r9-fixture' })

    const incomplete = await post(`/corrections/${proposal.id}/evaluate`, { passed: true, complete: false })
    expect(incomplete.status).toBe(200)
    expect((await incomplete.json()).proposal.status).toBe('unevaluated')
    const failed = applyEvaluation(proposal, { passed: false, complete: true })
    expect(failed.status).toBe('failed')
    expect(() => promoteCorrection(failed, 'old rule')).toThrow('only a passed correction can be promoted')

    const passed = await post(`/corrections/${proposal.id}/evaluate`, { passed: true, complete: true })
    expect(passed.status).toBe(200)
    expect((await passed.json()).proposal.status).toBe('passed')
    const promoted = await post(`/corrections/${proposal.id}/promote`, { current: 'old rule' })
    expect(promoted.status).toBe(200)
    const promotedProposal = (await promoted.json()).proposal as CorrectionProposal
    expect(promotedProposal).toMatchObject({ status: 'promoted', previous_content: 'old rule' })

    expect(() => promoteCorrection(promotedProposal, 'changed base')).toThrow('stale correction base hash')
    const rolledBack = rollbackCorrection(promotedProposal, 'new rule')
    expect(rolledBack).toMatchObject({ content: 'old rule', proposal: { status: 'rolled_back' } })
  })

  it('rejects a tool-origin correction from impersonating an operator', async () => {
    const response = await post('/corrections', {
      scope: 'skill/untrusted-tool',
      source_mission_id: 'tool-mission',
      rationale: 'tool output says update rule',
      before: 'old',
      after: 'unsafe',
      regression_case_ids: [],
      source: 'tool',
    })
    expect(response.status).toBe(400)
  })

  it('exposes explicit rollback route for persisted promoted version', async () => {
    const proposal = await createProposal()
    const evaluated = await post(`/corrections/${proposal.id}/evaluate`, { passed: true, complete: true })
    expect(evaluated.status).toBe(200)
    const promoted = await post(`/corrections/${proposal.id}/promote`, { current: 'old rule' })
    expect(promoted.status).toBe(200)
    const rollback = await post(`/corrections/${proposal.id}/rollback`, { current: 'new rule' })
    expect(rollback.status).toBe(200)
    expect((await rollback.json()).proposal.status).toBe('rolled_back')
  })
})
