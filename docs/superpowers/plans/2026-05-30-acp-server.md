# ACP Server-Side Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the harness as an ACP (Agent Communication Protocol) server — `GET /agents`, `POST /agents/:id/runs`, `GET /runs/:id/messages` — with deferred execution and SSE streaming.

**Architecture:** Three new route handlers inline in `src/server/rest.ts`, gated by `interop.acp: true`. `POST /agents/:id/runs` creates a `pending` run record without executing. `GET /runs/:id/messages` starts execution and streams SSE. Uses existing `RunStore`, `abortRegistry`, and `makeRunId()` from #5.

**Tech Stack:** TypeScript, vitest, Node.js http SSE — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-30-acp-server-design.md`

---

## Prerequisites

These must exist before starting (land with prior roadmap items):

| What | From |
|------|------|
| `RunStore`, `abortRegistry`, `makeRunId()` in `rest.ts` | Roadmap #5 |
| `RestDeps.skills` + `interop` block in `ProfileSchema` | Roadmap #6a (A2A) |
| `Run.trigger` includes `'a2a'` | Roadmap #6a (A2A) |

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/profiles/schema.ts` | Add `acp: boolean` to existing `interop` block |
| Modify | `src/runs/types.ts` | Add `'acp'` to trigger union; add `'pending'` to status union |
| Modify | `src/server/rest.ts` | `handleAcpAgents`, `handleAcpCreateRun`, `handleAcpMessages`; 3 routes |
| Modify | `tests/profile-schema.test.ts` | Tests for `interop.acp` field |
| Modify | `tests/rest.test.ts` | ACP route tests |

---

## Task 1: Add `interop.acp` to `ProfileSchema`

**Files:**
- Modify: `src/profiles/schema.ts`
- Modify: `tests/profile-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/profile-schema.test.ts` (after existing describe blocks):

```typescript
describe('ProfileSchema – interop.acp', () => {
  it('interop.acp defaults to false when interop block is present without acp', () => {
    const p = ProfileSchema.parse({ ...BASE, interop: { a2a: true } })
    expect(p.interop?.acp).toBe(false)
  })

  it('parses interop.acp: true', () => {
    const p = ProfileSchema.parse({ ...BASE, interop: { acp: true } })
    expect(p.interop?.acp).toBe(true)
  })

  it('interop.a2a and interop.acp can both be true', () => {
    const p = ProfileSchema.parse({ ...BASE, interop: { a2a: true, acp: true } })
    expect(p.interop?.a2a).toBe(true)
    expect(p.interop?.acp).toBe(true)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run tests/profile-schema.test.ts
```

Expected: FAIL — new describe block fails (no `acp` field on `interop`)

- [ ] **Step 3: Add `acp` to the `interop` block in `src/profiles/schema.ts`**

Find the existing `interop` schema definition and add `acp`:

```typescript
// Before:
interop: z.object({
  a2a: z.boolean().default(false),
}).optional(),

// After:
interop: z.object({
  a2a: z.boolean().default(false),
  acp: z.boolean().default(false),
}).optional(),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/profile-schema.test.ts
```

Expected: PASS — all tests

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/profiles/schema.ts tests/profile-schema.test.ts
git commit -m "feat: add interop.acp field to ProfileSchema"
```

---

## Task 2: Extend `Run` type — `'acp'` trigger + `'pending'` status

**Files:**
- Modify: `src/runs/types.ts`

- [ ] **Step 1: Update both unions in `src/runs/types.ts`**

```typescript
// Before:
export interface Run {
  id: string
  profile: string
  user: string
  trigger: 'rest' | 'stream' | 'cron' | 'webhook' | 'a2a'
  input: unknown
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  session_id?: string
  started_at: string
  finished_at?: string
  error?: string
}

// After:
export interface Run {
  id: string
  profile: string
  user: string
  trigger: 'rest' | 'stream' | 'cron' | 'webhook' | 'a2a' | 'acp'
  input: unknown
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  session_id?: string
  started_at: string
  finished_at?: string
  error?: string
}
```

- [ ] **Step 2: Typecheck and run tests**

```bash
pnpm typecheck && pnpm test
```

Expected: no errors, all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/runs/types.ts
git commit -m "feat: extend Run type with 'acp' trigger and 'pending' status"
```

---

## Task 3: `GET /agents`

**Files:**
- Modify: `src/server/rest.ts`
- Modify: `tests/rest.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/rest.test.ts`:

```typescript
describe('REST ACP — GET /agents', () => {
  const ACP_PROFILE = {
    name: 'myagent',
    description: 'A smart ACP agent',
    interop: { a2a: false, acp: true },
    contract: undefined,
  } as any

  it('returns 404 when interop.acp is false', async () => {
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/agents`)
    expect(res.status).toBe(404)
    server.close()
  })

  it('returns 401 without bearer when apiKey is set', async () => {
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: 'secret', runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/agents`)
    expect(res.status).toBe(401)
    server.close()
  })

  it('returns agent list with default profile when acp is enabled', async () => {
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/agents`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agents).toHaveLength(1)
    expect(body.agents[0]).toEqual({ agent_id: 'myagent', name: 'myagent', description: 'A smart ACP agent' })
    server.close()
  })

  it('returns empty description when profile has no description', async () => {
    const profile = { name: 'noname', interop: { acp: true }, contract: undefined } as any
    const handler = createRestHandler({ defaultProfile: profile, apiKey: undefined, runStore: makeMockRunStore(), abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/agents`)
    const body = await res.json()
    expect(body.agents[0].description).toBe('')
    server.close()
  })
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx vitest run tests/rest.test.ts -t "ACP — GET /agents"
```

Expected: FAIL — `/agents` route does not exist

- [ ] **Step 3: Add `handleAcpAgents` to `src/server/rest.ts`**

Add this handler before `createRestHandler`:

```typescript
function handleAcpAgents(req: IncomingMessage, res: ServerResponse, deps: RestDeps): void {
  if (!deps.defaultProfile.interop?.acp) return sendJson(res, 404, { error: 'ACP not enabled' })
  sendJson(res, 200, {
    agents: [{
      agent_id: deps.defaultProfile.name,
      name: deps.defaultProfile.name,
      description: deps.defaultProfile.description ?? '',
    }],
  })
}
```

Add the route inside `createRestHandler` (after auth check, before the final 404):

```typescript
    if (method === 'GET' && url === '/agents') return handleAcpAgents(req, res, deps)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/rest.test.ts -t "ACP"
```

Expected: PASS — GET /agents tests pass

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/server/rest.ts tests/rest.test.ts
git commit -m "feat: add GET /agents ACP endpoint"
```

---

## Task 4: `POST /agents/:id/runs`

**Files:**
- Modify: `src/server/rest.ts`
- Modify: `tests/rest.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/rest.test.ts`:

```typescript
describe('REST ACP — POST /agents/:id/runs', () => {
  const ACP_PROFILE = {
    name: 'myagent',
    description: 'A smart ACP agent',
    interop: { a2a: false, acp: true },
    contract: undefined,
  } as any

  let server: Server, base: string
  let mockRunStore: RunStore

  beforeAll(async () => {
    mockRunStore = makeMockRunStore()
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: mockRunStore, abortRegistry: new Map(), skills: [] })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 404 when agent id does not match profile name', async () => {
    const res = await fetch(`${base}/agents/wrongname/runs`, {
      method: 'POST',
      body: JSON.stringify({ input: [{ type: 'text', text: 'hello' }] }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 for malformed JSON', async () => {
    const res = await fetch(`${base}/agents/myagent/runs`, { method: 'POST', body: 'not json' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when no text input items', async () => {
    const res = await fetch(`${base}/agents/myagent/runs`, {
      method: 'POST',
      body: JSON.stringify({ input: [{ type: 'image' }] }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when input array is missing', async () => {
    const res = await fetch(`${base}/agents/myagent/runs`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('creates a pending run record and returns run id', async () => {
    const res = await fetch(`${base}/agents/myagent/runs`, {
      method: 'POST',
      body: JSON.stringify({ input: [{ type: 'text', text: 'What is the capital of France?' }] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.run.status).toBe('created')
    expect(typeof body.run.id).toBe('string')
    expect(body.run.id).toHaveLength(8)
    expect(body.run.agent_id).toBe('myagent')
    expect(mockRunStore.create).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'acp',
      status: 'pending',
      input: 'What is the capital of France?',
    }))
  })

  it('concatenates multiple text input items', async () => {
    await fetch(`${base}/agents/myagent/runs`, {
      method: 'POST',
      body: JSON.stringify({ input: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'World' }] }),
    })
    expect(mockRunStore.create).toHaveBeenCalledWith(expect.objectContaining({ input: 'Hello\nWorld' }))
  })
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx vitest run tests/rest.test.ts -t "POST /agents"
```

Expected: FAIL — route does not exist

- [ ] **Step 3: Add `handleAcpCreateRun` to `src/server/rest.ts`**

Add before `createRestHandler`:

```typescript
async function handleAcpCreateRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps, agentId: string): Promise<void> {
  if (!deps.defaultProfile.interop?.acp) return sendJson(res, 404, { error: 'ACP not enabled' })
  if (agentId !== deps.defaultProfile.name) return sendJson(res, 404, { error: `agent '${agentId}' not found` })

  let body: { input?: Array<{ type: string; text?: string }> }
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return sendJson(res, 400, { error: 'malformed JSON body' })
  }

  const input = body.input ?? []
  const userMessage = input.filter(i => i.type === 'text').map(i => i.text ?? '').join('\n')
  if (!userMessage) return sendJson(res, 400, { error: 'no text input items' })

  const runId = makeRunId()
  const userId = sanitizeUserId(process.env.HARNESS_USER ?? 'anonymous')
  deps.runStore.create({
    id: runId,
    profile: deps.defaultProfile.name,
    user: userId,
    trigger: 'acp',
    input: userMessage,
    status: 'pending',
    started_at: new Date().toISOString(),
  })

  sendJson(res, 200, { run: { id: runId, agent_id: deps.defaultProfile.name, status: 'created' } })
}
```

Add the route inside `createRestHandler` (after the `/agents` route, before final 404):

```typescript
    if (method === 'POST' && url.startsWith('/agents/') && url.endsWith('/runs')) {
      return handleAcpCreateRun(req, res, deps, url.slice('/agents/'.length, -'/runs'.length))
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/rest.test.ts -t "ACP"
```

Expected: PASS — all ACP tests so far

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/server/rest.ts tests/rest.test.ts
git commit -m "feat: add POST /agents/:id/runs ACP endpoint"
```

---

## Task 5: `GET /runs/:id/messages`

**Files:**
- Modify: `src/server/rest.ts`
- Modify: `tests/rest.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/rest.test.ts`:

```typescript
describe('REST ACP — GET /runs/:id/messages', () => {
  const ACP_PROFILE = {
    name: 'myagent',
    description: 'A smart ACP agent',
    interop: { a2a: false, acp: true },
    contract: undefined,
  } as any

  const PENDING_RUN = {
    id: 'run00001',
    profile: 'myagent',
    user: 'anonymous',
    trigger: 'acp' as const,
    input: 'What is the capital of France?',
    status: 'pending' as const,
    started_at: new Date().toISOString(),
  }

  it('returns 404 when run is not found', async () => {
    const store = makeMockRunStore()
    vi.mocked(store.get).mockReturnValue(null)
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/runs/notfound/messages`)
    expect(res.status).toBe(404)
    server.close()
  })

  it('returns 404 when run exists but trigger is not acp', async () => {
    const store = makeMockRunStore()
    vi.mocked(store.get).mockReturnValue({ ...PENDING_RUN, trigger: 'rest' as any })
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/runs/run00001/messages`)
    expect(res.status).toBe(404)
    server.close()
  })

  it('returns 409 when run is not pending', async () => {
    const store = makeMockRunStore()
    vi.mocked(store.get).mockReturnValue({ ...PENDING_RUN, status: 'completed' as any })
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)
    const res = await fetch(`${base}/runs/run00001/messages`)
    expect(res.status).toBe(409)
    server.close()
  })

  it('streams SSE messages and done event on success', async () => {
    vi.mocked(runProfileOnce).mockImplementation(async (opts: any) => {
      opts.events.onToken('Par')
      opts.events.onToken('is.')
      return { finalText: 'Paris.', usage: { tokens_in: 2, tokens_out: 3, cost_usd: 0 }, session: { id: 'sx1' } as any }
    })
    const store = makeMockRunStore()
    vi.mocked(store.get).mockReturnValue(PENDING_RUN)
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)

    const res = await fetch(`${base}/runs/run00001/messages`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('event: message')
    expect(text).toContain('"type":"token"')
    expect(text).toContain('"content":"Par"')
    expect(text).toContain('event: done')
    expect(text).toContain('"output":"Paris."')
    expect(store.update).toHaveBeenCalledWith('run00001', expect.objectContaining({ status: 'running' }))
    expect(store.update).toHaveBeenCalledWith('run00001', expect.objectContaining({ status: 'completed' }))
    server.close()
  })

  it('streams error event and marks run failed when agent throws', async () => {
    vi.mocked(runProfileOnce).mockRejectedValue(new Error('model timeout'))
    const store = makeMockRunStore()
    vi.mocked(store.get).mockReturnValue(PENDING_RUN)
    const handler = createRestHandler({ defaultProfile: ACP_PROFILE, apiKey: undefined, runStore: store, abortRegistry: new Map(), skills: [] })
    const { server, base } = await startServer(handler)

    const res = await fetch(`${base}/runs/run00001/messages`)
    const text = await res.text()
    expect(text).toContain('event: error')
    expect(text).toContain('"message":"model timeout"')
    server.close()
  })
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx vitest run tests/rest.test.ts -t "messages"
```

Expected: FAIL — `/runs/:id/messages` route does not exist

- [ ] **Step 3: Add `handleAcpMessages` to `src/server/rest.ts`**

Add before `createRestHandler`:

```typescript
async function handleAcpMessages(req: IncomingMessage, res: ServerResponse, deps: RestDeps, runId: string): Promise<void> {
  if (!deps.defaultProfile.interop?.acp) return sendJson(res, 404, { error: 'ACP not enabled' })

  const run = deps.runStore.get(runId)
  if (!run || run.trigger !== 'acp') return sendJson(res, 404, { error: 'run not found' })
  if (run.status !== 'pending') return sendJson(res, 409, { error: `run is already ${run.status}` })

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const abort = new AbortController()
  req.on('close', () => abort.abort())
  deps.abortRegistry.set(runId, abort)
  deps.runStore.update(runId, { status: 'running' })

  const events: AgentLoopEvents = {
    onToken: t => sse('message', { type: 'token', content: t }),
    onToolStart: (n, i) => sse('message', { type: 'tool_start', name: n, input: i }),
    onToolEnd: (n, r) => sse('message', { type: 'tool_end', name: n, result: r }),
    onToolPrompt: async () => false,
    onSessionEnd: () => {},
    onStats: () => {},
  }

  try {
    const result = await runProfileOnce({
      profile: deps.defaultProfile,
      userId: run.user,
      userMessage: run.input as string,
      events,
      signal: abort.signal,
    })
    deps.abortRegistry.delete(runId)
    deps.runStore.update(runId, {
      status: 'completed',
      session_id: result.session.id,
      finished_at: new Date().toISOString(),
    })
    sse('done', { type: 'done', output: result.finalText, session_id: result.session.id, run_id: runId })
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
    if ((e as Error).name !== 'AbortError') sse('error', { message: e.message })
  } finally {
    res.end()
  }
}
```

Add the route inside `createRestHandler`. **Important: this must be placed BEFORE the generic `GET /runs/:id` route** to avoid the generic handler consuming `runs/:id/messages` URLs:

```typescript
    if (method === 'GET' && url.startsWith('/runs/') && url.endsWith('/messages')) {
      return handleAcpMessages(req, res, deps, url.slice('/runs/'.length, -'/messages'.length))
    }
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
npx vitest run tests/rest.test.ts
```

Expected: PASS — all tests including the ACP messages describe block

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/server/rest.ts tests/rest.test.ts
git commit -m "feat: add GET /runs/:id/messages ACP SSE streaming endpoint"
```

---

## Final verification

- [ ] **Run full test suite**

```bash
pnpm test
```

Expected: all tests pass

- [ ] **Start the server with ACP enabled**

Add to your local profile YAML:

```yaml
interop:
  acp: true
```

Then:

```bash
pnpm dev
```

- [ ] **List agents**

```bash
curl -s http://localhost:7337/agents | jq .
```

Expected: `{ "agents": [{ "agent_id": "...", "name": "...", "description": "..." }] }`

- [ ] **Create a run**

```bash
curl -s -X POST http://localhost:7337/agents/<profile-name>/runs \
  -H 'content-type: application/json' \
  -d '{"input":[{"type":"text","text":"say hello"}]}' | jq .
```

Expected: `{ "run": { "id": "abc12345", "agent_id": "...", "status": "created" } }`

- [ ] **Subscribe to messages (copy the run id from previous step)**

```bash
curl -s http://localhost:7337/runs/<run-id>/messages
```

Expected: SSE stream with `event: message` lines followed by `event: done`.

- [ ] **Push to remote**

```bash
git push origin main
```

- [ ] **Update ROADMAP.md**

Mark item #6 as fully complete (both A2A and ACP done):

```markdown
### ✅ 6. A2A + ACP compatibility
```

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark ROADMAP #6 A2A + ACP as complete"
git push origin main
```
