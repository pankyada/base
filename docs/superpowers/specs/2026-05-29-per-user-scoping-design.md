# Per-User Identity & Scoping — Design

> **Status:** Approved design, ready for implementation plan.
> **Date:** 2026-05-29

## Goal

Let a single harness server instance serve multiple users with isolated **sessions**, **memory**, and **usage tracking** — without introducing authentication infrastructure. Identity is supplied by the client and trusted; real auth can layer on later without changing the scoping core.

## Non-Goals

- Authentication / authorization (no tokens, no IdP).
- Budget enforcement or limits (tracking only — no blocking, no soft caps).
- Per-user usage UI (the ledger is plain JSON; a viewer can come later).
- Migration of pre-existing session files (project is not productionised; old loose files are ignored / deleted manually).

## Architecture Overview

Approach: **`user` on `Session` + a single path helper.** No new runtime abstraction (no `UserContext` object, no user registry). Isolation is path-based on disk. The on-disk layout lives in exactly one helper so it is never string-built ad hoc across modules.

### Disk layout

```
~/.harness/sessions/{user}/{date}_{id}.json     # sessions, per-user (was flat)
{artifact_dir}/memory/*.md                        # SHARED memory (unchanged path)
{artifact_dir}/users/{user}/memory/*.md           # PRIVATE memory (new)
~/.harness/usage/{user}.json                      # per-user spend ledger (new)
```

## Section 1 — Identity Flow & Protocol

**Client (TUI/CLI):**
- Derive `user_id` once at startup: `process.env.HARNESS_USER ?? os.userInfo().username`.
- Sanitize to a safe slug (lowercase, `[^a-z0-9_-]` → `-`, cap 64 chars). Empty/unresolvable → `"default"`.
- Send once on connect via a new `hello` message (identity is connection-stable; not repeated per message).

**Protocol (`src/types.ts`):**
```ts
export type ClientMessage =
  | { type: 'hello'; user_id: string }   // NEW — sent once on connect
  | { type: 'message'; content: string }
  | { type: 'cancel' }
  | { type: 'resume'; sessionId: string }
  | { type: 'tool_approve'; id: string }
  | { type: 'tool_deny'; id: string }
```

**Server (`src/server/index.ts`):**
- Per-connection `let userId = 'default'` until `hello` arrives.
- On `hello`: re-sanitize server-side (never trust client on path-safety), set `userId`, recreate `session` + `memory` bound to that user.
- A `message` before `hello` proceeds as `"default"` — no hard failure, keeps raw WS clients working.

**New helper (`src/session/user-paths.ts`):**
```ts
export function sanitizeUserId(raw: string): string
export function userPaths(user: string, artifactDir: string): {
  sessionsDir: string   // ~/.harness/sessions/{user}
  privateMemDir: string // {artifactDir}/users/{user}/memory
  usageFile: string     // ~/.harness/usage/{user}.json
}
```
Single source of truth for layout. `sanitizeUserId` is used at the `hello` boundary and again inside `userPaths` (defense in depth — no `../` traversal).

## Section 2 — Session Isolation

**`Session` type (`src/session/types.ts`):** add `user: string`.

**`createSession(profileName, user)`** sets `user` on the new session.

**Store functions become user-scoped**, deriving paths from `userPaths()`:
- `saveSession(session)` → `~/.harness/sessions/{session.user}/{date}_{id}.json`
- `loadSession(user, id)` → only searches that user's directory
- `listSessions(user)` → NEW, user-scoped (for resume UX)

**Resume isolation:** `loadSession(userId, id)` only looks in the caller's directory. Cross-user resume returns `null` → existing "Session not found" path. No new error type, no leak of whether another user's session exists.

**Server wiring:** `createSession(profile.name, userId)` on `hello` (and on first connect as `"default"`); `resume` handler calls `loadSession(userId, msg.sessionId)`.

**Migration:** none. Old flat `sessions/*.json` files are ignored (deleted manually if desired).

## Section 3 — Two-Tier Memory

**Scope enum (`src/memory/interface.ts`):** `'session' | 'profile' | 'user'`
- `session` — in-memory, per-session (unchanged).
- `profile` — SHARED pool, `{artifact_dir}/memory/*.md` (unchanged path).
- `user` — PRIVATE pool, `{artifact_dir}/users/{user}/memory/*.md` (new).

**`FsMemoryProvider`:** already receives `session`, so it reads `session.user`. Add a private-mem-dir getter via `userPaths()`. `read`/`write`/`delete`/`list` gain a `'user'` branch mirroring the `'profile'` branch but pointed at the private dir. Each tier maintains its own `MEMORY.md` index and `rebuildIndex()`.

**Read merge — `buildSystemPromptSection()`:** concatenate both indexes when present, labeled:
```
## Memory (shared)
<profile MEMORY.md>

## Memory (yours)
<user MEMORY.md>
```
Either tier absent → that part omitted.

**Write default:** the `MemoryWrite` tool's `scope` param gains `'user'`, and `user` (private) becomes the **default** when scope is omitted. The agent must opt *up* to `profile` to share — prevents accidental cross-user leakage.

**Improver (`src/improver/default-improver.ts`):** per-session reflections write to `user` scope; mined skills (cross-session, general-purpose) stay `profile`/shared. One-line scope change at each write site.

## Section 4 — Per-User Usage Tracking (track-only)

A per-user JSON ledger at `~/.harness/usage/{user}.json`:
```json
{
  "user": "pankaj",
  "total": { "input": 0, "output": 0, "cost_usd": 0 },
  "by_month": {
    "2026-05": { "input": 0, "output": 0, "cost_usd": 0 }
  },
  "updated_at": "2026-05-29T..."
}
```

**New module `src/usage/ledger.ts`:**
```ts
recordUsage(user: string, delta: { input: number; output: number; cost_usd: number }): void
```
Reads the user's file (or starts a fresh zeroed one), adds the delta to `total` and the current month bucket, updates `updated_at`, writes back.

**Call site:** once per session, in the server's `ws.on('close')` handler next to `saveSession`, using final `session.usage`. Single call site → no double-counting.

**Concurrency:** writes happen once per session at close (not per token), so the collision window for concurrent connections of the same user is tiny. Accept last-write-wins; no file locking (deliberate trade-off for a non-productionised tool).

**Reading back:** no UI in this spec — plain JSON. A command/TUI panel can be added later.

## Section 5 — Error Handling & Edge Cases

- **No `hello`** — connection runs as `"default"`; raw/legacy clients keep working.
- **Malformed `user_id`** — server-side `sanitizeUserId()` strips unsafe chars and caps length; `../../etc` → `------etc`; empty → `"default"`. Path traversal structurally impossible.
- **Late `hello`** — only honored when the session has no messages yet; ignored mid-conversation so identities can't be swapped partway through.
- **Cross-user resume** — returns `null` → existing "Session not found" error; no leak.
- **Corrupt usage file** — `recordUsage` treats it as "no file yet" and starts fresh rather than throwing.

## Testing

Unit (Vitest), matching existing layout:
- `user-paths.test.ts` — `sanitizeUserId` (normal, uppercase, traversal, empty, over-length); `userPaths` (correct paths).
- `store.test.ts` — save/load within a user dir; wrong-user `loadSession` → `null`; `listSessions` returns only that user's sessions.
- `fs-memory.test.ts` — `user`-scope write lands in private dir not shared; `profile`-scope write lands in shared; `buildSystemPromptSection` merges + labels both, omits empty tier; `MemoryWrite` defaults to `user` when scope omitted.
- `ledger.test.ts` — fresh-file creation, accumulation into `total` + correct month bucket, recovery from corrupt file.

Integration: lightweight server test — open connection, send `hello` with a user id, send a message, confirm the session is created under that user and isolated from a second user's connection.

## File Summary

| File | Change |
|------|--------|
| `src/types.ts` | Add `hello` to `ClientMessage` |
| `src/session/user-paths.ts` | NEW — `sanitizeUserId`, `userPaths` |
| `src/session/types.ts` | Add `user` to `Session` |
| `src/session/store.ts` | User-scoped `saveSession`/`loadSession`/`listSessions`; `createSession(profile, user)` |
| `src/memory/interface.ts` | Scope enum gains `'user'` |
| `src/memory/fs-memory.ts` | Private-tier branches; merged `buildSystemPromptSection` |
| `src/usage/ledger.ts` | NEW — `recordUsage` |
| `src/improver/default-improver.ts` | Reflection → `user`, skills → `profile` |
| `src/server/index.ts` | `hello` handling; user-scoped session/memory/resume; `recordUsage` at close |
| `src/cli/*`, `src/tui/*` | Derive + send `hello` on connect |
| `tests/...` | Unit + integration tests above |
