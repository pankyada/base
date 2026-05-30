# Triggered + Durable Agents — Design Spec

> Roadmap item #5
> Date: 2026-05-30

---

## Overview

Extends the harness so agents can be woken by external events (cron schedules, HTTP webhooks) rather than only by interactive WS chat or REST calls. Adds shallow durability (run records persisted before/after every execution, crashed runs re-queued on restart) and a run lifecycle API (`GET /runs`, `GET /runs/:id`, `DELETE /runs/:id`) that covers all execution paths.

---

## Decisions

| Question | Decision |
|----------|----------|
| Cron scheduler location | In-process (`node-cron`); default profile only |
| Webhook endpoint shape | Dedicated `POST /webhooks/<profile-name>` per profile |
| Durability depth | Shallow — run record pre/post; re-queue on restart |
| Run tracking scope | All runs: cron, webhook, `/run`, `/stream` |
| Run storage | Flat files at `~/.harness/runs/<user>/<id>.json` |
| Cancel mechanism | In-process `Map<runId, AbortController>` |

---

## New Modules

### `src/runs/types.ts`

```typescript
export interface Run {
  id: string                                             // 8-char UUID slug
  profile: string                                        // profile name
  user: string                                           // sanitized user id
  trigger: 'rest' | 'stream' | 'cron' | 'webhook'
  input: unknown                                         // original input payload
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  session_id?: string                                    // linked after completion
  started_at: string                                     // ISO timestamp
  finished_at?: string
  error?: string                                         // populated on failure
}
```

### `src/runs/store.ts` — `RunStore`

Persists one JSON file per run at `~/.harness/runs/<user>/<id>.json`, mirroring the sessions pattern.

```typescript
class RunStore {
  create(run: Run): void
  update(user: string, id: string, patch: Partial<Run>): void
  get(id: string): Run | null          // scans all user subdirs; O(users × files)
  list(opts: {
    user?: string                      // if omitted, scans all users (admin view)
    status?: Run['status']
    profile?: string
    limit?: number                     // default 50
  }): Run[]
  scanRunning(): Run[]                 // returns all status:'running' across all users
}
```

`get()` and `delete()` find a run by ID by scanning user subdirectories — consistent with how `listSessions` works and acceptable at the scale this harness targets.

### `src/runs/registry.ts`

No file needed. The abort registry is a plain `Map<string, AbortController>` created once in `main()` and passed as a constructor/function argument to `CronScheduler` and `createRestHandler`. This keeps it injectable and testable without a module-level singleton.

### `src/scheduler/cron.ts` — `CronScheduler`

```typescript
class CronScheduler {
  constructor(
    private profile: Profile,
    private runStore: RunStore,
    private abortRegistry: Map<string, AbortController>,
  ) {}

  init(): void   // registers cron job if profile.triggers?.cron is set
  stop(): void   // cancels all scheduled jobs (called on SIGINT)
}
```

- Uses `node-cron` to register the expression from `profile.triggers.cron`
- On each fire: creates a run record (`trigger: 'cron'`, `user: HARNESS_USER ?? 'anonymous'`), registers an `AbortController`, calls `runProfileOnce()`, updates run record to `completed` or `failed`, removes from registry
- `cron_input` (if set) is passed as the user message; validated against `contract.input` **at startup** (fail-fast — misconfigured profiles error immediately, not at first fire)

---

## Profile Schema Changes

New optional `triggers` block added to `ProfileSchema` in `src/profiles/schema.ts`:

```yaml
triggers:
  cron: "0 9 * * *"   # standard 5-field cron expression
  webhook: true         # if true, enables POST /webhooks/<profile-name>
  cron_input: {}        # static input payload for cron runs; optional
                        # validated against contract.input at startup if contract present
```

```typescript
triggers: z.object({
  cron: z.string().optional(),
  webhook: z.boolean().default(false),
  cron_input: z.record(z.string(), z.unknown()).optional(),
}).optional(),
```

---

## REST Changes

### `RestDeps` (updated)

```typescript
export interface RestDeps {
  defaultProfile: Profile
  apiKey?: string
  runStore: RunStore                              // NEW
  abortRegistry: Map<string, AbortController>    // NEW
}
```

Both created once in `main()` and shared with `CronScheduler`.

### New routes

#### `POST /webhooks/:profile`

- Extracts profile name from URL path
- Loads profile via `findProfilePath(name)` (existing helper)
- Returns `404` if profile not found or `profile.triggers?.webhook !== true`
- Auth: same `HARNESS_API_KEY` bearer check as all other routes
- Body: `{ input, user? }` — validated against profile contract if present
- Creates run record (`trigger: 'webhook'`), registers AbortController, calls `runProfileOnce()`, updates record, returns `{ run_id, output, usage, session_id }`
- **v1 limitation:** response is synchronous; callers with long-running agents may time out. Async webhook support is future work.

#### `GET /runs`

Query params: `?user=`, `?status=`, `?profile=`, `?limit=` (default 50).

Without `?user=`, returns runs across all users (admin view — any caller with the API key).

Response:
```json
{ "runs": [ Run, ... ] }
```

#### `GET /runs/:id`

Scans user subdirs to find run by ID. Returns `404` if not found.

Response: `Run`

#### `DELETE /runs/:id`

- Finds run; returns `404` if not found
- Returns `409` if `status` is already `completed`, `failed`, or `cancelled`
- Calls `abortRegistry.get(id)?.abort()`
- Updates run record to `status: 'cancelled'`, sets `finished_at`
- Returns `{ ok: true }`

### Updated existing routes (`/run`, `/stream`)

Both handlers now:
1. Create a run record before calling `runProfileOnce()` (`trigger: 'rest'` or `'stream'`)
2. Register the AbortController in `abortRegistry`
3. Update the run record to `completed`/`failed` after the call
4. Remove the AbortController from the registry

`runProfileOnce()` signature is unchanged.

---

## Server Startup Changes (`src/server/index.ts`)

```typescript
// In main():
const runStore = new RunStore()
const abortRegistry = new Map<string, AbortController>()

const scheduler = new CronScheduler(profile, runStore, abortRegistry)
scheduler.init()

// Crash recovery: re-queue any runs left in 'running' state
const stalled = runStore.scanRunning()
for (const run of stalled) {
  const profilePath = findProfilePath(run.profile)
  if (!profilePath) {
    runStore.update(run.user, run.id, { status: 'failed', error: 'profile not found on restart', finished_at: new Date().toISOString() })
    continue
  }
  const p = loadProfile(profilePath)
  void runProfileOnce({ profile: p, userId: run.user, userMessage: String(run.input), events: headlessEvents() })
    .then(r => runStore.update(run.user, run.id, { status: 'completed', session_id: r.session.id, finished_at: new Date().toISOString() }))
    .catch(e => runStore.update(run.user, run.id, { status: 'failed', error: e.message, finished_at: new Date().toISOString() }))
}

const restHandler = createRestHandler({ defaultProfile: profile, apiKey, runStore, abortRegistry })

// SIGINT: stop scheduler before closing sockets
process.on('SIGINT', () => {
  scheduler.stop()
  // ... existing shutdown
})
```

---

## Data Flow

```
startup
  → scanRunning()
  → for each stalled run: load profile → re-queue runProfileOnce() or mark failed

cron fires
  → RunStore.create(trigger:'cron') → abortRegistry.set()
  → runProfileOnce() → RunStore.update(completed|failed) → abortRegistry.delete()

POST /webhooks/:profile
  → validate profile + webhook flag + contract
  → RunStore.create(trigger:'webhook') → abortRegistry.set()
  → runProfileOnce() → RunStore.update() → respond { run_id, output, ... }

POST /run
  → RunStore.create(trigger:'rest') → abortRegistry.set()
  → runProfileOnce() → RunStore.update() → respond

POST /stream
  → RunStore.create(trigger:'stream') → abortRegistry.set()
  → runProfileOnce() (SSE) → RunStore.update() → close SSE

DELETE /runs/:id
  → abortRegistry.get(id)?.abort()
  → RunStore.update(cancelled)
```

---

## New Dependency

| Package | Purpose | Size |
|---------|---------|------|
| `node-cron` | Cron expression parsing + scheduling | ~20 KB, no native bindings |

---

## Storage Layout

```
~/.harness/
  runs/
    <user>/
      <YYYY-MM-DD>_<id>.json    # one Run record per file; mirrors sessions naming
  sessions/
    <user>/               # existing
  usage/
    <user>.json           # existing
```

---

## Out of Scope (v1)

- Async webhook responses (fire-and-forget + polling)
- Multiple profiles with cron in a single server instance
- Run output streaming via `GET /runs/:id/stream`
- Run pagination (cursor-based)
- Webhook signature verification (HMAC)
