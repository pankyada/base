import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { userPaths } from '../src/session/user-paths.js'
import { addVersion, ArtifactStore, compareVersions, createFileDependencyResolver, createRecipe, promoteArtifact, refresh } from '../src/artifacts/index.js'
import { RunBudget } from '../src/runs/budget.js'

const owned: string[] = []
function user(): string {
  const value = `artifact-acceptance-${randomUUID()}`
  owned.push(userPaths(value, '').artifactsDir)
  return value
}
afterEach(() => { for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true }) })

function recipeFor(owner: string) {
  return addVersion(createRecipe({
    user: owner,
    profile: 'coding@fixture',
    generating_tool: 'fixture.generate',
    code_ref: 'fixture.ts#render',
    parameters: { dataset: 'fixture.csv' },
    source_dependencies: ['dataset:fixture.csv'],
    provenance: { session_id: 'session-real', tool_call_id: 'tool-real', source: 'fixture' },
    refresh_policy: { enabled: true, confirm_new_effects: true },
  }), { value: 1 }, 'cursor-1')
}

describe('R1/R10 refreshable artifact acceptance', () => {
  it('does zero generation for unchanged source, then versions changed source and retains last-good on failure', async () => {
    const owner = user()
    const original = recipeFor(owner)
    let calls = 0
    const unchanged = await refresh(original, {
      probe: async () => ({ changed: false, cursor: 'cursor-1' }),
      generate: async () => { calls++; return { value: 2 } },
    })
    expect(calls).toBe(0)
    expect(unchanged.last_good?.payload).toEqual({ value: 1 })

    const changed = await refresh(unchanged, {
      probe: async () => ({ changed: true, cursor: 'cursor-2' }),
      generate: async () => { calls++; return { value: 2 } },
    })
    expect(calls).toBe(1)
    expect(changed.last_good?.payload).toEqual({ value: 2 })
    expect(changed.versions).toHaveLength(2)
    expect(compareVersions(changed, 1, 2)).toMatchObject({ changed: true, summary: 'Payload changed' })

    const failed = await refresh(changed, {
      probe: async () => ({ changed: true, cursor: 'deleted-source' }),
      generate: async () => { throw new Error('source deleted') },
    })
    expect(failed.freshness).toBe('stale')
    expect(failed.last_error).toBe('source deleted')
    expect(failed.last_good?.payload).toEqual({ value: 2 })
    expect(failed.versions).toHaveLength(2)

    const probeFailed = await refresh(failed, {
      probe: async () => { throw new Error('source unavailable') },
      generate: async () => { calls++; return { value: 3 } },
    })
    expect(probeFailed.freshness).toBe('stale')
    expect(probeFailed.last_error).toBe('source unavailable')
    expect(calls).toBe(1)
  })

  it('coalesces concurrent refreshes and persists recipe across store re-instantiation', async () => {
    const owner = user()
    const original = recipeFor(owner)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let calls = 0
    const input = {
      probe: async () => ({ changed: true, cursor: 'cursor-2' }),
      generate: async () => { calls++; await gate; return { value: 2 } },
    }
    const first = refresh(original, input)
    const second = refresh(original, input)
    expect(second).toBe(first)
    release()
    expect((await Promise.all([first, second]))[0].last_good?.payload).toEqual({ value: 2 })
    expect(calls).toBe(1)

    const store = new ArtifactStore(owner)
    store.save(await first)
    const restarted = new ArtifactStore(owner)
    expect(restarted.get(original.id)?.last_good?.source_cursor).toBe('cursor-2')
    expect(restarted.list()).toHaveLength(1)
  })

  it('promotes only explicit source lineage and preserves it in owned recipe', () => {
    const owner = user()
    const recipe = promoteArtifact(owner, {
      profile: 'coding@fixture',
      generatingTool: 'fixture.generate',
      codeRef: 'fixture.ts#render',
      parameters: { dataset: 'fixture.csv' },
      payload: { value: 1 },
      sourceDependencies: ['dataset:fixture.csv'],
      sessionId: 'session-real',
      toolCallId: 'tool-real',
      source: 'fixture',
    })
    expect(recipe.provenance).toEqual({ session_id: 'session-real', tool_call_id: 'tool-real', source: 'fixture' })
    expect(recipe.code_ref).toBe('fixture.ts#render')
    expect(recipe.last_good?.payload).toEqual({ value: 1 })
  })

  it('executes saved recipes from real file cursors, skips unchanged sources, and retains last-good on deletion', async () => {
    const owner = user()
    const sourceRoot = mkdtempSync(join(tmpdir(), 'harness-artifact-source-'))
    owned.push(sourceRoot)
    const source = join(sourceRoot, 'fixture.json')
    writeFileSync(source, JSON.stringify({ value: 2 }), 'utf8')
    const recipe = createRecipe({
      user: owner,
      profile: 'coding@fixture',
      generating_tool: 'fixture.generate',
      code_ref: 'fixture.ts#render',
      parameters: { multiplier: 3 },
      source_dependencies: [`file:${source}`],
      provenance: { session_id: 'session-runtime', tool_call_id: 'tool-runtime' },
      refresh_policy: { enabled: true, confirm_new_effects: true },
    })
    const store = new ArtifactStore(owner)
    store.save(recipe)
    let calls = 0
    const execute = async (request: Parameters<NonNullable<Parameters<typeof store.refreshRuntime>[1]>['execute']>[0]) => {
      calls++
      expect(request.generatingTool).toBe('fixture.generate')
      expect(request.codeRef).toBe('fixture.ts#render')
      expect(request.parameters).toEqual({ multiplier: 3 })
      return { payload: { value: (request.dependencies[0].payload as { value: number }).value * 3 } }
    }
    const first = await store.refreshRuntime(recipe.id, { resolveDependency: createFileDependencyResolver(sourceRoot), approval: { approved: true }, execute })
    expect(calls).toBe(1)
    expect(first.last_good?.payload).toEqual({ value: 6 })
    const unchanged = await store.refreshRuntime(recipe.id, { resolveDependency: createFileDependencyResolver(sourceRoot), approval: { approved: true }, execute })
    expect(calls).toBe(1)
    expect(unchanged.versions).toHaveLength(1)

    writeFileSync(source, JSON.stringify({ value: 4 }), 'utf8')
    const changed = await store.refreshRuntime(recipe.id, { resolveDependency: createFileDependencyResolver(sourceRoot), approval: { approved: true }, execute })
    expect(calls).toBe(2)
    expect(changed.last_good?.payload).toEqual({ value: 12 })
    rmSync(source)
    const deleted = await store.refreshRuntime(recipe.id, { resolveDependency: createFileDependencyResolver(sourceRoot), approval: { approved: true }, execute })
    expect(deleted.freshness).toBe('stale')
    expect(deleted.last_good?.payload).toEqual({ value: 12 })
    expect(calls).toBe(2)
  })

  it('denies unapproved, tainted, and over-budget recipe execution before generator call', async () => {
    const owner = user()
    const sourceRoot = mkdtempSync(join(tmpdir(), 'harness-artifact-gate-'))
    owned.push(sourceRoot)
    const source = join(sourceRoot, 'fixture.json')
    writeFileSync(source, JSON.stringify({ value: 1 }), 'utf8')
    const recipe = createRecipe({
      user: owner,
      profile: 'coding@fixture',
      generating_tool: 'fixture.generate',
      parameters: {},
      source_dependencies: [`file:${source}`],
      provenance: {},
      refresh_policy: { enabled: true, confirm_new_effects: true },
    })
    const store = new ArtifactStore(owner)
    store.save(recipe)
    let calls = 0
    const execute = async () => { calls++; return { payload: { value: 2 } } }
    const denied = await store.refreshRuntime(recipe.id, { resolveDependency: createFileDependencyResolver(sourceRoot), execute })
    expect(denied.freshness).toBe('stale')
    expect(denied.last_error).toContain('approval')
    expect(calls).toBe(0)
    const tainted = await store.refreshRuntime(recipe.id, { resolveDependency: createFileDependencyResolver(sourceRoot), approval: { approved: true }, taintSources: ['untrusted:fixture'], execute })
    expect(tainted.last_error).toContain('tainted')
    expect(calls).toBe(0)
    const budget = await store.refreshRuntime(recipe.id, { resolveDependency: createFileDependencyResolver(sourceRoot), approval: { approved: true }, budget: new RunBudget({ max_cost_usd: 1, max_tools: 0, max_wall_s: 10 }), execute })
    expect(budget.last_error).toContain('budget exceeded')
    expect(calls).toBe(0)
  })
})
