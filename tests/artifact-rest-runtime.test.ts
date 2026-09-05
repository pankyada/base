import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createRestHandler } from '../src/server/rest.js'
import { createArtifactGenerator } from '../src/artifacts/runtime.js'
import { clearRegistry, registerTool } from '../src/tools/registry.js'
import { RunStore } from '../src/runs/store.js'
import { userPaths } from '../src/session/user-paths.js'

const owned: string[] = []
afterEach(() => { for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true }) })

function start(handler: (req: any, res: any) => void): Promise<{ server: Server; base: string }> {
  return new Promise(resolve => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve({ server, base: `http://127.0.0.1:${address.port}` })
    })
  })
}

describe('REST stored artifact runtime', () => {
  it('refreshes from stored dependency and generator metadata, ignoring request payload', async () => {
    const owner = `artifact-rest-${randomUUID()}`
    const sourceRoot = mkdtempSync(join(tmpdir(), 'harness-artifact-rest-source-'))
    owned.push(sourceRoot, userPaths(owner, '').artifactsDir)
    const source = join(sourceRoot, 'fixture.json')
    writeFileSync(source, JSON.stringify({ value: 2 }), 'utf8')
    const profile = { name: 'fixture', working_dir: sourceRoot, artifact_dir: sourceRoot } as any
    const runStore = { create() {}, update() {}, get() { return null }, list() { return [] }, scanRunning() { return [] } } as unknown as RunStore
    const { server, base } = await start(createRestHandler({ defaultProfile: profile, runStore, abortRegistry: new Map(), skills: [] }))
    try {
      const create = await fetch(`${base}/artifacts?user=${owner}`, {
        method: 'POST',
        body: JSON.stringify({
          profile: 'fixture', generating_tool: 'fixture', code_ref: 'fixture.ts#render',
          parameters: { stored: true }, payload: { value: 1 }, source_dependencies: [`file:${source}`],
          session_id: 'session-real', tool_call_id: 'tool-real',
        }),
      })
      expect(create.status).toBe(201)
      const recipe = (await create.json()).recipe
      writeFileSync(source, JSON.stringify({ value: 3 }), 'utf8')
      const refresh = await fetch(`${base}/artifacts/${recipe.id}/refresh?user=${owner}`, { method: 'POST', body: JSON.stringify({ confirm: true }) })
      expect(refresh.status).toBe(200)
      const updated = (await refresh.json()).recipe
      expect(updated.last_good.payload).toEqual({ value: 3 })
      expect(updated.last_good.payload.evil).toBeUndefined()
      expect(updated.provenance).toMatchObject({ session_id: 'session-real', tool_call_id: 'tool-real' })
      const unchanged = await fetch(`${base}/artifacts/${recipe.id}/refresh?user=${owner}`, { method: 'POST', body: JSON.stringify({ confirm: true }) })
      expect((await unchanged.json()).recipe.versions).toHaveLength(2)
    } finally {
      server.close()
    }
  })

  it('requires confirmation and routes non-fixture recipes through the host generator executor', async () => {
    const owner = `artifact-rest-${randomUUID()}`
    const sourceRoot = mkdtempSync(join(tmpdir(), 'harness-artifact-rest-source-'))
    owned.push(sourceRoot, userPaths(owner, '').artifactsDir)
    const source = join(sourceRoot, 'fixture.json')
    writeFileSync(source, JSON.stringify({ value: 2 }), 'utf8')
    const profile = { name: 'fixture', working_dir: sourceRoot, artifact_dir: sourceRoot, model: { id: 'fixture-model', base_url: 'http://127.0.0.1:1/v1', api_key_env: 'HARNESS_ARTIFACT_TEST_KEY' }, tools: { builtin: { ReportGenerator: 'allow' } }, safety: { enabled: false } } as any
    const runStore = { create() {}, update() {}, get() { return null }, list() { return [] }, scanRunning() { return [] } } as unknown as RunStore
    const generator = vi.fn(async (input: any, context: any) => { expect(input).toEqual({ value: 3 }); expect(context.approvalMode).toBe('danger'); return JSON.stringify({ generated: input.value + 1 }) })
    process.env.HARNESS_ARTIFACT_TEST_KEY = 'test-key'
    registerTool({ name: 'ReportGenerator', description: 'test generator', parameters: { type: 'object' }, execute: generator })
    const { server, base } = await start(createRestHandler({ defaultProfile: profile, runStore, abortRegistry: new Map(), skills: [], artifactGenerator: createArtifactGenerator([]) }))
    try {
      const create = await fetch(`${base}/artifacts?user=${owner}`, { method: 'POST', body: JSON.stringify({ profile: 'fixture', generating_tool: 'ReportGenerator', parameters: { value: 3 }, payload: { generated: 1 }, source_dependencies: [`file:${source}`] }) })
      const recipe = (await create.json()).recipe
      writeFileSync(source, JSON.stringify({ value: 3 }), 'utf8')
      const denied = await fetch(`${base}/artifacts/${recipe.id}/refresh?user=${owner}`, { method: 'POST', body: JSON.stringify({}) })
      expect(denied.status).toBe(409)
      expect(generator).not.toHaveBeenCalled()
      const refresh = await fetch(`${base}/artifacts/${recipe.id}/refresh?user=${owner}`, { method: 'POST', body: JSON.stringify({ confirm: true }) })
      expect(refresh.status).toBe(200)
      expect(generator).toHaveBeenCalledOnce()
      expect((await refresh.json()).recipe.last_good.payload).toEqual({ generated: 4 })
    } finally {
      server.close()
      clearRegistry()
      delete process.env.HARNESS_ARTIFACT_TEST_KEY
    }
  })

  it('rejects a stored non-fixture generator when no real executor is registered', async () => {
    const owner = `artifact-rest-${randomUUID()}`
    const sourceRoot = mkdtempSync(join(tmpdir(), 'harness-artifact-rest-source-'))
    owned.push(sourceRoot, userPaths(owner, '').artifactsDir)
    const source = join(sourceRoot, 'fixture.json')
    writeFileSync(source, JSON.stringify({ value: 2 }), 'utf8')
    const profile = { name: 'fixture', working_dir: sourceRoot, artifact_dir: sourceRoot } as any
    const runStore = { create() {}, update() {}, get() { return null }, list() { return [] }, scanRunning() { return [] } } as unknown as RunStore
    const { server, base } = await start(createRestHandler({ defaultProfile: profile, runStore, abortRegistry: new Map(), skills: [], artifactGenerator: createArtifactGenerator([]) }))
    try {
      const create = await fetch(`${base}/artifacts?user=${owner}`, { method: 'POST', body: JSON.stringify({ profile: 'fixture', generating_tool: 'Write', parameters: { path: '/tmp/out' }, payload: { value: 1 }, source_dependencies: [`file:${source}`] }) })
      const recipe = (await create.json()).recipe
      writeFileSync(source, JSON.stringify({ value: 3 }), 'utf8')
      const refresh = await fetch(`${base}/artifacts/${recipe.id}/refresh?user=${owner}`, { method: 'POST', body: JSON.stringify({ confirm: true }) })
      expect(refresh.status).toBe(200)
      const failed = (await refresh.json()).recipe
      expect(failed.freshness).toBe('stale')
      expect(failed.last_error).toContain('generator not found')
    } finally {
      server.close()
    }
  })

  it('rejects refresh when the stored generator is denied by the active profile ACL', async () => {
    const owner = `artifact-rest-${randomUUID()}`
    const sourceRoot = mkdtempSync(join(tmpdir(), 'harness-artifact-rest-source-'))
    owned.push(sourceRoot, userPaths(owner, '').artifactsDir)
    const source = join(sourceRoot, 'fixture.json')
    writeFileSync(source, JSON.stringify({ value: 2 }), 'utf8')
    const profile = { name: 'fixture', working_dir: sourceRoot, artifact_dir: sourceRoot, tools: { builtin: { DangerousGenerator: 'deny' } } } as any
    const runStore = { create() {}, update() {}, get() { return null }, list() { return [] }, scanRunning() { return [] } } as unknown as RunStore
    const generator = vi.fn(async () => ({ payload: { generated: true } }))
    const { server, base } = await start(createRestHandler({ defaultProfile: profile, runStore, abortRegistry: new Map(), skills: [], artifactGenerator: generator }))
    try {
      const create = await fetch(`${base}/artifacts?user=${owner}`, { method: 'POST', body: JSON.stringify({ profile: 'fixture', generating_tool: 'DangerousGenerator', payload: { value: 1 }, source_dependencies: [`file:${source}`] }) })
      const recipe = (await create.json()).recipe
      writeFileSync(source, JSON.stringify({ value: 3 }), 'utf8')
      const refresh = await fetch(`${base}/artifacts/${recipe.id}/refresh?user=${owner}`, { method: 'POST', body: JSON.stringify({ confirm: true }) })
      expect(refresh.status).toBe(403)
      expect(generator).not.toHaveBeenCalled()
    } finally {
      server.close()
    }
  })
})
