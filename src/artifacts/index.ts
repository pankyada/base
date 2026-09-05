import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJson, readJson } from '../shared/atomic-json.js'
import { userPaths } from '../session/user-paths.js'
import { readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import type { RunBudget } from '../runs/budget.js'

export type ArtifactFreshness = 'unknown' | 'stale' | 'refreshing' | 'current'

export interface ArtifactVersion {
  id: string
  version: number
  payload: unknown
  payload_hash: string
  created_at: string
  source_cursor?: string
  diff?: { changed: boolean; summary: string }
}

export interface ArtifactRecipe {
  version: 1
  id: string
  user: string
  profile: string
  generating_tool: string
  code_ref?: string
  parameters: Record<string, unknown>
  source_dependencies: string[]
  provenance: { session_id?: string; tool_call_id?: string; source?: string }
  revision: number
  freshness: ArtifactFreshness
  last_good?: ArtifactVersion
  versions: ArtifactVersion[]
  refresh_policy: { enabled: boolean; confirm_new_effects: boolean }
  last_error?: string
  created_at: string
  updated_at: string
}

export interface RefreshInput {
  sourceCursor?: string
  probe: () => Promise<{ changed: boolean; cursor?: string }>
  generate: () => Promise<unknown>
}

export interface ArtifactDependencySnapshot {
  dependency: string
  cursor: string
  payload: unknown
  exists: true
}

export interface ArtifactExecutionRequest {
  recipe: ArtifactRecipe
  dependencies: ArtifactDependencySnapshot[]
  parameters: Record<string, unknown>
  generatingTool: string
  codeRef?: string
  signal?: AbortSignal
}

export interface ArtifactRuntimeOptions {
  resolveDependency?: (dependency: string, recipe: ArtifactRecipe) => Promise<ArtifactDependencySnapshot>
  execute: (request: ArtifactExecutionRequest) => Promise<{ payload: unknown }>
  approval?: { approved: boolean; reason?: string }
  allowEffects?: boolean
  taintSources?: string[]
  budget?: RunBudget
  signal?: AbortSignal
}

export class ArtifactRuntimeDeniedError extends Error {
  constructor(readonly reason: 'approval' | 'tainted' | 'budget' | 'aborted' | 'source', message: string) {
    super(message)
    this.name = 'ArtifactRuntimeDeniedError'
  }
}

function aggregateCursor(dependencies: ArtifactDependencySnapshot[]): string {
  return createHash('sha256').update(JSON.stringify(dependencies.map(item => [item.dependency, item.cursor]))).digest('hex')
}

/** Resolve JSON/text file dependencies using content hashes, so unchanged probes are deterministic. */
export function createFileDependencyResolver(root?: string): (dependency: string, recipe: ArtifactRecipe) => Promise<ArtifactDependencySnapshot> {
  return async dependency => {
    if (!dependency.startsWith('file:')) throw new ArtifactRuntimeDeniedError('source', `unsupported artifact dependency: ${dependency}`)
    const path = resolve(dependency.slice('file:'.length))
    if (root && relative(resolve(root), path).startsWith('..')) throw new ArtifactRuntimeDeniedError('source', `artifact dependency outside owned root: ${dependency}`)
    let bytes: Buffer
    try { bytes = readFileSync(path) } catch (error) { throw new ArtifactRuntimeDeniedError('source', `artifact dependency unavailable: ${dependency} (${error instanceof Error ? error.message : String(error)})`) }
    const cursor = createHash('sha256').update(bytes).digest('hex')
    let payload: unknown
    try { payload = JSON.parse(bytes.toString('utf8')) } catch { payload = bytes.toString('utf8') }
    return { dependency, cursor, payload, exists: true }
  }
}

export interface ArtifactVersionDiff {
  from?: ArtifactVersion
  to?: ArtifactVersion
  changed: boolean
  summary: string
}

export const payloadHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function createRecipe(input: Omit<ArtifactRecipe, 'version' | 'id' | 'revision' | 'freshness' | 'versions' | 'created_at' | 'updated_at'>): ArtifactRecipe {
  const now = new Date().toISOString()
  return { ...input, version: 1, id: randomUUID(), revision: 1, freshness: 'unknown', versions: [], created_at: now, updated_at: now }
}

export function addVersion(recipe: ArtifactRecipe, payload: unknown, cursor?: string): ArtifactRecipe {
  const previous = recipe.last_good
  const hash = payloadHash(payload)
  const version: ArtifactVersion = {
    id: randomUUID(),
    version: recipe.versions.length + 1,
    payload,
    payload_hash: hash,
    created_at: new Date().toISOString(),
    source_cursor: cursor,
    diff: previous ? { changed: previous.payload_hash !== hash, summary: previous.payload_hash === hash ? 'No source changes' : 'Payload changed' } : undefined,
  }
  return {
    ...recipe,
    revision: recipe.revision + 1,
    freshness: 'current',
    last_good: version,
    versions: [...recipe.versions, version],
    updated_at: new Date().toISOString(),
    last_error: undefined,
  }
}

export function compareVersions(recipe: ArtifactRecipe, fromVersion: number, toVersion: number): ArtifactVersionDiff {
  const from = recipe.versions.find(version => version.version === fromVersion)
  const to = recipe.versions.find(version => version.version === toVersion)
  if (!from || !to) throw new Error(`artifact version not found: ${!from ? fromVersion : toVersion}`)
  const changed = from.payload_hash !== to.payload_hash
  return { from, to, changed, summary: changed ? 'Payload changed' : 'Payload unchanged' }
}

const refreshes = new Map<string, Promise<ArtifactRecipe>>()

/** Probe source state before generating; unchanged cursors do zero generation. */
export function refresh(recipe: ArtifactRecipe, input: RefreshInput): Promise<ArtifactRecipe> {
  const inFlight = refreshes.get(recipe.id)
  if (inFlight) return inFlight
  const operation = (async () => {
    let probe: { changed: boolean; cursor?: string }
    try {
      probe = await input.probe()
    } catch (error) {
      return { ...recipe, freshness: 'stale' as const, last_error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }
    }
    const previousCursor = recipe.last_good?.source_cursor
    const unchangedCursor = probe.cursor !== undefined && probe.cursor === previousCursor
    if ((!probe.changed || unchangedCursor) && recipe.last_good) {
      return { ...recipe, freshness: 'current' as const, updated_at: new Date().toISOString(), last_error: undefined }
    }
    const working = { ...recipe, freshness: 'refreshing' as const, updated_at: new Date().toISOString() }
    try {
      const payload = await input.generate()
      return addVersion(working, payload, probe.cursor ?? input.sourceCursor)
    } catch (error) {
      return { ...working, freshness: 'stale' as const, last_error: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }
    }
  })()
  refreshes.set(recipe.id, operation)
  void operation.finally(() => { if (refreshes.get(recipe.id) === operation) refreshes.delete(recipe.id) }).catch(() => undefined)
  return operation
}

export function refreshWithRuntime(recipe: ArtifactRecipe, options: ArtifactRuntimeOptions): Promise<ArtifactRecipe> {
  const resolveDependency = options.resolveDependency ?? createFileDependencyResolver()
  let snapshots: ArtifactDependencySnapshot[] = []
  return refresh(recipe, {
    probe: async () => {
      if (options.signal?.aborted) throw new ArtifactRuntimeDeniedError('aborted', 'artifact refresh aborted')
      snapshots = await Promise.all(recipe.source_dependencies.map(dependency => resolveDependency(dependency, recipe)))
      return { changed: aggregateCursor(snapshots) !== recipe.last_good?.source_cursor, cursor: aggregateCursor(snapshots) }
    },
    generate: async () => {
      if (options.signal?.aborted) throw new ArtifactRuntimeDeniedError('aborted', 'artifact refresh aborted')
      if ((options.taintSources?.length ?? 0) > 0) throw new ArtifactRuntimeDeniedError('tainted', `artifact refresh denied for tainted sources: ${options.taintSources!.join(', ')}`)
      if (recipe.refresh_policy.confirm_new_effects && options.allowEffects !== true && options.approval?.approved !== true) throw new ArtifactRuntimeDeniedError('approval', 'artifact refresh requires explicit effect approval')
      if (options.budget) options.budget.checkTool(recipe.generating_tool)
      const result = await options.execute({
        recipe,
        dependencies: snapshots,
        parameters: { ...recipe.parameters },
        generatingTool: recipe.generating_tool,
        codeRef: recipe.code_ref,
        signal: options.signal,
      })
      return result.payload
    },
  })
}

export function promoteArtifact(user: string, input: {
  profile: string
  generatingTool: string
  codeRef?: string
  parameters: Record<string, unknown>
  payload: unknown
  sourceDependencies?: string[]
  sessionId?: string
  toolCallId?: string
  source?: string
}): ArtifactRecipe {
  const recipe = createRecipe({
    user,
    profile: input.profile,
    generating_tool: input.generatingTool,
    code_ref: input.codeRef,
    parameters: input.parameters,
    source_dependencies: input.sourceDependencies ?? [],
    provenance: { session_id: input.sessionId, tool_call_id: input.toolCallId, source: input.source },
    refresh_policy: { enabled: true, confirm_new_effects: true },
  })
  return addVersion(recipe, input.payload)
}

export class ArtifactStore {
  constructor(private readonly user: string) {}

  private root(): string { return userPaths(this.user, '').artifactsDir }

  save(recipe: ArtifactRecipe): void {
    if (recipe.user !== this.user) throw new Error('artifact recipe belongs to another user')
    atomicWriteJson(join(this.root(), `recipe-${recipe.id}.json`), recipe)
  }

  get(id: string): ArtifactRecipe | null {
    const path = join(this.root(), `recipe-${id}.json`)
    if (!existsSync(path)) return null
    const recipe = readJson<ArtifactRecipe>(path)
    return recipe.user === this.user ? recipe : null
  }

  list(): ArtifactRecipe[] {
    if (!existsSync(this.root())) return []
    return readdirSync(this.root())
      .filter(file => file.startsWith('recipe-') && file.endsWith('.json'))
      .flatMap(file => {
        try { return [readJson<ArtifactRecipe>(join(this.root(), file))] } catch { return [] }
      })
      .filter(recipe => recipe.user === this.user)
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id.localeCompare(a.id))
  }

  async refresh(id: string, input: RefreshInput): Promise<ArtifactRecipe> {
    const recipe = this.get(id)
    if (!recipe) throw new Error('artifact recipe not found')
    if (!recipe.refresh_policy.enabled) throw new Error('artifact refresh disabled')
    const updated = await refresh(recipe, input)
    this.save(updated)
    return updated
  }

  async refreshRuntime(id: string, options: ArtifactRuntimeOptions): Promise<ArtifactRecipe> {
    const recipe = this.get(id)
    if (!recipe) throw new Error('artifact recipe not found')
    if (!recipe.refresh_policy.enabled) throw new Error('artifact refresh disabled')
    const updated = await refreshWithRuntime(recipe, options)
    this.save(updated)
    return updated
  }
}
