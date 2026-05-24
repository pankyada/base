# Group A Improvements — Design Spec

**Date:** 2026-05-24
**Status:** Approved

## Overview

Four fixes to dead code and missing functionality: wire up the self-improvement system, fix its skill output format, fire `on_stop` hooks per-session, and add a `MemoryDelete` tool.

---

## 1. Wire DefaultImprover into Server

`DefaultImprover` exists but is never instantiated or called. Fix:

- Instantiate `DefaultImprover` once in `server/index.ts` `main()` alongside the OpenAI client.
- On WS `close`, after `saveSession(session)`:
  - Call `improver.reflect(session, memory)` **only if** `session.messages.filter(m => m.role === 'user').length >= 2` (skip trivial/empty sessions).
  - Increment session counter in `<artifact_dir>/session-count.json` (create with `{ count: 0 }` if missing).
  - If counter reaches `profile.improvement.mine_skills_every_n_sessions`, call `improver.mineSkills([session])` and reset counter to 0.
- Both calls are fire-and-forget (`void` — errors logged, never thrown to WS handler).

**Counter file shape:** `{ "count": N }` — read/write with JSON parse/stringify.

---

## 2. Fix mineSkills Skill Output Format

`mineSkills()` currently writes proposed skills as flat `.md` files. Must write directory-based format to match the new skill convention.

**Current (broken):**
```
<artifact_dir>/skills/_proposed/<name>.md
```

**Fixed:**
```
<artifact_dir>/skills/_proposed/<name>/SKILL.md
```

Change in `src/improver/default-improver.ts`: replace `writeFileSync(join(proposedDir, `${skill.name}.md`), ...)` with `mkdirSync(join(proposedDir, skill.name), { recursive: true })` then `writeFileSync(join(proposedDir, skill.name, 'SKILL.md'), ...)`.

---

## 3. Fire on_stop Hooks Per-Session

`on_stop` hooks are defined in the profile schema but never called.

- Call `runHooks('on_stop', profile, { SESSION_ID: session.id, PROFILE: profile.name })` in the WS `close` handler in `server/index.ts`, after `saveSession(session)` and before `reflect()`.
- `SESSION_ID` and `PROFILE` added as env vars (in addition to the existing `TOOL_NAME`/`TOOL_OK` pattern).

---

## 4. MemoryDelete Tool

Add a `delete(scope, key)` method to the memory interface and implement it, then expose as a built-in tool.

### Interface change (`src/memory/interface.ts`)

```typescript
delete(scope: 'session' | 'profile', key: string): Promise<void>
```

### FsMemoryProvider (`src/memory/fs-memory.ts`)

- `session` scope: `delete this.session.session_memory[key]`
- `profile` scope: if `<memDir>/<key>.md` exists, `unlinkSync` it, then `rebuildIndex()`

### Tool (`src/tools/builtin/memory-delete.ts`)

- Name: `MemoryDelete`
- Parameters: `scope` (enum: `session` | `profile`, required), `key` (string, required)
- Returns success or "key not found" message
- Registered in `src/tools/builtin/index.ts`
- ACL default: `allow` in `src/profiles/schema.ts` `BuiltinToolsSchema`

---

## Files Changed

| File | Change |
|------|--------|
| `src/server/index.ts` | Instantiate `DefaultImprover`; call `on_stop`, `reflect`, counter logic on WS close |
| `src/improver/default-improver.ts` | Fix `mineSkills` to write `<name>/SKILL.md` |
| `src/memory/interface.ts` | Add `delete()` method |
| `src/memory/fs-memory.ts` | Implement `delete()` |
| `src/tools/builtin/memory-delete.ts` | New `MemoryDelete` tool |
| `src/tools/builtin/index.ts` | Register `MemoryDelete` |
| `src/profiles/schema.ts` | Add `MemoryDelete: allow` default in `BuiltinToolsSchema` |

## Error Handling

- `reflect()` and `mineSkills()` errors: caught inside each method (`try/catch` already present), fire-and-forget from server.
- Counter file read failure: treat as `{ count: 0 }` and continue.
- `MemoryDelete` on missing key: return informative string, do not throw.
- `on_stop` hook failures: already handled by `runHooks` (logs, continues).
