# ACP Server-Side Compatibility — Design Spec

> Roadmap item #6 (part 2 of 2 — ACP only; A2A is a separate spec)
> Date: 2026-05-30

---

## Overview

Expose the harness as a BeeAI/IBM ACP (Agent Communication Protocol) server. Three endpoints: agent listing, run creation, and message streaming. ACP's async run model is handled via **deferred execution** — the run is created as `pending` on `POST /agents/:id/runs` and only starts executing when a client subscribes to `GET /runs/:id/messages`.

---

## Decisions

| Question | Decision |
|----------|----------|
| Scope | Server-side only; no outbound ACP client tool |
| Message delivery | SSE streaming (same as `/stream` endpoint) |
| Agents listed | Default profile only |
| Execution model | Deferred — run starts when `/messages` subscriber connects |
| Authentication | All three endpoints require `HARNESS_API_KEY` bearer auth |
| Code placement | Inline in `src/server/rest.ts` |

---

## Profile Schema Changes

Extend the existing `interop` block in `ProfileSchema` (`src/profiles/schema.ts`):

```typescript
interop: z.object({
  a2a: z.boolean().default(false),   // existing
  acp: z.boolean().default(false),   // NEW
}).optional(),
```

Example profile YAML:

```yaml
interop:
  a2a: true
  acp: true
```

`interop.acp: false` or absent → all three ACP routes return `404`.

---

## Run Type Changes

Two additions to `src/runs/types.ts`:

**`trigger` union** — add `'acp'`:

```typescript
trigger: 'rest' | 'stream' | 'cron' | 'webhook' | 'a2a' | 'acp'
```

**`status` union** — add `'pending'`:

```typescript
status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
```

`'pending'` represents a run that has been created (via `POST /agents/:id/runs`) but not yet started.

---

## New Routes

All three routes:
- Return `404` if `profile.interop?.acp !== true`
- Require `HARNESS_API_KEY` bearer auth (same block as all protected routes)

### `GET /agents`

Returns the default profile as a single ACP agent descriptor.

**Response:**

```json
{
  "agents": [
    {
      "agent_id": "researcher",
      "name": "researcher",
      "description": "A research agent that answers questions using web search"
    }
  ]
}
```

**Field derivation:**
- `agent_id` ← `profile.name`
- `name` ← `profile.name`
- `description` ← `profile.description ?? ''`

### `POST /agents/:id/runs`

Creates a pending run for the named agent. Does **not** start execution.

**Guard:** `:id` must equal `profile.name` → 404 otherwise.

**Request body:**

```json
{
  "input": [
    { "type": "text", "text": "What is the capital of France?" }
  ]
}
```

**Mapping:** all items where `type === "text"` are concatenated (newline-joined) to form the user message, stored in the run record for use by `/messages`.

**Validation:** body must be valid JSON with at least one `text` input item. Returns `400` if malformed or empty.

**On success:**
1. Creates a run record: `{ trigger: 'acp', status: 'pending', input: userMessage, ... }`
2. Returns immediately:

```json
{
  "run": {
    "id": "abc12345",
    "agent_id": "researcher",
    "status": "created"
  }
}
```

HTTP 200. No execution happens yet.

### `GET /runs/:id/messages`

Subscribes to a pending ACP run, starts execution, streams output as SSE.

**Guard:** run must exist AND `run.trigger === 'acp'` AND `run.status === 'pending'` → 404 if not found or wrong type; 409 if already running/completed/failed.

**On connect:**
1. Sets `Content-Type: text/event-stream`
2. Updates run to `status: 'running'`
3. Calls `runProfileOnce()` with SSE events wired up
4. Streams events:

```
event: message
data: {"type":"token","content":"Par"}

event: message
data: {"type":"token","content":"is."}

event: message
data: {"type":"tool_start","name":"web_search","input":{...}}

event: message
data: {"type":"tool_end","name":"web_search","result":"..."}

event: done
data: {"type":"done","output":"Paris.","session_id":"abc12345","run_id":"run00001"}
```

5. On complete: `RunStore.update(completed)`, close SSE
6. On error: `event: error\ndata: {"message":"..."}`, `RunStore.update(failed)`, close SSE
7. On client disconnect (req close): aborts the run via `AbortController`

---

## Code Changes

### New handlers in `src/server/rest.ts`

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

async function handleAcpCreateRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps, agentId: string): Promise<void> {
  if (!deps.defaultProfile.interop?.acp) return sendJson(res, 404, { error: 'ACP not enabled' })
  if (agentId !== deps.defaultProfile.name) return sendJson(res, 404, { error: `agent '${agentId}' not found` })

  let body: { input?: Array<{ type: string; text?: string }> }
  try { body = JSON.parse(await readBody(req)) } catch {
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
    deps.runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
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

### Route registration in `createRestHandler`

Order matters — `/runs/:id/messages` must be matched before the generic `/runs/:id`:

```typescript
if (method === 'GET' && url === '/agents') return handleAcpAgents(req, res, deps)
if (method === 'POST' && url.startsWith('/agents/') && url.endsWith('/runs')) {
  return handleAcpCreateRun(req, res, deps, url.slice('/agents/'.length, -'/runs'.length))
}
if (method === 'GET' && url.startsWith('/runs/') && url.endsWith('/messages')) {
  return handleAcpMessages(req, res, deps, url.slice('/runs/'.length, -'/messages'.length))
}
```

All three are placed after the auth check block, before the final 404.

---

## Data Flow

```
GET /agents
  → auth + acp check
  → return [{ agent_id: profile.name, ... }]

POST /agents/:id/runs
  → auth + acp check
  → validate :id === profile.name
  → extract text input → userMessage
  → RunStore.create(trigger:'acp', status:'pending')
  → return { run: { id, status:'created' } }

GET /runs/:id/messages
  → auth + acp check
  → RunStore.get(id) → verify trigger=acp, status=pending → 404/409 otherwise
  → RunStore.update(running)
  → open SSE → runProfileOnce()
  → stream token/tool events as 'message' SSE events
  → on complete: RunStore.update(completed) → 'done' event → close
  → on error: RunStore.update(failed) → 'error' event → close
  → on disconnect: abort → RunStore.update(cancelled) → close
```

---

## Cross-Spec Dependencies

Requires **#5 (Triggered + durable agents)** and **#6a (A2A server)** to have landed:

- `RunStore`, `abortRegistry`, `makeRunId()` from #5
- `interop` block in `ProfileSchema` from #6a (this spec extends it with `acp`)
- `Run.trigger` already extended with `'a2a'` by #6a; this spec adds `'acp'`
- `Run.status` must be extended with `'pending'` (new in this spec)

---

## Out of Scope (v1)

- ACP client tool (outbound calls to external ACP agents)
- Multiple concurrent subscribers on a single run
- Run resumption after server restart (pending runs are lost on crash)
- ACP run cancellation via `DELETE`
- Pagination on `GET /agents`
