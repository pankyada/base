# Plan: client acceptance

Date: 2026-09-11. Complexity: medium-high.
[Specification](../specs/2026-09-11-client-acceptance-spec.md).
Tracking: PT-040 planning/handoff; PT-041 execution; PT-002–PT-006 acceptance.
Assigned executor: `gpt-5.6-luna`, reasoning `high`.

## Approach

Run S0 → S1 → S2 → S3 → S4 in order. Reuse C1–C4 implementation; do not replay
the original uplift from scratch. No new dependency/API integration is planned;
inspect installed package scripts and existing fixtures for exact execution.
Read repository instructions, tracker, feature taxonomy, roadmap, ADR-79–82 and
both client specifications before editing. Read subsystem contracts before fixes.

## S0 — Inventory and baseline

**0.1 State and scope.** Record HEAD/status, preserve PT-039 tracker changes and
PT-040 planning docs. Inventory WS sends and REST reads, their ownership/scope,
existing error handling, and current test coverage. Relevant files:
`web/hooks/useHarnessWS.ts`, `web/lib/wsLifecycle.ts`,
`web/hooks/useHarnessQuery.ts`, `web/lib/scopedRequest.ts`,
`web/lib/remoteData.ts`, `web/components/HarnessApp.tsx`,
`web/components/chrome/SocketProvider.tsx`, `web/app/ops/page.tsx`,
`web/app/home/page.tsx`, `tui/internal/ws/client.go`, `tui/internal/ui/model.go`.

**0.2 Baseline.** Run root tests/typecheck, Web tests/typecheck and Go tests.
Record failures as pre-existing or new; repair baseline only within authorized
client scope. Unrelated failures stay visible and prevent unqualified green claims.

Demo/output: initial acceptance report at
`docs/superpowers/reports/2026-09-11-client-acceptance.md`, with matrix and seam
inventory. No acceptance task closes from baseline alone.

## S1 — Isolated runnable fixture

Depends on S0.

**1.1 Backend/provider/data fixture.** Reuse patterns from
`tests/core-final-build-validation.test.ts` and
`tests/core-uplift-ws-scope.test.ts`. Create task-local provider and real server
with two users/profiles and persistent synthetic records. Add deterministic
slow turn/tool behavior for send/cancel tests. Prove startup/cleanup, scoped
population and controlled restart. No production Core edits.

**1.2 Browser entry point.** Add dedicated acceptance config and helper under
`web/` alongside existing `web/playwright.config.ts` / `web/e2e/`; choose paths
after inventory. Keep existing artifact E2E unchanged. Prevent parallel cases
sharing restart state; use serial lifecycle cases or isolated fixture instances.
Build/start actual Web client with fixture endpoints; record reproducible command.

**1.3 PTY entry point.** Build TUI to task-local output, inspect actual flags,
connect it to fixture in a PTY and capture readable output. Add repeatable Go
integration test bridging actual websocket client with model where practical.

Demo: browser and PTY connect to synthetic profiles; cleanup leaves no owned
listeners/processes. Fixture readiness uses health checks and deadlines, not
unbounded sleeps. Commit unit: isolated acceptance infrastructure, no commit yet.

## S2 — Web acceptance and narrow corrections

Depends on S1.

**2.1 Delivery/control.** Execute CA-01/02. Capture failed input preservation and
successful subsequent round trip. Audit failure handling beyond composer sends.

**2.2 Scope/recovery.** Execute CA-03–06 with real populated data, delayed old
response, connection counts and cross-profile resume. Verify mounted client
behavior, not only extracted bookkeeping functions.

**2.3 Read states.** Execute CA-09/10 across `/ops`, `/home`, history and analyst
read integrations. Check healthy empty separately from error and partial failure.

**2.4 Fix loop.** For each reproduced in-scope failure: add failing regression,
make smallest client fix, rerun failed gate and affected suite, record before/after.
Do not absorb PT-007/PT-008 redesign; map overlap as explicit blocking dependency.

Demo: browser matrix with actual assertions and durable evidence. Commit units:
one logical regression/fix per issue, individually reviewable and uncommitted.

## S3 — TUI integrated acceptance

Depends on S2 fixture stabilization; independent of Web fixes that do not alter
the shared fixture. Execute sequentially in this single-agent handoff.

**3.1** Execute CA-07/08 in real PTY. Include successful reconnect, missing
session, cross-profile resume, busy queue and relevant navigation/control sends.

**3.2** Add failing integrated transport/model regression for observed bugs,
apply minimal fix, rerun PTY scenario and affected Go tests. Existing
`tui/internal/ws/reconnect_test.go` and `tui/internal/ui/reconnect_test.go` are
starting points, not substitutes for actual app execution.

Demo: recorded input/notice/session/profile before and after disconnect, with
server-side synthetic frame evidence. Any PTY limitation remains explicit.

## S4 — Frozen validation and handback

Depends on S2/S3. Freeze edits before final checks:

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm --filter harness-web test
pnpm --filter harness-web typecheck
pnpm --filter harness-web build
node scripts/gen-web-protocol.mjs --check
bash scripts/check-boundary.sh
git diff --check
```

From `tui/`:

```sh
GOCACHE=/tmp/base-go-cache go test ./...
go build ./...
go vet ./...
```

Run new dedicated acceptance browser command after production build and repeat
final PTY smoke against matching fixture tree. If build is already performed by
the dedicated command, record that command as satisfying the build gate rather
than duplicate it. Check Studio typecheck only if shared client/generated files
affect it. Full root suite required before any later commit.

Update matrix/report, exact counts/skips, component/feature rows, evidence and
dated completion log. Keep PT-007–PT-020 untouched except precise dependency
notes/new defect tasks. Update roadmap only if numbered feature status changes;
do not mark broad roadmap areas complete from this bounded acceptance.

Return to parent: files changed; matrix per row; exact commands/results; fixes
and failing-before evidence; unresolved gaps/tasks; cleanup outcome; git diff
summary; no release/deployment claim. Parent reviews before final user closeout.

## Risks and rollback

- Browser send success means enqueue/write, not application-level ACK. Do not
  promise exactly-once delivery or introduce a new message ACK protocol.
- Shared shell and chat may legitimately own separate connections; count each
  owner and total expected topology, rather than asserting one socket globally.
- Caller identity is not authentication; fixture isolation does not establish RBAC.
- Fixed ports, ambient credentials and stale Next builds can invalidate evidence;
  use isolated processes, local fake credentials and matching build endpoints.
- Web event-tail scope loss may link acceptance to PT-007; preserve failed gate.
- Stop only task-owned processes. Remove only recorded temp fixture paths.
  Revert own logical patch if needed; never reset unrelated worktree edits.
