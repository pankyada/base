# Core S5–S7 lifecycle and orchestration contracts

Date: 2026-09-11 (Australia/Sydney)

Scope: local Core acceptance seams for the 2026-09-07 Core specification and
plan. Fixtures use temporary HOME directories, local fake HTTP model servers,
and a fake voice provider. No credentials, paid inference, device, deployment,
Windows, or live provider gate is represented here. This report is additive to
the dated S4–S7 audit and does not update the product tracker.

## Local evidence added

| Area | Evidence | Result |
|---|---|---|
| Mounted S5 lifecycle | `tests/core-acceptance-lifecycle-mounted.test.ts` starts a temporary server with two profiles, separate fake stdio MCP children, fake model HTTP, profile-selected REST runs, scoped REST cancellation, persisted stalled-run startup recovery, active fake STT/TTS barge-in, and same-user observer/project/board checks. | 10/10 pass. Concurrent profile MCP children start and close per call; run cancellation/abort/no late completion, startup recovery, active voice interruption, board dispatch, observer refusal, and cross-scope project refusal pass. |
| Prompt and execution S6 | `tests/core-acceptance-lifecycle-s6.test.ts` exercises real `buildSystemPrompt` ordering and project-files kill switch, provider-stream cancellation after a yielded partial, and explicit usage/replay terminal metadata. | 4/4 pass. |
| Board/project S7 | `tests/core-acceptance-lifecycle-s7.test.ts` routes operator posts through `Bulletin`, checks taint/provenance, bounds and current-session recipient ownership, validates malformed input, and rejects cross-user project assignment. | 2/2 tests pass. |
| Cancellation boundaries | `tests/core-cancellation.test.ts` exercises Bash subprocess abort, hook abort before later hooks, and MCP `ToolContext.signal` forwarding. | 3/3 tests pass. |

Focused command:

```text
pnpm exec vitest run tests/core-acceptance-lifecycle-s6.test.ts tests/core-acceptance-lifecycle-s7.test.ts --no-file-parallelism
Test Files 2 passed; Tests 6 passed.
```

Mounted command after the board integration:

```text
pnpm exec vitest run tests/core-acceptance-lifecycle-mounted.test.ts tests/core-acceptance-lifecycle-s6.test.ts tests/core-acceptance-lifecycle-s7.test.ts --no-file-parallelism
Test Files 3 passed; Tests 16 passed.
```

```text
pnpm exec vitest run tests/core-acceptance-lifecycle-mounted.test.ts tests/core-acceptance-lifecycle-s6.test.ts tests/core-acceptance-lifecycle-s7.test.ts tests/core-cancellation.test.ts --no-file-parallelism
Test Files 4 passed; Tests 21 passed.
```

Two narrow production fixes accompany the fixtures:

* `src/server/run-profile.ts` now rejects an aborted one-shot run after the
  loop returns. This prevents REST from marking a cancelled partial response
  completed and returning HTTP 200.
* `src/server/project-handlers.ts` checks the caller-owned project before
  assignment. A caller can no longer attach its session to another user's
  project ID.
* `src/server/rest.ts` applies the same caller-owned project check to
  `PATCH /sessions/:id`, carries `run_id` on stream token/tool/stats and error
  events, and records `run_id` in REST replay terminal payloads.

`src/server/board-handler.ts` is the shared board helper used by the server
  integration. It validates runtime subject/body/recipient types, fails closed
  when targeted recipient ownership is unavailable, accepts only IDs in the
  current live-session set, and passes a caller-supplied run/turn key to the
  existing `Bulletin.post` five-post bound. It keeps root/operator identity and
  existing taint propagation.

## Integration handoff

`src/types.ts:299` declares `ClientMessage.board_post`. The mounted test first
reproduced the missing response; the narrow integration now imports
`src/server/board-handler.ts`, adds `board_post` to the mutating-message set,
and dispatches it through the live session. Observer refusal is covered. The
handler projects protocol-v4 `agent_message` with `body_preview` and catches
malformed or out-of-scope input as a wire error.

The integration supplies the current session's live frame IDs (root plus active
`agentControllers` keys), a stable turn key based on the active run or current
session turn, and `session.taint_sources`. No new scheduler or board policy was
added.

## Boundaries audited, still open

* `src/server/index.ts` shutdown now has a mounted repeated start → run →
  cancel → SIGTERM → exit → restart fixture. The fixture proves the owned
  process registry record is removed and the cancelled run remains persisted
  after restart. It does not prove physical device cleanup. Windows and
  physical voice remain external gates.
* `src/server/rest.ts` stream token, tool, stats, result, and ACP message
  payloads now carry `run_id`. The mounted SSE fixture joins token/result,
  REST run state, and the persisted replay terminal event by that ID.
* `src/server/rest.ts:createReplayCapture` initially uses the run ID as journal
  `session_id` and later replaces it with the real session ID. `src/replay/index.ts`
  has no first-class run ID field; the documented terminal event `run_id` is the
  current join key, covered by the mounted correlation fixture.
* `src/server/index.ts` keeps `agentControllers` per WebSocket connection and
  uses them for `agent_cancel`. Existing attach/control paths fail closed for
  cross-user sessions; cross-session execution cancellation/handoff is outside
  the current contract.
* `src/agents/bulletin.ts` stores posts in a per-server `Bulletin` instance;
  there is no persisted/shared board across server processes. The helper and
  tests preserve this existing scope rather than adding persistence.
* Existing prompt tests cover isolated diagnostics and prompt sites. The new
  S6 fixture covers `buildSystemPrompt` precedence, but does not claim model
  quality or content export. `tests/core-cancellation.test.ts` now covers the
  local signal seams: `src/hooks/runner.ts` passes abort to `execAsync`,
  `src/mcp/client.ts` passes `ToolContext.signal` to `callTool`, and
  `src/tools/builtin/bash.ts` kills its child and resolves once on abort. The
  mounted MCP fixture separately proves concurrent profile child ownership and
  close markers. External MCP/device behavior remains outside this report.
  * `project_assign` now fails closed for foreign project IDs in WS and REST, while
  `assignSession` retains its existing silent behavior for an unknown session.
  No broader session-store policy was invented.

## Reused evidence

Relevant existing paths remain useful and were not duplicated:
`tests/core-uplift-platform.test.ts` (isolated MCP close and voice turn),
`tests/server-profile-startup.test.ts` (profile startup),
`tests/core-uplift-history.test.ts` and `tests/r2-persistence-acceptance.test.ts`
(run/history persistence), `tests/core-uplift-diagnostics.test.ts` and
`tests/system-prompt-sites.test.ts` (diagnostics/prompt sites), provider and
agent-loop cancellation tests, `tests/core-uplift-decisions-ws.test.ts`, and
`tests/core-uplift-ws-scope.test.ts` (mounted WS decision/scope behavior).

These tests establish bounded seams. They do not substitute for external
Windows/device/live-provider gates above.

## Validation

`pnpm typecheck`, `pnpm build`, and `git diff --check` pass in the current
working tree. No commit was created. Full-suite acceptance and external gates
remain outside this bounded local report.
