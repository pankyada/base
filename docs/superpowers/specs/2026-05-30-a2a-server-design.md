# A2A Server-Side Compatibility — Design Spec

> Roadmap item #6 (part 1 of 2 — A2A only; ACP is a separate spec)
> Date: 2026-05-30

---

## Overview

Expose the harness as a Google A2A (Agent-to-Agent protocol) server so external A2A-compatible agents can discover and call it. Two endpoints: an Agent Card for discovery and a task endpoint for execution. No client-side A2A calling in this iteration.

---

## Decisions

| Question | Decision |
|----------|----------|
| Scope | Server-side only (receiver); no outbound A2A client tool |
| Agent card content | Auto-derived: name + description from profile, skills from `loadAllSkills()` |
| Authentication | Both endpoints require `HARNESS_API_KEY` bearer auth |
| Code placement | Inline in `src/server/rest.ts` (same pattern as webhook + lifecycle routes) |
| Protocol | A2A enabled per-profile via `interop.a2a: true` |

---

## Profile Schema Changes

Two additions to `ProfileSchema` in `src/profiles/schema.ts`:

```typescript
// New top-level field
description: z.string().optional(),

// New interop block
interop: z.object({
  a2a: z.boolean().default(false),
}).optional(),
```

Example profile YAML:

```yaml
name: researcher
description: "A research agent that answers questions using web search"
interop:
  a2a: true
```

`interop.a2a: false` or absent → A2A routes return `404`. No breaking changes to existing profiles.

---

## New Routes

### `GET /.well-known/agent.json`

Returns the A2A Agent Card for this profile.

**Auth:** requires `HARNESS_API_KEY` bearer token (same check as all protected routes).

**Guard:** returns `404` if `profile.interop?.a2a !== true`.

**Response shape (A2A spec):**

```json
{
  "name": "researcher",
  "description": "A research agent that answers questions using web search",
  "url": "https://your-host/a2a",
  "version": "0.1.0",
  "capabilities": {
    "streaming": false
  },
  "skills": [
    {
      "id": "web-search",
      "name": "web-search",
      "description": "Search the web for answers"
    }
  ],
  "authentication": {
    "schemes": ["bearer"]
  }
}
```

**Field derivation:**
- `name` ← `profile.name`
- `description` ← `profile.description ?? ''`
- `url` ← `https://${req.headers.host}/a2a` (derived from request host header)
- `version` ← hardcoded `"0.1.0"` (same as REST version constant)
- `capabilities.streaming` ← `false` (v1 is synchronous only)
- `skills` ← `loadAllSkills()` result, mapped to `{ id, name, description }` from each skill's frontmatter
- `authentication.schemes` ← `["bearer"]` always

### `POST /a2a`

Accepts an A2A task, runs the profile, returns an A2A task response.

**Auth:** requires `HARNESS_API_KEY` bearer token.

**Guard:** returns `404` if `profile.interop?.a2a !== true`.

**Request shape (A2A spec):**

```json
{
  "id": "task-abc123",
  "message": {
    "role": "user",
    "parts": [
      { "type": "text", "text": "What is the capital of France?" }
    ]
  }
}
```

**Mapping:** all `parts` where `type === "text"` are concatenated (newline-joined) to form the `userMessage` passed to `runProfileOnce()`.

**Profile contract:** if the profile has a `contract.input` schema, it is **not** applied to A2A tasks — the message text is passed through as a plain string. A2A callers are not expected to know about harness-specific contract schemas.

**Success response:**

```json
{
  "id": "task-abc123",
  "status": { "state": "completed" },
  "artifacts": [
    {
      "parts": [{ "type": "text", "text": "Paris." }]
    }
  ]
}
```

**Error response:**

```json
{
  "id": "task-abc123",
  "status": {
    "state": "failed",
    "error": { "message": "agent loop error: ..." }
  }
}
```

**Run tracking:** `handleA2ATask` creates a run record with `trigger: 'a2a'` via `RunStore` in `RestDeps`. Requires `RunStore` to be present (lands with roadmap #5).

---

## Code Changes

### `RestDeps` (updated)

```typescript
export interface RestDeps {
  defaultProfile: Profile
  apiKey?: string
  runStore: RunStore
  abortRegistry: Map<string, AbortController>
  skills: Skill[]           // NEW — for agent card generation
}
```

`skills` is populated in `main()` from the existing `loadAllSkills(resolveSkillsDirs())` call.

### New helpers in `src/server/rest.ts`

```typescript
interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  capabilities: { streaming: boolean }
  skills: Array<{ id: string; name: string; description: string }>
  authentication: { schemes: string[] }
}

function buildAgentCard(profile: Profile, skills: Skill[], host: string): AgentCard {
  return {
    name: profile.name,
    description: profile.description ?? '',
    url: `https://${host}/a2a`,
    version: VERSION,
    capabilities: { streaming: false },
    skills: skills.map(s => ({ id: s.name, name: s.name, description: s.description })),
    authentication: { schemes: ['bearer'] },
  }
}
```

### New route handlers

```typescript
function handleAgentCard(req: IncomingMessage, res: ServerResponse, deps: RestDeps): void {
  if (!deps.defaultProfile.interop?.a2a) return sendJson(res, 404, { error: 'A2A not enabled' })
  const host = req.headers.host ?? 'localhost'
  sendJson(res, 200, buildAgentCard(deps.defaultProfile, deps.skills, host))
}

async function handleA2ATask(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  if (!deps.defaultProfile.interop?.a2a) return sendJson(res, 404, { error: 'A2A not enabled' })

  let body: { id?: string; message?: { parts?: Array<{ type: string; text?: string }> } }
  try { body = JSON.parse(await readBody(req)) } catch {
    return sendJson(res, 400, { error: 'malformed JSON body' })
  }

  const taskId = body.id ?? makeRunId()
  const parts = body.message?.parts ?? []
  const userMessage = parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('\n')
  if (!userMessage) return sendJson(res, 400, { error: 'no text parts in message' })

  const userId = sanitizeUserId(process.env.HARNESS_USER ?? 'anonymous')
  const runId = makeRunId()
  const abort = new AbortController()
  deps.abortRegistry.set(runId, abort)
  deps.runStore.create({
    id: runId, profile: deps.defaultProfile.name, user: userId,
    trigger: 'a2a', input: userMessage, status: 'running',
    started_at: new Date().toISOString(),
  })

  try {
    const result = await runProfileOnce({
      profile: deps.defaultProfile, userId, userMessage, events: headlessEvents(), signal: abort.signal,
    })
    deps.abortRegistry.delete(runId)
    deps.runStore.update(runId, { status: 'completed', session_id: result.session.id, finished_at: new Date().toISOString() })
    sendJson(res, 200, {
      id: taskId,
      status: { state: 'completed' },
      artifacts: [{ parts: [{ type: 'text', text: result.finalText }] }],
    })
  } catch (e: any) {
    deps.abortRegistry.delete(runId)
    const existing = deps.runStore.get(runId)
    if (existing?.status === 'running') {
      deps.runStore.update(runId, { status: 'failed', error: e.message, finished_at: new Date().toISOString() })
    }
    sendJson(res, 200, {
      id: taskId,
      status: { state: 'failed', error: { message: e.message } },
    })
  }
}
```

Note: A2A errors return HTTP `200` with `state: "failed"` per A2A spec convention — the transport succeeded; the task failed.

### Route registration in `createRestHandler`

```typescript
if (method === 'GET' && url === '/.well-known/agent.json') return handleAgentCard(req, res, deps)
if (method === 'POST' && url === '/a2a') return handleA2ATask(req, res, deps)
```

Both routes are **inside** the auth check (after the health exempt block).

### `src/server/index.ts`

Pass `skills` into `createRestHandler`:

```typescript
const restHandler = createRestHandler({ defaultProfile: profile, apiKey, runStore, abortRegistry, skills })
```

---

## Data Flow

```
GET /.well-known/agent.json
  → auth check
  → interop.a2a check (404 if false)
  → buildAgentCard(profile, skills, host)
  → 200 JSON

POST /a2a
  → auth check
  → interop.a2a check (404 if false)
  → parse body → extract text parts → join → userMessage
  → RunStore.create(trigger:'a2a')
  → runProfileOnce()
  → wrap in A2A artifact → 200 { id, status, artifacts }
  → RunStore.update(completed|failed)
```

---

## Skill Type Import

`Skill` type used in `RestDeps` and `buildAgentCard` comes from `src/skills/loader.ts`. Add import to `rest.ts`:

```typescript
import type { Skill } from '../skills/loader.js'
```

---

## Cross-Spec Dependencies

This spec depends on **Roadmap #5 (Triggered + durable agents)** landing first:

- `RunStore` and `abortRegistry` must be in `RestDeps` (added by #5)
- `makeRunId()` must be defined in `rest.ts` (added by #5)
- `Run.trigger` union in `src/runs/types.ts` must be extended to include `'a2a'` as part of this spec's implementation

If #5 has not landed, these three items must be added as part of this feature's implementation tasks.

---

## Out of Scope (v1)

- A2A client tool (outbound calls to external A2A agents)
- Streaming A2A responses (`capabilities.streaming: true`)
- ACP protocol (separate spec)
- Per-skill endpoint URLs in the agent card
- A2A task cancellation via `DELETE`
