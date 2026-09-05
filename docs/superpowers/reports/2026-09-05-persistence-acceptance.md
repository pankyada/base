# R2 persistence acceptance

## Scope

Bounded R2 acceptance coverage for shared atomic JSON, session persistence, and run persistence. Work limited to the owned acceptance test, this report, and narrow fixes in `src/session/store.ts` and `src/runs/store.ts`. Shared protocol, user-path, server, CLI, and unrelated dirty work were left unchanged.

## Requirement coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| Interrupted atomic write preserves prior record | PASS | `tests/r2-persistence-acceptance.test.ts`: injected pre-rename failure leaves old JSON and cleans temp file |
| Exact ID matching for prefix-colliding session/run IDs | PASS | Loads `abc12345` and `abc123456`; gets `run-a` and `run-ab` independently |
| Corrupt record isolation | PASS | Healthy session/run listing continues; session history returns path diagnostic |
| Missing/corrupt history index recovery | PASS | Per-user `index.json` rebuilt atomically from valid records; session page reports rebuild diagnostic; run store exposes `getDiagnostics()` |
| Per-user isolation | PASS | Session history and run listing scoped by sanitized user directory |
| Stale revision protection | PASS | `saveSession(session, expectedRevision?)` rejects stale session revisions; `RunStore.update(..., expectedRevision)` rejects stale run revisions with `RevisionConflictError` |
| Stable newest-first pagination | PASS | Session history sorts timestamp then ID, returns opaque ID cursor, and resumes without duplicates |

## Implementation

Session and run stores now maintain a small versioned per-user history index using the shared atomic writer. Missing or malformed indexes are rebuilt from readable records. Index files are excluded from record scans. Session saves compare an existing record revision before incrementing; callers can also pass an explicit expected revision. Run-store diagnostics expose index recovery details without changing the existing `list()` return shape.

## Verification

Commands run from repository root:

```text
pnpm vitest run tests/r2-persistence-acceptance.test.ts
  PASS (1 file, 6 tests)
pnpm vitest run tests/session-store.test.ts tests/run-store.test.ts tests/r2-persistence-acceptance.test.ts
  PASS (3 files, 17 tests)
pnpm typecheck
  PASS
```

## Integration instructions

Use `listSessionHistory(user, { projectId?, limit?, cursor? })` for session history. Treat `diagnostics` as user-visible recovery/corruption evidence. Use `saveSession(session, expectedRevision)` when a caller has a known revision; the existing one-argument path still increments a loaded session revision safely. Use `RunStore.update(id, patch, expectedRevision)` for conditional run updates and `getDiagnostics()` after `list()` when index recovery details matter.

## Remaining gaps

Run listing retains its existing array API and does not add a `nextCursor` page object; stable cursor pagination is implemented and accepted for the session history API. Run-store `get(id)` remains global because its pre-existing API has no user parameter; user-scoped history uses `list({ user })`. Full repository acceptance remains lead-owned.
