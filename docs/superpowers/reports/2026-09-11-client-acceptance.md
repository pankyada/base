# Client acceptance report

Date: 2026-09-11 (Australia/Sydney). Task: PT-041. Source baseline: `f56981e` plus this working-tree client patch and acceptance fixture. No Core source, protocol, schema or prompt changes. No commit, push, release or deployment.

## Fixture and commands

Task-owned fixture used `/tmp/harness-ca-home.MmTAtG`, users `ca-user-a`, `ca-user-b`, `ca-tui-a`, `ca-tui-a2`, profiles `fixture` and `other`, fake provider `scripts/client-acceptance-provider.mjs` on `127.0.0.1:18731`, harness on `127.0.0.1:18732`, and production Web on `127.0.0.1:3011`. Synthetic markers only. The harness used real WebSocket and REST handlers; the provider returned deterministic streamed completions and zero paid inference.

Baseline:

- `pnpm test -- --maxWorkers=1`: 170 files passed, 1 skipped; 966 tests passed, 3 skipped.
- `pnpm typecheck`: pass.
- `pnpm --filter harness-web test`: 28 files, 119 tests passed.
- `pnpm --filter harness-web typecheck`: pass.
- `GOCACHE=/tmp/base-go-cache go test ./...` from `tui/`: all 7 packages passed.

Browser CLI prerequisite was present (`npx_status=0`, Node `v25.4.0`), but the prescribed wrapper failed twice with the full error `sh: playwright-cli: command not found`. Native Chrome browser automation then executed the real production Web flow against the fixture.

## Matrix

| ID | Status | Evidence and remaining gap |
|---|---|---|
| CA-01 | PASS | Real Chrome `/`: stopped harness; submit retained `CA01 unsent synthetic`, showed `Disconnected (closed)` and `not connected — message not sent`, stayed ready; restarted harness; one retry produced one visible user entry and one `fixture scope complete` assistant entry. REST/session and provider usage showed one completed run. |
| CA-02 | BLOCKED | Source audit covered `HarnessApp` message/cancel/compact/approval/input sends and `/ops` approval/inbox/undo/skills/cancel call sites. Composer and TUI closed-write paths have automated coverage; real TUI closed submit showed `message not sent not connected`. No isolated browser write-failure injection for every control action, and no durable control-action report, so full matrix row remains open under PT-002/PT-003/PT-007/PT-008. |
| CA-03 | NOT_RUN (partial evidence) | Real Chrome populated A transcript (`A private marker`), usage and session files; `curl .../sessions/0f73d05b/messages?user=ca-user-a&profile=fixture` returned A-only transcript, B usage remained zero and B transcript was empty. A→B identity switch changed session and dropped prior visible transcript; fixture→other profile switch changed profile/session and cleared transcript. |
| CA-04 | BLOCKED | The stale-response rule exists and unit coverage passes, but no browser-controlled delayed REST response was injected in this run. Keep PT-004 open. |
| CA-05 | BLOCKED | Real Chrome route mount/unmount (`/`, `/ops`, `/home`) and identity/profile changes executed; lifecycle unit suite passed. Browser tooling exposed no durable per-socket counter, so exactly-one/zero-after-teardown and orphan-retry counts were not proven. Keep PT-005 open. |
| CA-06 | BLOCKED | Harness restart with persisted task home was exercised. TUI reconnect visibly reported `session not restored Session f01964e0 not found` and continued in a new session, satisfying truthful failure reporting. Browser persisted-session resume and Q-under-P authoritative `session_resumed` adoption were not completed. Keep PT-004/PT-005 open. |
| CA-07 | PASS | Actual built TUI binary `/tmp/harness-tui-client-acceptance` in PTY: with harness down, typed `offline PTY retained`, submit showed `message not sent not connected` and retained composer; harness restart reconnected, visibly reported missing old session, and the retained text then completed with `fixture scope complete`. |
| CA-08 | BLOCKED | PTY reconnect and missing-session notice were captured; cross-profile resume plus all shared navigation/cancel/queued-while-busy recovery cases were not completed. Keep PT-003 open. |
| CA-09 | NOT_RUN (partial evidence) | Real Chrome `/ops` all-down showed multiple `Unavailable: Failed to fetch` alerts with Retry, while healthy empty showed explicit empty panels. `/home` all-down showed one aggregate unavailable alert naming all seven failed reads; restart restored populated empty/usage panels without reload after socket reconnect. |
| CA-10 | BLOCKED | Transcript shared read was inspected and direct scoped transcript REST succeeded for A. Analyst remote-read fault/retry inventory and representative browser fault/recovery were not completed. Keep PT-004/PT-006 open. |

## Fix

Real browser reproduced a scope leak: changing `web-user` to `ca-user-a` kept the old transcript visible while the new session opened. Added `RESET_SCOPE` reducer action and mounted scope-key effect in `HarnessApp`; it clears session/profile-dependent transcript, pending, usage, runs, projects, surfaces and notices while retaining authoritative session/profile metadata. Added reducer regression coverage. Rebuilt production Web and rechecked A→B and profile switching in Chrome: old marker disappeared before new scoped data.

## Final checks and cleanup

Focused Web regression after the fix: `pnpm --filter harness-web test -- --run tests/reducer.test.ts tests/sendDelivery.test.ts` — 2 files, 15 tests passed. Frozen Web suite: 28 files, 120 tests passed; Web typecheck and production build passed (existing Next warnings: Pyodide dynamic dependency and CSS autoprefixer). Root typecheck/build, protocol freshness, boundary guard and `git diff --check` passed. TUI build, all 7 Go package tests and vet passed.

Full frozen validation is recorded separately by the parent for the untouched Core baseline. This task's remaining acceptance is explicit above; PT-002–PT-006 stay open, and PT-007/PT-008 redesign/live-state work remains excluded.

## Dedicated direct Playwright run — 2026-09-11

Added task-owned fixture: `web/playwright.client-acceptance.config.ts`, `web/e2e/client-acceptance.global-setup.ts`, `web/e2e/client-acceptance.spec.ts`. It starts fake provider, real harness and production Web; seeds two users/profiles, private memory, sessions, usage and Bash audit records; tears down child processes.

Command: `cd web && pnpm exec playwright test -c playwright.client-acceptance.config.ts` — **7 passed (15.3s)**; targeted CA-06 rerun **1 passed (1.7s)** against manually started production Web after one isolated webServer timeout.

| ID | Latest bounded evidence | Status | Gap |
|---|---|---|---|
| CA-03 | Two scoped users/profiles returned disjoint memory, Bash audit, nonzero usage and disjoint seeded transcripts. Browser A→B send cleared old A text. | PARTIAL PASS | Mounted A→B→A visible memory/audit/usage route evidence remains. |
| CA-04 | Held A transcript response, switched B, released A response; stale marker never rendered. | PASS bounded | Wider delayed control matrix open. |
| CA-05 | Real socket probe across forced close, identity switch, route mount and about:blank: settled live ≤1 and teardown 0; lifecycle unit 8/8. | PASS bounded | Larger manual reconnect/repeated-cycle matrix open. |
| CA-09 | /ops usage aborted twice: usage-specific Unavailable while Audit/Runs stayed mounted; Retry cleared failure. | PASS partial | Explicit loading/populated/empty captures remain. |
| CA-10 | `/home` memory fault showed scoped memory failure; Retry restored `CA_MEMORY_A`. Analyst transcript fault showed `Transcript unavailable`; Retry cleared it. | PASS bounded | DatasetDrawer browser fault/retry and scoped upload still separate. |
| CA-02 | Real browser socket close, submit showed exact `not connected — message not sent` and retained composer text. | PASS bounded | Other control actions still need individual fault cases. |
| CA-06 | Real browser sent marker, forced transport close, auto-reconnect resumed same session; marker/session remained. | PASS bounded | Cross-profile and missing-session browser recovery remain. |
| CA-08 | Actual built TUI PTY exercised two real users/profiles (`fixture-p`/`ca-tui-a`, `fixture-q`/`ca-tui-b`), message submission, Tab panel navigation, Ctrl-B rail, queued message and Esc cancel. Both exited 0; profile/message/panel-or-rail markers true; cancelled slow completion absent. | PARTIAL PASS | Complete cancel/queue/navigation matrix and missing-session recovery remain. |

Narrow fixes: RESET_SCOPE now resets session/project and session-owned transcript, runtime, notebook, usage, approval, model, budget, memory-view and notice state; createConnect closes prior live socket before replacing its ref. Scope reset now triggers on user change or explicit profile selection, avoiding the initial `session_ready` race that erased the new authoritative session ID. Focused Web result: 3 files, 21 tests passed. Web typecheck and diff check pass; fixture run remains green.

Follow-up fresh-server runs: targeted CA-06 reconnect and DatasetDrawer fault/retry **2 passed (13.5s)** with `reuseExistingServer: false`. DatasetDrawer workspace reached through real `RenderUI` provider tool; `/datasets` fault rendered scoped `datasets:` Unavailable and Retry restored `No datasets.`. Actual TUI PTY ran separate users/profiles `fixture-p`/`fixture-q`; both exit 0 with profile, message and panel-or-rail markers true.

CA-08 selected-resume attempt: actual TUI wrote `CA08 selected resume`, exited 0, extracted persisted session id `3b4b2ecb`, relaunched with `--resume 3b4b2ecb`, and received successful server resume with exit 0, but prior transcript marker was absent. Core `resume` currently sends only `session_resumed` and TUI clears transcript on that frame; no history payload is returned. This is a concrete Core/TUI contract dependency, not a client test omission. Cross-profile PTY run separately passed profile/message/panel-or-rail markers for both profiles.

## Parent acceptance review — 2026-09-11

CA-03 and CA-09 PASS labels corrected: CA-03 did not populate both users/profiles or prove memory/audit content isolation and return switching; CA-09 did not exercise one-endpoint partial failure or the complete loading/empty/populated matrix. CA-01/CA-07 have recorded passing scenario evidence; remaining eight rows need completion. BLOCKED labels above primarily describe missing execution/tooling coverage, not established external blockers. Use installed Playwright test tooling for delay/failure injection and connection instrumentation; wrapper failure alone does not establish a browser blocker. Root 170/966 is recorded baseline evidence in this report, not a newly verified frozen post-patch root run. Parent has not rerun product tests.

## Superseding checkpoint — 2026-09-12

See [current client/operator validation](2026-09-12-client-operator-validation.md) and tracker E-020. TUI missing resume history was a client defect: existing scoped REST provides it, and hydration now fixes it. Earlier Core-blocker claim is retracted. Browser/operator coverage and working-tree tests have expanded; historical bounded PASS labels above do not close broader acceptance requirements. PT-007 has a different, verified Core dependency: ephemeral approval ownership and missing retained prompt payloads (PT-044).
