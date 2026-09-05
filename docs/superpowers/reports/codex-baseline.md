# Codex integration baseline and migration inventory

Recorded 2026-09-06. Implementation reference: `13c9ce0fdfe8f414518faba36e4443631dd979d4` plus existing uncommitted work. This report records the initial runtime before provider migration; it is not a release or live-provider acceptance report.

## Ownership and evidence

The working tree already contained changes across server, CLI, profiles, sessions, loop, fleet, replay, artifacts, protocol, web and TUI. They must be preserved. A parent-review snapshot was saved outside the repository at `/tmp/base-codex-parent-review/preexisting.patch` and `preexisting-status.txt`. These temporary files are local review aids, not durable release evidence.

The requested implementation is performed by a `gpt-5.6-luna` sub-agent with `high` reasoning. Parent review checks contracts and regressions. No real credentials were read from Codex, OpenCode or other applications. No live OAuth or inference acceptance has occurred.

| Check | Initial result |
|---|---|
| `pnpm test` | 138 test files, 792 tests passed |
| `pnpm typecheck` | Passed |
| `pnpm --filter harness-web typecheck` | Passed |
| `GOCACHE=/tmp/base-go-cache go test ./...` from `tui/` | Passed; six tested packages, `ws` had no tests |
| Boundary guard | First parent check occurred after additive provider drafts; rejected two new legitimate protocol-role literals. Requires narrow allowlist changes and final rerun; not evidence of a preexisting failure. |

Baseline output is retained locally under `/tmp/base-codex-parent-review/`. Focused authentication tests later passed 6 files / 12 tests, after a failed-exchange unhandled rejection was fixed. Those tests do not establish all authentication acceptance criteria or runtime integration.

## Inference construction and callers

The existing API implementation constructs and pools OpenAI-compatible SDK clients in `src/provider/client.ts`. Pool identity includes resolved endpoint and API key. Preserve ambient environment resolution and arbitrary compatible endpoints.

| Area | Initial files and responsibilities |
|---|---|
| Main loop | `src/loop/agent-loop.ts`: streaming completions, retry owner, reasoning workaround, tool accumulation, usage, safety and execution |
| Interactive server | `src/server/index.ts`: initial client, per-connection profile changes, model changes, plan/fleet/normal runs, disconnect improvement |
| Shared one-shot runner | `src/server/run-profile.ts`, `src/server/turn-runner.ts`: REST, stream, trigger/channel/durable execution convergence |
| Child runs | `src/agents/runner.ts`, `src/tools/builtin/delegate.ts`: independently configured profiles and inherited budget/context |
| Artifact follow-up | `src/artifacts/runtime.ts`: constructs provider for guarded artifact actions |
| Context helper | `src/context/digest.ts`, `src/context/projection.ts`: cheap/digest model and context compression |
| Safety helper | `src/safety/classifier.ts`: classifier override, trusted prompt separation, refusal handling |
| Workflow helpers | `src/workflow/triage.ts`, `runner.ts`, `knowledge.ts`: triage A/B, model-tier selection, shadow completion, extracted knowledge |
| Improvement | `src/improver/default-improver.ts`: summary/reflection and mining; lifecycle and budget need explicit treatment |
| Diagnostics | `src/cli/doctor.ts`: offline checks and explicit live smoke request |
| Context contract | `src/tools/types.ts`: SDK client currently exposed through tool context |

Initial SDK-bearing test seams occur in agent-loop/model-override, agents-runner/fanout, audit-journal, context digest/projection/restore/telemetry, deferred-asks-restart, delegate, improver-summary, provenance-gate, provider-client, run-profile, safety-classifier, spawn-taint, stage-acl, system-prompt-sites, workflow-runner-pipeline and workflow-triage tests. Existing fake behavior must remain covered when migrating the provider seam.

## Persistence and accounting review points

- `src/session/types.ts` and `store.ts` own messages and usage. Validate bounded opaque continuation on load and use restrictive persistence for sessions carrying it.
- `src/context/digest.ts` currently JSON-stringifies earlier messages. Explicitly remove provider-only state before helper prompts.
- `src/context/estimator.ts` currently counts serialized message size. Encrypted payloads require transport-overhead treatment, not ordinary text-token estimates.
- `src/server/read-api.ts` message projection returns ordinary messages largely unchanged. Do not leak opaque state through REST readers.
- `src/replay/index.ts` branches by shallow-copying messages. Branch/export/replay must not expose or reuse stale account-bound continuation.
- `src/usage/ledger.ts`, session usage and protocol stats must preserve `cost_usd` compatibility while distinguishing subscription API-equivalent estimates from actual billed cost.
- `src/runs/budget.ts` already allocates child costs and reservations. New model-attempt accounting must avoid double-counting those allocations and must count helper calls and uncertain attempts.
- `src/server/run-profile.ts` must preserve usage even on provider failures. Server disconnect improvement must be canceled or explicitly bounded rather than starting unbounded detached model work.
- Tool execution remains solely in Base. Malformed Codex arguments must fail before the loop's historical JSON fallback can turn malformed input into an executable empty object.

## Remaining acceptance

The implementation plan remains authoritative. A passing API baseline is not proof of Codex support. Required future evidence includes complete mocked protocol/fault tests, every runtime entry point, all helper models without an API key, continuation isolation, budget/deadline behavior, CLI/onboarding compatibility, full TypeScript/web/TUI checks, and an operator-run real text plus tool-result round trip. Windows ACL and browser-launch behavior require platform acceptance separately.
