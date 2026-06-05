# Per-user Projects + Session History — Design

> Date: 2026-06-05
> Status: Approved design, ready for implementation planning
> Scope: Runtime / data layer only. Web + TUI surfaces are a **separate spec** (see Out of Scope).

## Problem

Sessions are stored flat per user (`~/.harness/sessions/<user>/<date>_<id>.json`) with no
grouping. As usage grows, users need to organize work into projects/folders and browse
history — both **finding** past sessions and **resuming** them. Memory today has only two
useful scopes (`session`, ephemeral; `profile`, shared across all users on the instance) plus
private `user` scope. There is no middle scope shared within a group of related sessions.

## Key architectural facts (verified against code)

- The server boots with exactly **one profile** (argv at startup, `src/server/index.ts:46-51`).
  Every WebSocket connection uses that profile. `hello` carries only `user_id`,
  `wasm_supported`, `yolo` — there is **no per-connection profile switching**. Profile/mode is
  fundamental to the instance, not switchable per-session.
- Because there is one profile per instance, a **project cannot span profiles** — it is
  inherited from the instance. Projects are therefore a pure **per-user** grouping.
- Resume already works via the `resume` WS message (`src/server/index.ts:204`).
- Post-session reflection already runs and already calls the LLM
  (`DefaultImprover.reflect()`, invoked at `src/server/index.ts:297`).

## Hierarchy

```
Instance (profile/mode — fixed at boot)
  └─ User
       └─ Project (Inbox = default)
            └─ Sessions  (history: find + resume)
```

Every session belongs to **exactly one** project. Uncategorized sessions go to an
auto-created **Inbox** project. No nullable `project` state anywhere.

## Data model

New `Project` type (`src/projects/types.ts`):

```ts
interface Project {
  id: string          // 8-char id, same scheme as sessions
  user: string        // sanitized owner id
  name: string        // "Inbox", "Q3 Launch", ...
  created_at: string  // ISO
  description?: string
}
```

`Session` (`src/session/types.ts`) gains:

```ts
project: string       // projectId — ALWAYS set; defaults to "inbox"
title?: string        // auto-derived from first user message
summary?: string      // LLM-generated at session end
```

`SessionSummary` — lightweight projection for history listing (never ships full message
arrays over the wire):

```ts
interface SessionSummary {
  id: string
  project: string
  title?: string
  summary?: string
  created_at: string
  usage: { input: number; output: number; cost_usd: number }
}
```

## Storage layout

```
~/.harness/
  projects/<user>/
    <projectId>.json              # Project record
    <projectId>/memory/*.md       # project-scope memory
  sessions/<user>/
    <date>_<id>.json              # UNCHANGED location; session.project points up
```

- `src/session/user-paths.ts` gains `projectPaths(user, projectId)` →
  `{ recordFile, memoryDir }`, mirroring the existing `userPaths` composition.
- Inbox is created lazily via `ensureInbox(user)` on first use. Its id is the fixed string
  `"inbox"` so it is stable and predictable.
- Existing sessions migrate transparently: any session without `project` is stamped
  `project: "inbox"` on next save.
- Sessions are **not** moved on disk when assigned to a project — grouping is by reference,
  so reassignment is a cheap metadata update.

## Memory scope

New `project` scope slots into the resolution ladder used when building the system prompt:

```
session > project > user > profile
```

- `FsMemoryProvider` and `GraphMemoryProvider` gain a `project` scope, reading/writing
  `~/.harness/projects/<user>/<projectId>/memory/`.
- The provider learns the active project from the `session` it is already constructed with
  (`session.project`).
- `MemoryWrite` tool gains a `scope: "project"` option. Default stays `user` (private).
- Nuance: project memory for sessions still in Inbox is effectively "user-scoped lite" —
  harmless, just rarely used.

## Protocol & API

New WS `ClientMessage` types (`src/types.ts` + `web/lib/types.ts`):

```ts
{ type: 'project_create', name: string, description?: string }
{ type: 'project_list' }
{ type: 'project_assign', sessionId: string, projectId: string }
{ type: 'session_list', projectId?: string }   // optional project filter
```

New `ServerMessage` types:

```ts
{ type: 'project_created', project: Project }
{ type: 'projects', projects: Project[] }
{ type: 'sessions', sessions: SessionSummary[] }
```

REST mirror (extends the `#4` programmatic surface):

- `GET /projects`
- `POST /projects`
- `GET /projects/:id/sessions`
- `PATCH /sessions/:id` (reassign project)

## Title & summary generation

- **title** — set on the first user message of a session. Implementation: **truncate/clean
  the first user message** (no extra cost, instant). Upgrade to a tiny LLM call later if
  titles feel weak.
- **summary** — generated at session end by extending `DefaultImprover.reflect()` (already
  runs post-session and already calls the LLM) to emit a one-line summary written back to the
  session file. No new LLM round-trip.

## New store functions

```ts
// src/projects/store.ts (new — mirrors src/session/store.ts)
createProject(user, name, description?) → Project
listProjects(user) → Project[]
getProject(user, id) → Project | null
ensureInbox(user) → Project          // lazy default, id = "inbox"

// src/session/store.ts (extend)
listSessionSummaries(user, projectId?) → SessionSummary[]
assignSession(user, sessionId, projectId) → void
```

## Testing

Mirror existing `tests/session-store.test.ts` / `tests/run-store.test.ts` patterns:

- project CRUD + Inbox lazy-creation (stable `"inbox"` id)
- session → project assignment + reassignment
- `listSessionSummaries` filtering by project
- session migration: legacy session without `project` gets stamped `inbox` on save
- memory resolution order (`session > project > user > profile`)
- protocol round-trips (create / list / assign / session_list)

## Build order (incremental — each step shippable)

1. `Project` type + `src/projects/store.ts` + `ensureInbox` + `session.project` stamping
2. `SessionSummary` + title (truncate) + `listSessionSummaries` history listing
3. WS protocol + REST endpoints
4. `project` memory scope in both providers + `MemoryWrite` `scope: "project"` option
5. summary via `DefaultImprover.reflect()` hook
6. Web/TUI UI — **separate spec**

## Out of scope (separate spec)

The web + TUI surface: project sidebar, history panel, drag-to-assign, project switcher.
Big enough to warrant its own design pass once the runtime/data layer lands.

## Non-goals / YAGNI

- No cross-user / team-shared projects (per-user only by decision).
- No project-spanning profiles (architecturally impossible: one profile per instance).
- No session-index file for fast listing yet — scan + filter is fine at realistic per-user
  session counts; add an index later only if it becomes a bottleneck.
