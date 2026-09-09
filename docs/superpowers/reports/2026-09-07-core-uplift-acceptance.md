# Core uplift acceptance

Date: 2026-09-07 (Australia/Sydney). Track: PT-023–PT-030. This report records
local Core evidence only; client adoption, live provider, device, Windows and
deployment gates remain separate.

## Baseline (S0)

Before Core edits: `pnpm test` passed 157 files / 896 tests; `pnpm typecheck`,
`pnpm build`, and `bash scripts/check-boundary.sh` passed. Worktree contained
pre-existing edits including Codex stream/review tests, tracker/spec/plan docs,
Graphify assets and generated artifacts; those paths remain preserved.

## Requirement matrix

| Requirement | Test / production seam | Result | Remaining gate |
|---|---|---|---|
| Explicit user scope is bounded and malformed values fail before sanitization | `tests/core-uplift-scope.test.ts`; `src/server/scope.ts` | Pass: non-string/oversized scope returns bounded error | Caller-asserted scope is not authentication |
| REST run reads and cancellation cannot cross user scope | `tests/core-uplift-scope.test.ts`; `/runs/:id` handlers | Pass: wrong-scope GET/DELETE return 404 and status remains unchanged | Existing clients must pass explicit scope; aggregate omitted reads retained |
| Pending answer scope is isolated and contradictory query/body scopes reject | `tests/core-uplift-scope.test.ts`; `/runs/:id/input` | Pass: 400 contradiction, 404 wrong scope, pending remains open | WS/client adoption pending PT-004 |
| WS scope entrypoints reject malformed hello/attach/cursor and unsafe cross-session control attach | `src/server/index.ts`; `tests/core-uplift-ws-scope.test.ts` | Pass: subprocess server with temp HOME, two profiles, fake API endpoint, two WS clients | Caller-asserted identity remains local, not authentication |
| Runtime recovery snapshot is detached and future cursors request resync | `tests/core-uplift-runtime-review.test.ts`, `tests/core-uplift-ws-scope.test.ts`; `SessionRuntime.subscribe/state` | Pass: deep mutation isolation, child telemetry isolation, bounded retention, future cursor gap and real WS overflow snapshot | Client reconnect adoption remains PT-004/PT-007 |
| Runtime decisions settle only after valid callback transition and stale IDs fail closed | `src/server/index.ts`; runtime review and WS stale-response checks | Pass: inbound input/result/decision callbacks emit projection after callback and unknown IDs return error | No local gate; caller identity and external delivery remain separate |
| Correlated approval/input ACKs deduplicate mounted decision handlers | `tests/core-uplift-decisions-ws.test.ts`; temporary server + fake OpenAI-compatible SSE provider | Pass: repeated request IDs invoke each approval/input callback once, return correlated ACKs, reject unknown/mismatched IDs, advertise capability, and block observer answers | Caller identity remains asserted local scope; cross-session control handoff unsupported |
| Provider-native effort metadata stays truthful and model/effort selection is atomic | `tests/core-uplift-effort.test.ts`, `tests/core-uplift-decisions-ws.test.ts`, `tests/model-discovery.test.ts`, `tests/provider/codex-request.test.ts`; discovery/WS/provider seams | Pass: Codex fixture parses supported/default levels with opaque scope; unknown IDs retain provider-default operation; bounded aliases validate offline; Codex payload emits selected effort or omits Default; API-key adapter reports unknown and omits unverified effort | No live catalog, entitlement, quality or billing claim; API-key explicit effort remains adapter-unavailable; no UI picker |
| History pagination is bounded, stable and scope-bound | `tests/core-uplift-history.test.ts`, `tests/r2-persistence-acceptance.test.ts`, REST `/runs` | Pass: versioned keyset cursor binds user/profile/status, continues when anchor record disappears, rejects malformed or mismatched cursors, and exposes diagnostic count without local paths | Multi-process transactions and cross-platform process gates remain unclaimed |
| Lifecycle, voice and MCP cleanup preserve cancellation boundaries | `tests/core-uplift-platform.test.ts`, existing `tests/voice-*`, `tests/run-profile.test.ts` | Pass: MCP close is awaited and close failures isolated; barge-in aborts model and cleanup once; existing fake provider/voice lifecycle tests pass | No physical audio, device, Windows or live provider acceptance |
| Prompt/config and execution telemetry audit exposes safe metadata only | `tests/core-uplift-diagnostics.test.ts`, `tests/context-telemetry.test.ts`, `tests/system-prompt-sites.test.ts`, `tests/session-status.test.ts`, `tests/provider/api-adapter.test.ts` | Pass: source ordering/sizes are available through opt-in diagnostics without prompt or memory content; cancellation/status and provider failure contracts remain distinct | No prompt-content export, model-quality or deployment claim |
| Existing orchestration contracts remain compatible | `tests/spawn-contract.test.ts`, `tests/agents-loader.test.ts`, `tests/agents-runner.test.ts`, `tests/agents-fanout.test.ts`, `tests/delegate.test.ts`, `tests/spawn-taint.test.ts`, `tests/agent-loop-model-override.test.ts`, `tests/workflow-core.test.ts`, `tests/workflow-runner-pipeline.test.ts` | Pass: 9 files / 35 tests cover spawn, scoped agent loading, fanout, cancellation/taint, model override and workflow contracts | Persistent teammate identity, worktree policy, scheduler and game UI remain PT-020 proposals |
| Integrated Core compatibility and delivery checks | Root Vitest, TypeScript, protocol generator, Web typecheck, Go tests, boundary guard and diff check | Pass: 165 files / 937 tests; generated protocol fresh; Web and Go consumers compile/pass; boundary and whitespace clean | No commit/push/deploy; live provider/account, physical/device, Windows and client adoption remain open |
| Durable pending writes are atomic and answers validate declared options | `tests/pending.test.ts`; `src/runs/pending.ts` | Pass: atomic writes, select/multi-select validation, legacy comma-separated multi-select compatibility | Multi-process exactly-once transactions remain outside this local claim |
| Resume cannot consume unavailable work or overwrite cancellation | `tests/deferred-asks-restart.test.ts`; `src/runs/resume.ts` | Pass: unavailable targets ignored and success/failure/late-park cancellation races preserve cancelled status | No local gate; external provider/live acceptance remains separate |
| Scoped run/pending listing and empty-scope handling | `tests/core-uplift-scope.test.ts`; `/runs`, `/pending` | Pass: requested user filters results; explicit empty user returns 400 rather than aggregate listing | Caller-asserted identity remains local, not authentication |

Focused S1 checks initially covered 5 files / 73 tests; current S2/S3 targeted
checks cover 6 files / 34 tests, S4 targeted checks cover 7 files / 46 tests,
and the broader focused set covers 9 files / 99 tests. Root full suite passes
165 files / 937 tests with one worker. No handwritten
Web/TUI/Studio client files were edited; generated protocol artifacts changed
through the repository generator.
PT-024/PT-030 local criteria are complete; client adoption, authentication,
live provider/platform and deployment gates remain separate.

S4 metadata shape reference: [Codex model metadata source](https://raw.githubusercontent.com/openai/codex/main/codex-rs/protocol/src/openai_models.rs), read 2026-09-07. This mutable source documents field shape only; it is not entitlement or live inference evidence.

## S1 handback

PT-023 is locally complete: REST/read-api and real subprocess WebSocket
two-user/profile fixture pass. PT-024/PT-030 local criteria also pass through
mounted overflow, restart, approval/input, race, discovery, selection,
history, lifecycle, diagnostics and orchestration fixtures. Integrated Web
typecheck and Go suite also pass. PT-004, PT-014, PT-016 and all
client/live/platform tasks remain open; no deployment or commit performed.
