# Triggered + Durable Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cron + webhook triggers to agent profiles, persist a run record for every execution, and expose a lifecycle API (`GET/DELETE /runs`) that covers all execution paths.

**Architecture:** A new `RunStore` persists one JSON file per run at `~/.harness/runs/<user>/<id>.json` (mirroring sessions). `CronScheduler` reads `profile.triggers.cron` at startup and fires `runProfileOnce()` on schedule. Webhook and lifecycle routes are added to the existing REST handler. An in-process `Map<runId, AbortController>` enables cancellation.

**Tech Stack:** TypeScript, vitest, node-cron (new dep), existing Node.js fs/http APIs.

**Spec:** `docs/superpowers/specs/2026-05-30-triggered-durable-agents-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/runs/types.ts` | `Run` interface |
| Create | `src/runs/store.ts` | `RunStore` — flat-file CRUD for run records |
| Create | `src/scheduler/cron.ts` | `CronScheduler` — in-process cron using `node-cron` |
| Create | `tests/run-store.test.ts` | Tests for RunStore |
| Create | `tests/cron-scheduler.test.ts` | Tests for CronScheduler |
| Modify | `src/profiles/schema.ts` | Add `triggers` block to `ProfileSchema` |
| Modify | `src/server/rest.ts` | Add `runStore`+`abortRegistry` to `RestDeps`; new lifecycle + webhook routes; wrap `/run`+`/stream` |
| Modify | `src/server/index.ts` | Init `RunStore`, `abortRegistry`, `CronScheduler`; crash recovery on startup |
| Modify | `tests/profile-schema.test.ts` | Tests for `triggers` schema |
| Modify | `tests/rest.test.ts` | Update `createRestHandler` calls; new route tests |

---

## Task 1: Install `node-cron`

**Files:** `package.json`

- [ ] **Step 1: Install the package**

```bash
pnpm add node-cron
pnpm add -D @types/node-cron
```

- [ ] **Step 2: Verify the install**

```bash
node -e "import('node-cron').then(m => console.log('ok', typeof m.default.schedule))"
```

Expected output: `ok function`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add node-cron dependency"
```

---

## Task 2: `Run` type + `RunStore`

**Files:**
- Create: `src/runs/types.ts`
- Create: `src/runs/store.ts`
- Create: `tests/run-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/run-store.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { RunStore } from '../src/runs/store.js'
import type { Run } from '../src/runs/types.js'

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: Math.random().toString(36).slice(2, 10),
    profile: 'test-profile',
    user: 'testuser',
    trigger: 'rest',
    input: 'hello',
    status: 'running',
    started_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('RunStore', () => {
  const store = new RunStore()

  it('creates and retrieves a run by id', () => {
    const run = makeRun()
    store.create(run)
    const found = store.get(run.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(run.id)
    expect(found!.profile).toBe('test-profile')
  })

  it('updates run status', () => {
    const run = makeRun()
    store.create(run)
    store.update(run.id, { status: 'completed', finished_at: new Date().toISOString() })
    const updated = store.get(run.id)
    expect(updated!.status).toBe('completed')
    expect(updated!.finished_at).toBeDefined()
  })

  it('returns null for unknown id', () => {
    expect(store.get('doesnotexist')).toBeNull()
  })

  it('lists runs filtered by user', () => {
    const alice = makeRun({ user: 'alice', id: 'alice001' })
    const bob = makeRun({ user: 'bob', id: 'bob00001' })
    store.create(alice)
    store.create(bob)
    const results = store.list({ user: 'alice' })
    const ids = results.map(r => r.id)
    expect(ids).toContain('alice001')
    expect(ids).not.toContain('bob00001')
  })

  it('lists runs filtered by status', () => {
    const running = makeRun({ id: 'run00001', status: 'running' })
    const done = makeRun({ id: 'done0001', status: 'completed' })
    store.create(running)
    store.create(done)
    const results = store.list({ status: 'running', user: 'testuser' })
    expect(results.some(r => r.id === 'run00001')).toBe(true)
    expect(results.some(r => r.id === 'done0001')).toBe(false)
  })

  it('scanRunning returns all running runs', () => {
    const run = makeRun({ id: 'scan0001', status: 'running' })
    store.create(run)
    const running = store.scanRunning()
    expect(running.some(r => r.id === 'scan0001')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/run-store.test.ts
```

Expected: FAIL — `Cannot find module '../src/runs/store.js'`

- [ ] **Step 3: Create `src/runs/types.ts`**

```typescript
export interface Run {
  id: string
  profile: string
  user: string
  trigger: 'rest' | 'stream' | 'cron' | 'webhook'
  input: unknown
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  session_id?: string
  started_at: string
  finished_at?: string
  error?: string
}
```

- [ ] **Step 4: Create `src/runs/store.ts`**

```typescript
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Run } from './types.js'
import { sanitizeUserId } from '../session/user-paths.js'

function runsDir(user: string): string {
  return join(homedir(), '.harness', 'runs', sanitizeUserId(user))
}

function allRunsBase(): string {
  return join(homedir(), '.harness', 'runs')
}

export class RunStore {
  create(run: Run): void {
    const dir = runsDir(run.user)
    mkdirSync(dir, { recursive: true })
    const date = run.started_at.slice(0, 10)
    writeFileSync(join(dir, `${date}_${run.id}.json`), JSON.stringify(run, null, 2), 'utf-8')
  }

  update(id: string, patch: Partial<Run>): void {
    const run = this.get(id)
    if (!run) return
    const updated = { ...run, ...patch }
    const dir = runsDir(run.user)
    const date = run.started_at.slice(0, 10)
    writeFileSync(join(dir, `${date}_${id}.json`), JSON.stringify(updated, null, 2), 'utf-8')
  }

  get(id: string): Run | null {
    const base = allRunsBase()
    if (!existsSync(base)) return null
    for (const userDir of readdirSync(base, { withFileTypes: true })) {
      if (!userDir.isDirectory()) continue
      const dir = join(base, userDir.name)
      const files = readdirSync(dir)
      const match = files.find(f => f.includes(id) && f.endsWith('.json'))
      if (match) {
        try {
          return JSON.parse(readFileSync(join(dir, match), 'utf-8')) as Run
        } catch { return null }
      }
    }
    return null
  }

  list(opts: { user?: string; status?: Run['status']; profile?: string; limit?: number } = {}): Run[] {
    const { user, status, profile, limit = 50 } = opts
    const base = allRunsBase()
    if (!existsSync(base)) return []
    const userDirs = user
      ? [sanitizeUserId(user)]
      : readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    const runs: Run[] = []
    for (const u of userDirs) {
      const dir = join(base, u)
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue
        try {
          const run = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Run
          if (status && run.status !== status) continue
          if (profile && run.profile !== profile) continue
          runs.push(run)
        } catch { /* skip corrupt files */ }
      }
    }
    return runs.slice(0, limit)
  }

  scanRunning(): Run[] {
    return this.list({ status: 'running', limit: 1000 })
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/run-store.test.ts
```

Expected: PASS — 6 tests

- [ ] **Step 6: Commit**

```bash
git add src/runs/types.ts src/runs/store.ts tests/run-store.test.ts
git commit -m "feat: add Run type and RunStore"
```

---

## Task 3: Profile schema — `triggers` block

**Files:**
- Modify: `src/profiles/schema.ts`
- Modify: `tests/profile-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/profile-schema.test.ts`:

```typescript
describe('ProfileSchema – triggers block', () => {
  it('triggers defaults to undefined when absent', () => {
    const p = ProfileSchema.parse(BASE)
    expect(p.triggers).toBeUndefined()
  })

  it('parses triggers.cron expression', () => {
    const p = ProfileSchema.parse({ ...BASE, triggers: { cron: '0 9 * * *' } })
    expect(p.triggers?.cron).toBe('0 9 * * *')
    expect(p.triggers?.webhook).toBe(false)
  })

  it('parses triggers.webhook true', () => {
    const p = ProfileSchema.parse({ ...BASE, triggers: { webhook: true } })
    expect(p.triggers?.webhook).toBe(true)
  })

  it('parses triggers.cron_input payload', () => {
    const p = ProfileSchema.parse({ ...BASE, triggers: { cron: '* * * * *', cron_input: { task: 'run' } } })
    expect(p.triggers?.cron_input).toEqual({ task: 'run' })
  })

  it('triggers.webhook defaults to false when only cron is set', () => {
    const p = ProfileSchema.parse({ ...BASE, triggers: { cron: '* * * * *' } })
    expect(p.triggers?.webhook).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run tests/profile-schema.test.ts
```

Expected: FAIL — new describe block tests fail

- [ ] **Step 3: Add `triggers` to `ProfileSchema` in `src/profiles/schema.ts`**

Add before the closing `})` of `ProfileSchema`:

```typescript
  triggers: z.object({
    cron: z.string().optional(),
    webhook: z.boolean().default(false),
    cron_input: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/profile-schema.test.ts
```

Expected: PASS — all tests including the new describe block

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/profiles/schema.ts tests/profile-schema.test.ts
git commit -m "feat: add triggers block to ProfileSchema"
```

---

## Task 4: Run lifecycle API — `GET /runs`, `GET /runs/:id`, `DELETE /runs/:id`

This task updates `RestDeps` and adds the three lifecycle routes. It also updates existing tests to pass the new required fields.

**Files:**
- Modify: `src/server/rest.ts`
- Modify: `tests/rest.test.ts`

- [ ] **Step 1: Write failing tests for the new routes**

Add a new describe block to `tests/rest.test.ts`. Also update all existing `createRestHandler` calls to pass `runStore` and `abortRegistry`.

First, add these imports at the top of `tests/rest.test.ts`:

```typescript
import { RunStore } from '../src/runs/store.js'
```

Add a mock RunStore factory above the describe blocks:

```typescript
function makeMockRunStore(): RunStore {
  return {
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn().mockReturnValue(null),
    list: vi.fn().mockReturnValue([]),
    scanRunning: vi.fn().mockReturnValue([]),
  } as any
}
```

Update every `createRestHandler` call in existing tests to include the new fields:

```typescript
// Before:
const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined })
// After:
const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map() })
```

(There are 4 such calls — in the 4 `beforeAll` blocks.)

Then add the new describe block for lifecycle routes:

```typescript
describe('REST /runs lifecycle API', () => {
  let server: Server, base: string
  let mockRunStore: RunStore

  beforeAll(async () => {
    mockRunStore = makeMockRunStore()
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: mockRunStore, abortRegistry: new Map() })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())

  it('GET /runs returns empty array when no runs', async () => {
    vi.mocked(mockRunStore.list).mockReturnValue([])
    const res = await fetch(`${base}/runs`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runs: [] })
  })

  it('GET /runs returns list from store', async () => {
    const fakeRun = { id: 'abc12345', profile: 'default', status: 'completed' }
    vi.mocked(mockRunStore.list).mockReturnValue([fakeRun as any])
    const res = await fetch(`${base}/runs`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runs: [fakeRun] })
  })

  it('GET /runs/:id returns 404 when not found', async () => {
    vi.mocked(mockRunStore.get).mockReturnValue(null)
    const res = await fetch(`${base}/runs/notfound`)
    expect(res.status).toBe(404)
  })

  it('GET /runs/:id returns run when found', async () => {
    const fakeRun = { id: 'abc12345', status: 'running' }
    vi.mocked(mockRunStore.get).mockReturnValue(fakeRun as any)
    const res = await fetch(`${base}/runs/abc12345`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'abc12345' })
  })

  it('DELETE /runs/:id returns 404 when not found', async () => {
    vi.mocked(mockRunStore.get).mockReturnValue(null)
    const res = await fetch(`${base}/runs/notfound`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })

  it('DELETE /runs/:id returns 409 when run is already completed', async () => {
    vi.mocked(mockRunStore.get).mockReturnValue({ id: 'abc12345', status: 'completed' } as any)
    const res = await fetch(`${base}/runs/abc12345`, { method: 'DELETE' })
    expect(res.status).toBe(409)
  })

  it('DELETE /runs/:id cancels a running run', async () => {
    const abortRegistry = new Map<string, AbortController>()
    const abort = new AbortController()
    abortRegistry.set('run00001', abort)
    vi.mocked(mockRunStore.get).mockReturnValue({ id: 'run00001', status: 'running' } as any)

    const handler2 = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: mockRunStore, abortRegistry })
    const { server: s2, base: b2 } = await startServer(handler2)
    const res = await fetch(`${b2}/runs/run00001`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(abort.signal.aborted).toBe(true)
    expect(mockRunStore.update).toHaveBeenCalledWith('run00001', expect.objectContaining({ status: 'cancelled' }))
    s2.close()
  })
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx vitest run tests/rest.test.ts
```

Expected: existing tests fail (missing `runStore` in `RestDeps`) + new tests fail (routes not implemented)

- [ ] **Step 3: Update `RestDeps` and add lifecycle routes to `src/server/rest.ts`**

Add the import at the top:

```typescript
import { randomUUID } from 'crypto'
import type { RunStore } from '../runs/store.js'
import type { Run } from '../runs/types.js'
```

Update `RestDeps`:

```typescript
export interface RestDeps {
  defaultProfile: Profile
  apiKey?: string
  runStore: RunStore
  abortRegistry: Map<string, AbortController>
}
```

Add a `makeRunId` helper after the imports section:

```typescript
function makeRunId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}
```

Add the three lifecycle handlers before `createRestHandler`:

```typescript
function handleListRuns(req: IncomingMessage, res: ServerResponse, deps: RestDeps): void {
  const rawUrl = req.url ?? '/runs'
  const [, query = ''] = rawUrl.split('?')
  const params = new URLSearchParams(query)
  const runs = deps.runStore.list({
    user: params.get('user') ?? undefined,
    status: (params.get('status') ?? undefined) as Run['status'] | undefined,
    profile: params.get('profile') ?? undefined,
    limit: params.has('limit') ? parseInt(params.get('limit')!) : 50,
  })
  sendJson(res, 200, { runs })
}

function handleGetRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps, id: string): void {
  const run = deps.runStore.get(id)
  if (!run) return sendJson(res, 404, { error: 'run not found' })
  sendJson(res, 200, run)
}

function handleDeleteRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps, id: string): void {
  const run = deps.runStore.get(id)
  if (!run) return sendJson(res, 404, { error: 'run not found' })
  if (run.status !== 'running') return sendJson(res, 409, { error: `run is already ${run.status}` })
  deps.abortRegistry.get(id)?.abort()
  deps.runStore.update(id, { status: 'cancelled', finished_at: new Date().toISOString() })
  sendJson(res, 200, { ok: true })
}
```

Add routes inside `createRestHandler`, before the final `return sendJson(res, 404, ...)`:

```typescript
    if (method === 'GET' && url === '/runs') return handleListRuns(req, res, deps)
    if (method === 'GET' && url.startsWith('/runs/') && !url.includes('/webhooks')) {
      return handleGetRun(req, res, deps, url.slice('/runs/'.length))
    }
    if (method === 'DELETE' && url.startsWith('/runs/')) {
      return handleDeleteRun(req, res, deps, url.slice('/runs/'.length))
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/rest.test.ts
```

Expected: PASS — all tests including the new lifecycle block

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/server/rest.ts tests/rest.test.ts
git commit -m "feat: add run lifecycle API (GET/DELETE /runs)"
```

---

## Task 5: Wrap `/run` and `/stream` with run tracking

**Files:**
- Modify: `src/server/rest.ts`
- Modify: `tests/rest.test.ts`

- [ ] **Step 1: Write failing tests for run_id in responses**

In `tests/rest.test.ts`, update the existing `/run` success test to use `toMatchObject` instead of `toEqual` (to tolerate the new `run_id` field), and add a test verifying `run_id` is present:

```typescript
// Replace the existing test:
it('POST /run freeform returns 200 with string output and usage', async () => {
  const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ input: 'hi' }) })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toMatchObject({ output: 'hello', usage: { tokens_in: 1, tokens_out: 2, cost_usd: 0.0 }, session_id: 'sess1' })
  expect(typeof body.run_id).toBe('string')
  expect(body.run_id).toHaveLength(8)
})
```

Also verify `runStore.create` is called when `/run` is invoked. Add to the lifecycle describe block:

```typescript
it('POST /run creates a run record', async () => {
  const store = makeMockRunStore()
  const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map() })
  const { server: s2, base: b2 } = await startServer(handler)
  vi.mocked(runProfileOnce).mockResolvedValue({
    finalText: 'hi', usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 }, session: { id: 'sx' } as any,
  })
  await fetch(`${b2}/run`, { method: 'POST', body: JSON.stringify({ input: 'hello' }) })
  expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'rest', status: 'running' }))
  expect(store.update).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'completed' }))
  s2.close()
})
```

- [ ] **Step 2: Run tests to confirm the /run assertion fails**

```bash
npx vitest run tests/rest.test.ts
```

Expected: the `toEqual` assertion fails because `run_id` is not yet present

- [ ] **Step 3: Update `handleRun` in `src/server/rest.ts`**

Replace the existing `handleRun` function:

```typescript
async function handleRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  const prepared = prepareRun(await readBody(req), deps)
  if (!prepared.ok) return sendJson(res, prepared.status, prepared.body)

  const runId = makeRunId()
  const abort = new AbortController()
  deps.abortRegistry.set(runId, abort)
  deps.runStore.create({
    id: runId, profile: prepared.profile.name, user: prepared.userId,
    trigger: 'rest', input: prepared.userMessage, status: 'running',
    started_at: new Date().toISOString(),
  })

  let result
  try {
    result = await runProfileOnce({
      profile: prepared.profile, userId: prepared.userId,
      userMessage: prepared.userMessage, events: headlessEvents(),
      signal: abort.signal,
    })
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    const existing = deps.runStore.get(runId)
    if (existing?.status === 'running') {
      deps.runStore.update(runId, { status: 'failed', error: e.message, finished_at: new Date().toISOString() })
    }
    return sendJson(res, 500, { error: e.message })
  }

  deps.abortRegistry.delete(runId)
  deps.runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
  const out = processOutput(result.finalText, prepared.compiled)
  if (!out.ok) return sendJson(res, 422, { error: out.error, kind: out.kind })
  return sendJson(res, 200, { output: out.output, usage: result.usage, session_id: result.session.id, run_id: runId })
}
```

- [ ] **Step 4: Update `handleStream` in `src/server/rest.ts`**

Replace the existing `handleStream` function:

```typescript
async function handleStream(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  const prepared = prepareRun(await readBody(req), deps)
  if (!prepared.ok) return sendJson(res, prepared.status, prepared.body)

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const runId = makeRunId()
  const abort = new AbortController()
  req.on('close', () => abort.abort())
  deps.abortRegistry.set(runId, abort)
  deps.runStore.create({
    id: runId, profile: prepared.profile.name, user: prepared.userId,
    trigger: 'stream', input: prepared.userMessage, status: 'running',
    started_at: new Date().toISOString(),
  })

  const events: AgentLoopEvents = {
    onToken: t => sse('token', { content: t }),
    onToolStart: (n, i) => sse('tool_start', { name: n, input: i }),
    onToolEnd: (n, r) => sse('tool_end', { name: n, result: r }),
    onToolPrompt: async () => false,
    onSessionEnd: () => {},
    onStats: (tokens_in, tokens_out, cost_usd) => sse('stats', { tokens_in, tokens_out, cost_usd }),
  }

  try {
    const result = await runProfileOnce({
      profile: prepared.profile, userId: prepared.userId,
      userMessage: prepared.userMessage, events, signal: abort.signal,
    })
    deps.abortRegistry.delete(runId)
    deps.runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
    const out = processOutput(result.finalText, prepared.compiled)
    if (!out.ok) {
      sse('error', { error: out.error })
    } else {
      sse('result', { output: out.output, usage: result.usage, session_id: result.session.id, run_id: runId })
    }
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    const existing = deps.runStore.get(runId)
    if (existing?.status === 'running') {
      const isCancelled = (e as Error).name === 'AbortError'
      deps.runStore.update(runId, {
        status: isCancelled ? 'cancelled' : 'failed',
        error: isCancelled ? undefined : e.message,
        finished_at: new Date().toISOString(),
      })
    }
    if ((e as Error).name !== 'AbortError') sse('error', { error: e.message })
  } finally {
    res.end()
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/rest.test.ts
```

Expected: PASS — all tests

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/server/rest.ts tests/rest.test.ts
git commit -m "feat: wrap /run and /stream with run record tracking"
```

---

## Task 6: Webhook endpoint `POST /webhooks/:profile`

**Files:**
- Modify: `src/server/rest.ts`
- Modify: `tests/rest.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/rest.test.ts` (import `loadProfile` mock is already in place from existing tests):

```typescript
describe('REST /webhooks/:profile', () => {
  let server: Server, base: string
  let mockRunStore: RunStore

  const WEBHOOK_PROFILE = {
    name: 'webhookprofile',
    contract: undefined,
    triggers: { webhook: true, cron: undefined, cron_input: undefined },
  } as any

  beforeAll(async () => {
    mockRunStore = makeMockRunStore()
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: mockRunStore, abortRegistry: new Map() })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())

  beforeEach(() => {
    vi.mocked(runProfileOnce).mockReset().mockResolvedValue({
      finalText: 'done', usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 }, session: { id: 'sw' } as any,
    })
  })

  it('returns 404 for an unknown profile', async () => {
    const { loadProfile } = await import('../src/profiles/loader.js')
    vi.mocked(loadProfile).mockImplementation(() => { throw new Error('not found') })
    const res = await fetch(`${base}/webhooks/unknown`, { method: 'POST', body: JSON.stringify({ input: 'hi' }) })
    expect(res.status).toBe(404)
  })

  it('returns 404 when profile has webhook: false', async () => {
    const { loadProfile } = await import('../src/profiles/loader.js')
    vi.mocked(loadProfile).mockReturnValue({ name: 'nohook', triggers: { webhook: false } } as any)
    const res = await fetch(`${base}/webhooks/nohook`, { method: 'POST', body: JSON.stringify({ input: 'hi' }) })
    expect(res.status).toBe(404)
  })

  it('returns 200 with run_id when webhook is enabled', async () => {
    const { loadProfile } = await import('../src/profiles/loader.js')
    vi.mocked(loadProfile).mockReturnValue(WEBHOOK_PROFILE)
    const res = await fetch(`${base}/webhooks/webhookprofile`, { method: 'POST', body: JSON.stringify({ input: 'task' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.run_id).toHaveLength(8)
    expect(body.output).toBe('done')
    expect(mockRunStore.create).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'webhook' }))
  })

  it('returns 400 when input is missing', async () => {
    const { loadProfile } = await import('../src/profiles/loader.js')
    vi.mocked(loadProfile).mockReturnValue(WEBHOOK_PROFILE)
    const res = await fetch(`${base}/webhooks/webhookprofile`, { method: 'POST', body: JSON.stringify({}) })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx vitest run tests/rest.test.ts -t "webhooks"
```

Expected: FAIL — no `/webhooks` route exists

- [ ] **Step 3: Add `handleWebhook` to `src/server/rest.ts`**

Add this handler before `createRestHandler`:

```typescript
async function handleWebhook(req: IncomingMessage, res: ServerResponse, deps: RestDeps, profileName: string): Promise<void> {
  const profilePath = findProfilePath(profileName)
  let profile: Profile | null = null
  try {
    profile = profilePath ? loadProfile(profilePath) : null
  } catch { /* falls through to 404 */ }

  if (!profile || !profile.triggers?.webhook) {
    return sendJson(res, 404, { error: `webhook not found: ${profileName}` })
  }

  const bodyText = await readBody(req)
  let body: { input?: unknown; user?: string }
  try { body = JSON.parse(bodyText) } catch { return sendJson(res, 400, { error: 'malformed JSON body' }) }
  if (body.input === undefined) return sendJson(res, 400, { error: 'missing input' })

  const compiled = compileContract(profile)
  const inputCheck = validateAndBuildInput(body.input, compiled)
  if (!inputCheck.ok) {
    const status = inputCheck.details ? 422 : 400
    return sendJson(res, status, { error: inputCheck.error, details: inputCheck.details })
  }

  const userId = sanitizeUserId(body.user ?? process.env.HARNESS_USER ?? 'anonymous')
  const runId = makeRunId()
  const abort = new AbortController()
  deps.abortRegistry.set(runId, abort)
  deps.runStore.create({
    id: runId, profile: profile.name, user: userId,
    trigger: 'webhook', input: inputCheck.userMessage, status: 'running',
    started_at: new Date().toISOString(),
  })

  try {
    const result = await runProfileOnce({
      profile, userId, userMessage: inputCheck.userMessage, events: headlessEvents(), signal: abort.signal,
    })
    deps.abortRegistry.delete(runId)
    deps.runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
    const out = processOutput(result.finalText, compiled)
    if (!out.ok) return sendJson(res, 422, { error: out.error, kind: out.kind })
    return sendJson(res, 200, { output: out.output, usage: result.usage, session_id: result.session.id, run_id: runId })
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    const existing = deps.runStore.get(runId)
    if (existing?.status === 'running') {
      deps.runStore.update(runId, { status: 'failed', error: e.message, finished_at: new Date().toISOString() })
    }
    return sendJson(res, 500, { error: e.message })
  }
}
```

Add the route inside `createRestHandler` (before the final 404):

```typescript
    if (method === 'POST' && url.startsWith('/webhooks/')) {
      return handleWebhook(req, res, deps, url.slice('/webhooks/'.length))
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/rest.test.ts
```

Expected: PASS — all tests

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/server/rest.ts tests/rest.test.ts
git commit -m "feat: add POST /webhooks/:profile endpoint"
```

---

## Task 7: `CronScheduler`

**Files:**
- Create: `src/scheduler/cron.ts`
- Create: `tests/cron-scheduler.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/cron-scheduler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CronScheduler } from '../src/scheduler/cron.js'
import type { Profile } from '../src/profiles/schema.js'
import type { RunStore } from '../src/runs/store.js'

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  },
}))

vi.mock('../src/server/run-profile.js', () => ({
  runProfileOnce: vi.fn().mockResolvedValue({
    finalText: 'done',
    usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 },
    session: { id: 'sess1' },
  }),
}))

const BASE_PROFILE: Profile = {
  name: 'test',
  model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'gpt-4o' },
  system_prompt: './prompt.md',
  artifact_dir: '/tmp',
  tools: { builtin: {} as any, custom: {}, mcp_servers: [] },
  hooks: { pre_tool: [], post_tool: [], on_stop: [], timeout_ms: 5000 },
  improvement: { enabled: false, mine_skills_every_n_sessions: 10 },
  max_depth: 2,
  agents: [],
  memory: { provider: 'fs' },
  working_dir: '/tmp',
}

function makeMockRunStore(): RunStore {
  return {
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn().mockReturnValue(null),
    list: vi.fn().mockReturnValue([]),
    scanRunning: vi.fn().mockReturnValue([]),
  } as any
}

describe('CronScheduler', () => {
  let mockRunStore: RunStore
  let abortRegistry: Map<string, AbortController>

  beforeEach(() => {
    mockRunStore = makeMockRunStore()
    abortRegistry = new Map()
    vi.clearAllMocks()
  })

  it('does not register a cron job when triggers is undefined', async () => {
    const cron = await import('node-cron')
    const scheduler = new CronScheduler(BASE_PROFILE, mockRunStore, abortRegistry)
    scheduler.init()
    expect(cron.default.schedule).not.toHaveBeenCalled()
  })

  it('does not register a cron job when triggers.cron is undefined', async () => {
    const cron = await import('node-cron')
    const profile = { ...BASE_PROFILE, triggers: { webhook: false } } as Profile
    const scheduler = new CronScheduler(profile, mockRunStore, abortRegistry)
    scheduler.init()
    expect(cron.default.schedule).not.toHaveBeenCalled()
  })

  it('registers a cron job when triggers.cron is set', async () => {
    const cron = await import('node-cron')
    const profile = { ...BASE_PROFILE, triggers: { cron: '0 9 * * *', webhook: false } } as Profile
    const scheduler = new CronScheduler(profile, mockRunStore, abortRegistry)
    scheduler.init()
    expect(cron.default.schedule).toHaveBeenCalledWith('0 9 * * *', expect.any(Function))
  })

  it('stop() calls task.stop()', async () => {
    const cron = await import('node-cron')
    const mockTask = { stop: vi.fn() }
    vi.mocked(cron.default.schedule).mockReturnValue(mockTask as any)
    const profile = { ...BASE_PROFILE, triggers: { cron: '* * * * *', webhook: false } } as Profile
    const scheduler = new CronScheduler(profile, mockRunStore, abortRegistry)
    scheduler.init()
    scheduler.stop()
    expect(mockTask.stop).toHaveBeenCalled()
  })

  it('cron callback creates run record and calls runProfileOnce', async () => {
    const cron = await import('node-cron')
    const { runProfileOnce } = await import('../src/server/run-profile.js')
    let capturedCallback: (() => Promise<void>) | null = null
    vi.mocked(cron.default.schedule).mockImplementation((_expr, cb) => {
      capturedCallback = cb as () => Promise<void>
      return { stop: vi.fn() } as any
    })

    const profile = { ...BASE_PROFILE, triggers: { cron: '* * * * *', webhook: false } } as Profile
    const scheduler = new CronScheduler(profile, mockRunStore, abortRegistry)
    scheduler.init()

    expect(capturedCallback).not.toBeNull()
    await capturedCallback!()

    expect(mockRunStore.create).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'cron', status: 'running', profile: 'test',
    }))
    expect(runProfileOnce).toHaveBeenCalled()
    expect(mockRunStore.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'completed' })
    )
  })
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx vitest run tests/cron-scheduler.test.ts
```

Expected: FAIL — `Cannot find module '../src/scheduler/cron.js'`

- [ ] **Step 3: Create `src/scheduler/cron.ts`**

```typescript
import cron from 'node-cron'
import { randomUUID } from 'crypto'
import type { ScheduledTask } from 'node-cron'
import type { Profile } from '../profiles/schema.js'
import type { RunStore } from '../runs/store.js'
import { runProfileOnce } from '../server/run-profile.js'
import { sanitizeUserId } from '../session/user-paths.js'
import { compileContract, validateAndBuildInput } from '../server/contract.js'

function makeRunId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

export class CronScheduler {
  private task: ScheduledTask | null = null

  constructor(
    private profile: Profile,
    private runStore: RunStore,
    private abortRegistry: Map<string, AbortController>,
  ) {}

  init(): void {
    const expression = this.profile.triggers?.cron
    if (!expression) return

    // Fail-fast: validate cron_input against contract schema at startup, not at first fire
    const cronInput = this.profile.triggers?.cron_input
    if (cronInput !== undefined) {
      const compiled = compileContract(this.profile)
      const check = validateAndBuildInput(cronInput, compiled)
      if (!check.ok) {
        throw new Error(`[cron] profile '${this.profile.name}' cron_input is invalid: ${check.error}`)
      }
    }

    this.task = cron.schedule(expression, async () => {
      const runId = makeRunId()
      const abort = new AbortController()
      this.abortRegistry.set(runId, abort)
      const user = sanitizeUserId(process.env.HARNESS_USER ?? 'anonymous')
      const input = this.profile.triggers?.cron_input
      const userMessage = input ? JSON.stringify(input) : ''

      this.runStore.create({
        id: runId,
        profile: this.profile.name,
        user,
        trigger: 'cron',
        input: userMessage,
        status: 'running',
        started_at: new Date().toISOString(),
      })

      try {
        const result = await runProfileOnce({
          profile: this.profile,
          userId: user,
          userMessage,
          events: {
            onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {},
            onToolPrompt: async () => false, onSessionEnd: () => {}, onStats: () => {},
          },
          signal: abort.signal,
        })
        this.abortRegistry.delete(runId)
        this.runStore.update(runId, {
          status: 'completed',
          session_id: result.session.id,
          finished_at: new Date().toISOString(),
        })
      } catch (e: any) {
        this.abortRegistry.delete(runId)
        const existing = this.runStore.get(runId)
        if (existing?.status === 'running') {
          this.runStore.update(runId, {
            status: 'failed',
            error: e.message,
            finished_at: new Date().toISOString(),
          })
        }
        console.error(`[cron] run failed for profile ${this.profile.name}:`, e.message)
      }
    })
  }

  stop(): void {
    this.task?.stop()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/cron-scheduler.test.ts
```

Expected: PASS — 6 tests

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/scheduler/cron.ts tests/cron-scheduler.test.ts
git commit -m "feat: add CronScheduler for in-process cron triggers"
```

---

## Task 8: Server wiring — startup init + crash recovery

**Files:**
- Modify: `src/server/index.ts`

No new tests needed — server startup is covered by integration (the process boots and logs confirm it works). Crash-recovery logic is simple enough to verify manually.

- [ ] **Step 1: Add imports to `src/server/index.ts`**

Add after the existing imports (`existsSync` is already imported — do not duplicate it):

```typescript
import { RunStore } from '../runs/store.js'
import { CronScheduler } from '../scheduler/cron.js'
import { runProfileOnce } from './run-profile.js'
```

- [ ] **Step 2: Add run store + abort registry creation in `main()`**

Add after `const profile = loadProfile(profilePath)`:

```typescript
  const runStore = new RunStore()
  const abortRegistry = new Map<string, AbortController>()
```

- [ ] **Step 3: Add crash recovery after `const profile = loadProfile(profilePath)`**

Add after `const abortRegistry` declaration:

```typescript
  // Crash recovery: re-queue any runs left in 'running' state from a prior crash
  const stalledRuns = runStore.scanRunning()
  for (const run of stalledRuns) {
    const candidates = [
      resolve(process.cwd(), 'profiles', `${run.profile}.yaml`),
      resolve(homedir(), '.harness', 'profiles', `${run.profile}.yaml`),
    ]
    const runProfilePath = candidates.find(p => existsSync(p))
    if (!runProfilePath) {
      runStore.update(run.id, { status: 'failed', error: 'profile not found on restart', finished_at: new Date().toISOString() })
      console.warn(`[runs] stalled run ${run.id} failed: profile '${run.profile}' not found`)
      continue
    }
    const stalledProfile = loadProfile(runProfilePath)
    void runProfileOnce({
      profile: stalledProfile, userId: run.user,
      userMessage: typeof run.input === 'string' ? run.input : JSON.stringify(run.input),
      events: { onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onToolPrompt: async () => false, onSessionEnd: () => {}, onStats: () => {} },
    })
      .then(r => runStore.update(run.id, { status: 'completed', session_id: r.session.id, finished_at: new Date().toISOString() }))
      .catch(e => runStore.update(run.id, { status: 'failed', error: e.message, finished_at: new Date().toISOString() }))
    console.log(`[runs] re-queued stalled run ${run.id} (profile: ${run.profile})`)
  }
```

- [ ] **Step 5: Init `CronScheduler` and update `createRestHandler` call**

Replace:

```typescript
  const restHandler = createRestHandler({ defaultProfile: profile, apiKey })
```

With:

```typescript
  const scheduler = new CronScheduler(profile, runStore, abortRegistry)
  scheduler.init()
  if (profile.triggers?.cron) {
    console.log(`[cron] registered schedule '${profile.triggers.cron}' for profile '${profile.name}'`)
  }

  const restHandler = createRestHandler({ defaultProfile: profile, apiKey, runStore, abortRegistry })
```

- [ ] **Step 6: Stop scheduler on SIGINT**

Update the SIGINT handler to call `scheduler.stop()` before closing:

```typescript
  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    scheduler.stop()
    for (const ws of openSockets) ws.terminate()
    wss.close()
    httpServer.close()
    process.exit(0)
  })
```

- [ ] **Step 7: Typecheck and run full test suite**

```bash
pnpm typecheck && pnpm test
```

Expected: no type errors, all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: wire CronScheduler and crash recovery into server startup"
```

---

## Final verification

- [ ] **Smoke test: start the server**

```bash
pnpm dev
```

Expected output includes:
```
Harness server on ws://localhost:7337 [profile: ...]
REST endpoints: http://localhost:7337 (/run, /stream, /health)
```

- [ ] **Smoke test: POST /run creates a run record**

```bash
curl -s -X POST http://localhost:7337/run \
  -H 'content-type: application/json' \
  -d '{"input":"say hello"}' | jq .run_id
```

Expected: an 8-character run ID string

- [ ] **Smoke test: GET /runs lists it**

```bash
curl -s http://localhost:7337/runs | jq '.runs[0].status'
```

Expected: `"completed"`

- [ ] **Update ROADMAP.md**

Mark item #5 as `✅` in `docs/ROADMAP.md`.

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark ROADMAP #5 triggered + durable agents as complete"
```
