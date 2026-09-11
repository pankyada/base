# Core uplift S4–S7 acceptance audit

Date: 2026-09-11 (Australia/Sydney). Track: PT-037. Scope: trace the
2026-09-07 Core specification and plan against production seams and current
tests. This report does not change the product tracker and does not treat test
counts as feature acceptance.

## Final reconciliation

The audit findings below were recorded while implementation was still changing.
Subsequent corrective work closes the listed local gaps:

| Finding | Corrective evidence |
|---|---|
| Discovered effort rejected; selection races | Four mounted Codex WS cases in `tests/core-uplift-codex-ws.test.ts`, plus adapter/profile/serializer fixtures |
| Repeated process restart and owned MCP isolation absent | `tests/core-acceptance-lifecycle-mounted.test.ts` now exercises concurrent profile MCP lifetimes, actual SIGTERM/restart and registry removal |
| REST project assignment and SSE failure correlation absent | Mounted REST rejection/no-mutation and SSE success/failure → run → replay terminal checks |
| Board dispatch and rate history | Mounted operator dispatch/observer rejection; bounded recipient checks; bounded ephemeral turn-key history regression |
| Execution cancellation gaps | `tests/core-cancellation.test.ts`, `tests/hooks.test.ts`, `tests/poll-trigger.test.ts`; existing signal propagated through loop/artifacts/MCP, POSIX process-group termination and stopped probe suppression |
| Prompt/telemetry audit | Real assembly precedence/kill-switch fixtures plus mounted terminal correlation; no model-quality claim |

See [lifecycle report](2026-09-11-core-lifecycle-contracts.md),
[cancellation report](2026-09-11-core-cancellation-fix.md), and
[final validation](2026-09-11-core-final-validation.md) for final results.
Historical “missing” statements below describe findings at discovery, not an
additional unresolved backlog. External gates remain in the dedicated
[external acceptance list](2026-09-11-core-external-gates.md).

## Status at initial audit

The earlier Core acceptance report is accurate for many bounded fixtures, but
it overstates S4–S7 completeness. S4 had a reproducible production defect:
Codex discovery accepted live effort metadata for an unknown model, while the
Codex serializer consulted only the static capability table and rejected that
same effort. The working-tree patch now carries the validated capability into
the Codex adapter, binds it to the provider model, and rejects stale or
cross-account live metadata before a request. Mounted adapter and WebSocket
fixtures prove the future-model discovery through selection and payload path.

Current focused S4 run after the patch: 7 files / 39 tests passed, including
four mounted WebSocket cases. Root run before the final mounted WS additions:
165 files passed, 1 skipped; 940 tests passed, 3 skipped. A final root run
remains for the parent validation pass.
`pnpm typecheck`, `pnpm build`, and `git diff --check` passed. These results
describe the working tree at audit time.

## S4 — provider/model/effort

| Spec requirement | Production evidence | Test evidence | Audit result |
|---|---|---|---|
| Provider-native bounded metadata, opaque account/endpoint scope, unknown versus supported | `src/models/discovery.ts:209-239,242-301`; `src/types.ts:40-62` | `tests/core-uplift-effort.test.ts:22-46`; `tests/model-discovery.test.ts` | Pass for catalog parsing and scope shape. API-key adapters intentionally erase effort metadata. |
| Atomic model/effort validation, default omission, ultra denial | `src/models/registry.ts:170-181`; `src/server/index.ts:1139-1180` | `tests/core-uplift-effort.test.ts:49-87`; API-key mounted selection in `tests/core-uplift-decisions-ws.test.ts:137-151` | Pass for local validation. |
| Discovery → WS selection → provider payload for a live Codex future model | Discovery materializes supported effort for unknown IDs (`src/models/discovery.ts:242-287`); WS selects it (`src/server/index.ts:1144-1177`); adapter serializes (`src/provider/codex/request.ts:16-46`) | `tests/core-uplift-codex-ws.test.ts:54-92` launches a temporary server with a preloaded fake Codex catalog and response endpoint, then asserts discovery, `model_changed` ACK and outgoing request body; `tests/provider/codex-adapter.test.ts` covers direct mounted adapter | **Fixed and locally covered.** Reproduced pre-patch: `serializeCodexRequest({model:'gpt-future', reasoningEffort:'low', ...})` threw `reasoning effort low is unsupported for gpt-future` after WS could acknowledge the selection. Patch carries `EffortCapability` through `src/provider/factory.ts`, `src/provider/codex/adapter.ts`, and `src/provider/codex/request.ts`. |
| Account/profile selection race and stale metadata | Profile switch increments catalog generation and resets capability (`src/server/index.ts:446-464`); async discovery checks profile identity and Codex generation (`src/server/index.ts:1113-1172`); adapter verifies live capability scope against current credential/account/endpoint | `tests/core-uplift-codex-ws.test.ts:107-147` rotates the temporary Codex account while discovery is held and asserts stale catalog refusal; `tests/core-uplift-codex-ws.test.ts:149-194` proves newer selection supersedes older out-of-order discovery; `tests/core-uplift-codex-ws.test.ts:196-239` proves profile switch drops older catalog; `tests/provider/codex-adapter.test.ts` rejects wrong-account metadata before send | **Pass for local race criteria.** Account-generation, selection-generation, and profile identity checks all pass in mounted fixtures. |
| Retry/helper isolation and default behavior | Codex provider factory/adapter (`src/provider/factory.ts:7-20`; `src/provider/codex/adapter.ts:22-126`); helper provider construction remains profile-owned | `tests/provider/invocation.test.ts`; `tests/provider/codex-request.test.ts`; `tests/agent-loop-model-override.test.ts` | Existing helper/retry tests pass. Live future-model helper continuation remains untested. |

External or explicitly excluded S4 gates: live Codex catalog/entitlement,
provider quality and billing, API-key explicit effort payloads without verified
adapter evidence, handwritten picker/UI adoption (PT-016), and live Codex
acceptance (PT-014). These remain separate from local S4 implementation
acceptance.

## S5 — lifecycle, persistence and platform

| Spec requirement | Production evidence | Test evidence | Audit result |
|---|---|---|---|
| Concurrent profiles, lazy MCP lifecycle, cancellation/shutdown/restart, voice barge-in | `src/server/index.ts:145-230,446-475,1540-1590`; `src/mcp/client.ts:42-74`; `src/voice/session.ts`; `src/provider/invocation.ts:165-220`; bounded Bulletin rate history in `src/agents/bulletin.ts:20-42` | `tests/core-uplift-platform.test.ts:5-20`; `tests/run-profile.test.ts:80-95`; `tests/provider/invocation.test.ts`; `tests/voice-*.test.ts`; mounted process/voice cycle `tests/core-acceptance-lifecycle-mounted.test.ts:227-299,326-350`; Bulletin retention `tests/core-acceptance-lifecycle-s7.test.ts:52-60` | **Partial with mounted evidence.** Temporary profiles, REST cancellation with upstream abort, fake STT/TTS barge-in, restart recovery, and registry cleanup pass. No profile-owned fake MCP matrix or repeated startup/stop leak assertion. Bulletin retains only bounded recent rate keys; no durable exactly-once claim. |
| Bounded stable run-history cursor pagination and scope binding | `src/runs/store.ts:114-166`; REST wiring in `src/server/rest.ts` | `tests/core-uplift-history.test.ts:16-42`; `tests/r2-persistence-acceptance.test.ts` | Pass for current keyset cursor, tie ordering, scope binding, malformed cursor, deleted anchor, and corruption diagnostics. Insertion/deletion behavior beyond deleted-anchor continuation is not explicitly documented or mounted across restart. |
| Atomic revisions, corruption isolation, restart interruption and owned-resource cleanup | `src/shared/atomic-json.ts`; `src/session/store.ts`; `src/runs/store.ts`; server shutdown and restart recovery in `src/server/index.ts` | `tests/r2-persistence-acceptance.test.ts`; `tests/verifiable-work.test.ts:96-106`; `tests/deferred-asks-restart.test.ts`; mounted restart cycle `tests/core-acceptance-lifecycle-mounted.test.ts:326-350` | **Partial.** Store/revision/corruption, interruption recovery, process restart, and registry cleanup pass once in a real temporary server. Repeated leak detection remains open. |
| Diagnostics distinguish requested/selected/running platform state | `src/cli/doctor.ts`; `src/server/index.ts` health/startup paths | `tests/doctor.test.ts`; `tests/cli-server.test.ts` | Local CLI diagnostics covered. Final compiled server/process evidence and Windows/device execution remain separate gates. |

External or excluded S5 gates: Windows runtime/PowerShell execution,
physical audio/device acceptance, live provider, deployment parity,
multi-process transactions, and exactly-once external effects. Cross-compiling
does not satisfy the Windows gate.

## S6 — prompt/config, execution and telemetry audit

| Spec requirement | Production evidence | Test evidence | Audit result |
|---|---|---|---|
| Prompt/config precedence metadata without content or private memory | `src/context/system-prompt.ts:6-18`; `src/context/diagnostics.ts:1-10` | `tests/core-uplift-diagnostics.test.ts:4-11`; `tests/system-prompt-sites.test.ts`; deterministic precedence/kill-switch fixture `tests/core-acceptance-lifecycle-s6.test.ts:29-53` | **Pass for declared local precedence and safe diagnostics.** Full loader coverage across every filesystem source remains outside this fixture. |
| Cancellation/deadline propagation through loop, helpers, tools, MCP, hooks and subprocesses; no late success | `src/provider/invocation.ts:40-141`; `src/provider/api-key.ts`; `src/provider/codex/adapter.ts:52-126`; `src/tools/builtin/grep.ts`; `src/hooks/runner.ts` | `tests/provider/api-adapter.test.ts`; `tests/provider/codex-adapter.test.ts`; `tests/deferred-asks-restart.test.ts`; `tests/core-acceptance-lifecycle-s6.test.ts:55-92`; mounted REST/voice cancellation `tests/core-acceptance-lifecycle-mounted.test.ts:241-256,286-299` | **Partial with mounted evidence.** Loop/provider cancellation, no-late-success, REST upstream abort, and voice cancellation pass. No single fixture traverses loop → helper → MCP/hook/subprocess and proves every boundary. |
| Correlated terminal/usage/budget state across WS/REST/SSE and saved telemetry | `src/server/session-status.ts:1-9`; `src/telemetry/logger.ts:25-38`; server run/WS terminal paths in `src/server/index.ts`; SSE run IDs in `src/server/rest.ts:286-334` | `tests/context-telemetry.test.ts`; `tests/session-status.test.ts`; `tests/provider/invocation.test.ts`; `tests/core-uplift-decisions-ws.test.ts`; mounted successful SSE/REST/replay correlation `tests/core-acceptance-lifecycle-mounted.test.ts:258-278` | **Partial.** Successful SSE token/result and persisted terminal records correlate to REST state. SSE error paths at `src/server/rest.ts:312,334` and ACP error at `rest.ts:707` omit `run_id`; failure/budget correlation remains unmet. Telemetry remains best effort by design. |

External or excluded S6 gates: prompt-content export, model quality, and
deployment/live runtime observability. The missing local audit fixtures remain
local criteria, not external gates.

## S7 — orchestration contract groundwork

| Spec requirement | Production evidence | Test evidence | Audit result |
|---|---|---|---|
| Existing spawn/agent/delegate contracts, scoped ownership and budgets | `src/agents/catalog.ts`; `src/agents/runner.ts`; `src/agents/pool.ts`; `src/tools/builtin/delegate.ts`; `src/tools/builtin/delegate-fanout.ts`; `src/server/index.ts:759-821` | `tests/spawn-contract.test.ts`; `tests/agents-loader.test.ts`; `tests/agents-runner.test.ts`; `tests/agents-fanout.test.ts`; `tests/delegate.test.ts`; `tests/spawn-taint.test.ts`; `tests/agent-loop-model-override.test.ts`; `tests/workflow-core.test.ts`; `tests/workflow-runner-pipeline.test.ts` | Pass for existing profile-as-tool loading, schema validation, depth, fanout, child cancellation/taint and workflow model override. These tests are mostly unit seams. |
| Project/board/attach/handoff/control inventory and executable compatibility | `src/server/project-handlers.ts:5-25`; REST project routes `src/server/rest.ts:544-562`; attach/runtime control in `src/server/index.ts:880-914`; board handler `src/server/board-handler.ts:1-52`; board tool `src/tools/builtin/board.ts:3-15`; wire types `src/types.ts:276-301` | Unit bounds/ownership `tests/core-acceptance-lifecycle-s7.test.ts:11-60`; mounted cross-user attach/project/board/control `tests/core-acceptance-lifecycle-mounted.test.ts:301-324` | **Partial.** WS board routing, observer mutation refusal, attach scope, and WS project ownership pass. REST `handleAssignSession` (`rest.ts:551-562`) still assigns arbitrary project IDs without `getProject` ownership/existence validation; REST project paths lack mounted scope coverage. Board operator helper bounds are tested; existing Post tool remains a separate connection-local path. |
| Preserve future Orchestrator boundaries | Existing delegation and Studio/runtime foundations only | Current tests do not claim product delivery | PT-020 remains open: persistent teammate identity, shared project/worktree policy, scheduler/autonomy and game metaphor are proposals, not S7 implementation. |

## Delivery and handoff

S4 source changes are currently working-tree edits. No credentials, paid calls,
services, deployment or client/UI files were changed. Before PT-030 can claim
the plan's integrated acceptance, resolve the REST project ownership and SSE
failure-correlation gaps, then incorporate final compiled/build evidence. Keep PT-020,
PT-014, PT-016 and platform/client tasks separate.
