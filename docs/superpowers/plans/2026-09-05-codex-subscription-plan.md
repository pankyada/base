# Plan: Codex subscription integration with API-key compatibility

Generated: 2026-09-05
Status: Local experimental implementation validated; live acceptance pending
Complexity: Medium-high
Specification: [Codex subscription design](../specs/2026-09-05-codex-subscription-design.md)

## Overview

Follow OpenCode's direct OAuth + Codex Responses backend pattern. Preserve Base's execution engine and existing API-key default. No Claude subscription integration. No App Server subprocess, proxy server, hosted tools, account pooling or automatic paid fallback.

Spec is behavioral source of truth. R01–R16 and A01–A12 refer to its requirements and acceptance matrix. Each task below is one logical commit target; write failing behavior tests first. Where several files implement one invariant, commit together. Do not commit a half-migrated production path.

Effort estimate: 15–25 focused engineering days for complete personal-use integration and acceptance, with roughly 2–4 days to first live vertical slice. Estimates depend on client-registration compatibility and ongoing dirty-tree changes. No promise of upstream access or release date.

## Prerequisites and repository discipline

- Re-read `docs/ROADMAP.md`, relevant `docs/ADR.md`, `CLAUDE.md`, local `AGENTS.md`, spec, current profile schema and active dirty diffs. User selected this work explicitly; do not choose unrelated next roadmap item.
- Current Base reference HEAD `13c9ce0fdfe8f414518faba36e4443631dd979d4` plus uncommitted work. Revalidate caller inventory; do not overwrite fleet/replay/evaluation/session changes.
- Upstream OpenCode reference `e2894562f8ba943d72172d10b727c24d5f650c16`. Spec links exact files. Pin any additional evidence and preserve MIT attribution for copied portions.
- Establish baseline: `pnpm test`, `pnpm typecheck`, `bash scripts/check-boundary.sh`; record exact pass/fail counts and failures before edits. Do not silently adopt known failures as passing. Required API regression gates must be green before feature claims.
- Use existing Node >=22, TypeScript ESM, Vitest, `openai` dependency. Prefer stdlib crypto/http/fs and installed SDK. New package only with concrete reason and lockfile review.
- Mock credentials only in repository tests. Real credentials in runtime-owned private store; no fixtures containing account tokens or private reasoning payloads from user sessions.
- No UX redesign: CLI-owned authentication, existing profile selector/status locations. Request confirmation only if a major layout/style choice becomes necessary.

## Dependency map

```text
S0 compatibility evidence + API baseline
  -> S1 credential lifecycle + CLI authentication
  -> S2 provider contract + Responses codec
  -> S3 full Base caller/continuation integration
  -> S4 usage, budgets, onboarding and surface parity
  -> S5 fault matrix, personal live acceptance and rollout
```

Detailed task dependencies below allow scheduling, not a request to spawn agents. No delegation required. Documentation-only work in this task does not start any sprint.

## Sprint 0 — Verify direct integration contract

Goal: runnable isolated compatibility probe and captured API baseline. Exit: know whether selected client/transport is viable before broad refactor.

### Task 0.1 — Baseline and call-site audit

- Locations: `src/provider/client.ts`, `src/loop/agent-loop.ts`, `src/tools/types.ts`, `src/context/`, `src/workflow/`, `src/safety/classifier.ts`, `src/improver/default-improver.ts`, `src/server/`, `src/agents/runner.ts`; new report `docs/superpowers/reports/codex-baseline.md`.
- Dependencies: none.
- Work: record clean/dirty ownership and baseline commands; enumerate every SDK construction and inference call, helper model resolver, usage sink, persistence/export reader and provider-bearing test fake.
- Acceptance: report distinguishes existing code, dirty work, failures, unknowns; explicit migration checklist includes doctor, fleet, triggers, channels, resumed and background paths.
- Validation: full baseline checks; `rg` for `new OpenAI`, `chat.completions`, `responses.create`, `createProviderClient`, `openai:` across `src` and test seams. No implementation changes.

### Task 0.2 — Pin and verify minimal Codex wire assumptions

- Locations: new `scripts/probe-codex.ts`, `tests/provider/codex-probe.test.ts`, `tests/fixtures/codex/`; evidence report `docs/superpowers/reports/codex-compatibility.md`.
- Dependencies: 0.1.
- Work: first mock-driven probe, then explicit operator-run login/inference using isolated runtime state. Reuse module once production adapter exists; probe must not become second credential implementation. Establish client registration/redirect/identity, Responses endpoint, instructions, `store:false`, streaming terminal events, function schema, opaque continuation, token usage and helper options. Live section uses S1 login implementation once available; S1 can proceed against mocks meanwhile.
- Acceptance: source-derived assumptions separated from live observations. At least one accepted text response and tool-call/result round trip required before production enablement. Record SDK version, source SHA, model, date and sanitized errors. Rejected client/identity recorded without impersonation workaround.
- Validation: no secrets in output/fixture; test URL allowlist. Never load real API keys for this probe. Include small multi-turn stateless reasoning test; unsupported option produces explicit result.

### Task 0.3 — Record proposed architectural extensions

- Locations: `docs/ADR.md`, spec, compatibility report; optional third-party notice if copying code.
- Dependencies: 0.1 and source analysis from 0.2; live outcomes may follow.
- Work: next free ADR number for API-compatible provider seam, direct Codex transport, separate credentials, estimated-cost basis. Preserve existing ADR edits; no implemented status until code lands.
- Acceptance: ADR-2 compatibility and ADR-43 budget semantics explicitly reconciled; unresolved client access visible. No Claude subscription scope.
- Validation: review references and diff; no full-suite rerun for docs alone.

Sprint demo: baseline report + mock probe; live probe only when credentials available through S1. Gate production Codex enablement on recorded successful minimal live contract.

## Sprint 1 — Credential management and login commands

Goal: login/status/logout works independently of chat. No profile or API-key behavior changes.

### Task 1.1 — Typed private credential store and lock

- Locations: new `src/provider/auth/{paths,store,lock,redact}.ts`; `tests/provider/auth-store.test.ts`, `auth-lock.test.ts`.
- Dependencies: 0.3.
- Work: versioned store/tombstone, generation/revision, bounded parsing, restrictive paths, atomic persistence, redaction, cross-process refresh/mutation lock. Audit `src/shared/atomic-json.ts` before reuse; do not broaden unrelated writer behavior.
- Acceptance: R04/R06/R07; corrupt/symlink file rejected without overwrite; concurrent writers serialize; interrupted rename leaves old record valid; Windows support limitations stated.
- Validation: temporary-home fixtures, child-process races, write failure, dead/live lock owner, stale lock nonce, file permissions, missing/corrupt/unknown-version state, redaction canaries.

### Task 1.2 — Browser PKCE login

- Locations: new `src/provider/auth/oauth.ts`, `tests/provider/oauth-browser.test.ts`.
- Dependencies: 1.1; client constants from 0.2 evidence.
- Work: state/PKCE generation, exact loopback callback, token exchange, safe HTML, five-minute timeout, abort cleanup, successful atomic store.
- Acceptance: R05; no success before token exchange/store; malformed unrelated callback cannot consume valid pending login; previous credential survives failed login; exact host/path/method checking.
- Validation: deterministic crypto injection tests + real loopback mocked issuer; denied/state mismatch/replay/port busy/network timeout/store failure; closed listener after every terminal path.

### Task 1.3 — Device login and refresh manager

- Locations: new `src/provider/auth/{device,manager}.ts`, `tests/provider/oauth-device.test.ts`, `oauth-refresh.test.ts`.
- Dependencies: 1.1–1.2.
- Work: bounded interval-aware polling, separate refresh deadline, expiry skew, single-flight and cross-process refresh, generation-safe writes, 401 once, logout tombstone/invalidation.
- Acceptance: no endless polling, stale refresh never resurrects logout, rotated refresh persists, ambiguous refresh completion never blindly loops, canceling one waiter doesn't poison others.
- Validation: virtual-clock pending/slow-down/expiry/refusal/cancel; two-process expired-token race; logout/relogin while refresh delayed; invalid_grant vs transient failure; malformed token response.

### Task 1.4 — CLI auth entry point

- Locations: new `src/cli/auth.ts`, existing `src/cli/index.ts`, `tests/auth-cli.test.ts`.
- Dependencies: 1.2–1.3.
- Work: specified login methods, read-only status JSON, logout, exit codes; lazy import before ordinary WS client startup; truthful browser-launch command with URL fallback.
- Acceptance: no profile edits, no API-key removal, status never refreshes, no unrequested startup/login; command output contains no bearer/refresh tokens.
- Validation: injected IO/home/browser opener; invalid args, SIGINT, disabled feature, logged-out status; run mock CLI subprocess; complete 0.2 live probe where available.

Sprint demo: browser and device login, local status, logout; API profile still works. Record live auth acceptance separately from mocks.

## Sprint 2 — Provider seam and Responses translation

Goal: existing API behavior through typed seam; Codex can generate normalized text/tool requests with testable wire contract. No tools executed by adapter.

### Task 2.1 — Provider types and API adapter

- Locations: new `src/provider/{types,api-key,factory,errors,usage}.ts`; existing `src/provider/client.ts`; new `tests/provider/api-adapter.test.ts`.
- Dependencies: 0.1, 0.3.
- Work: define request/result/event/capability/call-context types, preserve existing API client pooling and retry behavior, introduce additive factory without migrating callers yet.
- Acceptance: R01; API wire fixtures preserve endpoint/key/model/tools/sampling/reasoning workaround/stream usage/error behavior. Inject environment consistently; no dummy OAuth key exposed to API callers.
- Validation: before/after request and normalized output contract tests for OpenAI, Anthropic-compatible, arbitrary local base URL; cancellation and pooling keyed by resolved configuration.

### Task 2.2 — Profile union and model capability catalog

- Locations: `src/profiles/schema.ts`, `src/models/registry.ts`, new `src/provider/codex/models.ts`; relevant schema/model tests.
- Dependencies: 2.1, source/live findings from 0.2.
- Work: backward-compatible model.auth union; strict Codex settings; known model capabilities; validate primary/fallback/role/classifier/digest/improvement model paths. Update code that assumes `base_url` exists, including init/doctor access guards, so commit typechecks.
- Acceptance: old YAML unchanged; explicit OAuth ignores ambient API keys; contradictory fields fail; implicit helper IDs use primary Codex model; no future-model regex or guessed million-token window.
- Validation: legacy profile corpus + invalid/contradictory model blocks + every override; API model availability unchanged.

### Task 2.3 — Stateless request serializer and continuation codec

- Locations: new `src/provider/codex/{request,continuation}.ts`, `tests/provider/codex-request.test.ts`, `codex-continuation.test.ts`.
- Dependencies: 2.1–2.2, 0.2 fixtures.
- Work: instructions/message/tool/result conversion; optional image mapping; flat schemas; output-item vs call-ID handling; opaque state anchors; capability option filtering; stateless body.
- Acceptance: R08/R10/R11; serialized payload contains no Base taint/cache/internal metadata; all valid call/result IDs preserved; no orphan continuation group or promoted untrusted instruction.
- Validation: golden request fixtures from multi-turn/parallel tools/denial/refusal/history with legacy API turns; unsupported content and malformed metadata fail explicitly.

### Task 2.4 — SSE adapter and transport error boundary

- Locations: new `src/provider/codex/{stream,adapter}.ts`; provider factory/errors; `tests/provider/codex-stream.test.ts`, `codex-transport.test.ts`.
- Dependencies: 1.3, 2.3.
- Work: constrained authenticated fetch, SDK parser reuse if validated, normalized events and `complete` folding, bounded buffers, one retry owner, abort propagation, disabled-feature checks.
- Acceptance: R07–R09/R12/R14; exact endpoints; redirect blocked; no calls executable before valid completion; usage once; no retry after output/ambiguous disconnect; headers use latest credential generation.
- Validation: adversarial mock server with split UTF-8/JSON/SSE, interleaved args, duplicate final snapshots, invalid args, failed/incomplete/EOF/refusal/unknown tool events, quota/401/5xx/cancel.

Sprint demo: isolated provider generates text and multiple normalized tool calls; old API fixtures pass unchanged. Run full checks before each implementation commit.

## Sprint 3 — Base execution and persistence integration

Goal: whole Codex-configured run, including helper calls, works without API key. Existing safety boundaries hold.

### Task 3.1 — Migrate main loop and runtime construction

- Locations: `src/loop/agent-loop.ts`, `src/tools/types.ts`, `src/server/{index,run-profile,turn-runner}.ts`, `src/agents/runner.ts`, `src/provider/factory.ts`; runtime/loop tests.
- Dependencies: 2.4.
- Work: provider contract injection, normalized generation consumption, lazy credential resolution, transport-aware child profiles. Migrate minimum coupled helper signatures with this commit to keep build runnable; 3.3 finishes semantics.
- Acceptance: existing tool executor remains sole execution owner; missing OAuth affects only selected profile; API mode unchanged; logout/account change checked before executing generated tools.
- Validation: existing agent-loop/ACL/provenance/parallel/deferred-ask tests + mocked Codex integration; all server entry points instantiate correct provider; generation cannot bypass approval.

### Task 3.2 — Persist and project continuation safely

- Locations: `src/session/{types,store}.ts`, `src/context/{projection,digest,estimator,cache}.ts`, Codex continuation codec, REST/export/replay readers identified in 0.1.
- Dependencies: 3.1.
- Work: additive opaque metadata with serialization filter; complete-unit compaction; resume/account/model switch policy; interruption handling; context-window and overhead correction.
- Acceptance: A06; private continuation survives restart but never appears in user-visible message export/digest/replay artifact. No API requests contain provider metadata. Completed tool effects never replay.
- Validation: saved fixtures, two tool cycles, compaction crossing tool boundaries, model/account switch, corrupt metadata, canceled generation, REST history and HTML/JSON export canaries; replay executes zero network calls.

### Task 3.3 — Migrate every auxiliary generation

- Locations: `src/safety/classifier.ts`, `src/context/digest.ts`, `src/workflow/{triage,runner,knowledge}.ts`, `src/improver/default-improver.ts`, `src/cli/doctor.ts`; corresponding tests.
- Dependencies: 3.1–3.2.
- Work: shared complete call, purpose/run/deadline attribution; explicit background context; transport-compatible model choice; preserve static/error fallbacks; remove obsolete SDK imports/call sites.
- Acceptance: A07; isolated wholly Codex fleet requires no API keys; safety remains fail-closed; helper failure doesn't secretly switch provider; canceled run starts no helper; offline doctor zero network.
- Validation: deny API endpoint access in integration test and remove all key env values; exercise triage, shadow, digest, knowledge, reflection, mining, classifier, delegated profile. Static assertion direct model SDK use confined to provider layer.

Sprint demo: personal coding task with guarded tool approval, denial, second turn, restart and compaction; helper usage attributable; no key dependency. Live acceptance can be partial but must be labeled.

## Sprint 4 — Budgets, onboarding and surface parity

Goal: mode visible, quota failures recoverable, accounting honest, existing setup preserved.

### Task 4.1 — Shared usage and model-attempt budget

- Locations: `src/provider/usage.ts`, `src/runs/budget.ts`, `src/session/types.ts`, `src/usage/ledger.ts`, `src/telemetry/{logger,aggregate}.ts`, workflow/fleet usage sites and mission/evaluation summaries from audit.
- Dependencies: 3.3.
- Work: exactly-once attempt finalization; estimated/API-equivalent basis; unknown billed amount; separate subtotals; shared helper/child attempt cap and deadlines; conservative unknown-usage handling. Keep legacy numeric estimate fields compatible.
- Acceptance: A09; no zero-price budget bypass; no double-counting stage/child/session totals; missing usage not confirmed zero; root attempt cap includes retries/helpers; detached improvement bounded separately.
- Validation: main+helper+child totals, partial stream, concurrent calls, quota cooldown, max calls, zero/malformed budgets, model rejection, canceled wait; existing cost/tool/wall budget tests plus new subscription cases.

### Task 4.2 — Redacted status/protocol and existing surfaces

- Locations: `src/types.ts`, `src/server/{index,read-api,rest}.ts`, `scripts/gen-web-protocol.mjs`, `web/lib/{protocol,reducer}.ts`, `web/components/TopBar.tsx`, `tui/internal/protocol/msg.go`, `tui/internal/ui/statusbar.go`, CLI renderer.
- Dependencies: 4.1.
- Work: additive transport/auth/cost-basis metadata; attribution on run/agent/stats; expired/disabled/quota notices; model availability reasons. Use existing components; no new auth dashboard or browser credential mutation.
- Acceptance: A10; API label defaults for legacy messages, unknown quota represented honestly, no private account/token data in payloads. Older clients remain usable; new clients never label equivalent estimate as billed charge.
- Validation: generated protocol freshness, exhaustive reducer, Go decoding/status tests, multi-run interleaving, reconnect hydration; browser/TUI inspection. If major layout needed, pause that UX choice for confirmation while other tasks continue.

### Task 4.3 — Extend existing init/doctor flow

- Locations: `src/cli/{init,doctor,auth}.ts`, `src/config/{user-config,user-env}.ts` only as necessary, `tui/internal/setup/wizard.go`, `tests/{init,doctor,user-env,user-config}.test.ts`.
- Dependencies: 1.4, 2.2, 4.2.
- Work: OpenAI auth choice, preserve API default/existing explicit selection, exact profile diff and backup, transport probe/status. Keep Go wizard delegation; no second selector. Add explicit profile resolution to doctor if needed without global selection mutation.
- Acceptance: `default_profile` stays name; all profiles remain; ambient API precedence preserved; `--yes`/offline never launches OAuth; choosing OAuth doesn't delete keys; declining profile edit retains old profile and reports its actual validation.
- Validation: end-to-end scripted wizard with injected IO/environment; legacy API reconfigure; OAuth existing/missing login; refusal and failed profile write; TUI handoff; installer noninteractive behavior unchanged.

Sprint demo: switch one profile explicitly to Codex and back via existing setup, inspect estimate labels, remove credential and see actionable recovery while API profiles continue working.

## Sprint 5 — Acceptance, documentation and controlled enablement

Goal: complete A01–A12 evidence, with remaining platform/provider gates named accurately.

### Task 5.1 — Fault and regression acceptance matrix

- Locations: new `tests/codex-acceptance.test.ts`, focused provider tests, existing safety/provenance/replay/REST/agent tests.
- Dependencies: 4.3.
- Work: full mock matrix; two-process credential race; canceled/denied/stale result paths; all profile entry points; static no-direct-inference assertion; no-API-fallback network fence.
- Acceptance: every R/A mapping covered; no secrets via raw SDK error; no artifact/replay network activation; disabled feature leaves API suite green.
- Validation: `pnpm test`, `pnpm typecheck`, `bash scripts/check-boundary.sh`, `pnpm build`; exact counts reported. From `tui/`, `GOCACHE=/tmp/base-go-cache go test ./...`. Run current web typecheck/test/build scripts after inspecting its package.json; run generated-protocol freshness check. Do not invent script names or claim cross-compile as runtime acceptance.

### Task 5.2 — Personal live acceptance

- Locations: new `docs/superpowers/reports/codex-live-acceptance.md`; opt-in test/probe tooling from 0.2.
- Dependencies: 5.1; actual personal account access.
- Work: browser + device login, minimal text, real harmless tool round trip, multi-turn continuation, restart/compaction, concurrent profiles, recovery from local logout, explicit API profile still functional. Use temporary working directory; no external messages or destructive tools required.
- Acceptance: distinguish implementation tests, running binary revision, login entitlement, actual model behavior, usage/billing evidence, macOS/Linux/Windows status. No forced quota exhaustion; quota/error recovery primarily fixtures.
- Validation: redacted request IDs, model, timestamps, observed quota/billing source when available. Live tool quality and encrypted continuation acceptance required. Real expiry refresh if practical; otherwise mark refresh fixture-verified rather than live-proven.

### Task 5.3 — User docs, attribution and rollout controls

- Locations: `docs-site/architecture.md`, existing provider/setup docs discovered in audit, `docs/DEPLOYMENT.md`, `docs/ROADMAP.md`, `docs/ADR.md`, examples and third-party notice if applicable.
- Dependencies: 5.1–5.2.
- Work: document CLI commands, model-block migration, plaintext credentials, remote device login on runtime host, subscription vs estimated budget, no paid fallback, disable/rollback, model compatibility date. Update architecture provider boundary. Keep shipped profile defaults API-based.
- Acceptance: no claim of Claude subscription support, provider permission, unlimited quota, exact billing, Windows acceptance or full release before evidence. Roadmap/ADR statuses reflect achieved scope, not intent.
- Validation: examples parse, documentation links valid, no tokens in diff; builds only where docs tooling requires. Narrow commit/stage only owned changes. Push/install/deploy separately when authorized; not implied by this planning task.

Sprint demo: run evidence-backed personal Codex profile, display mode/usage, log out, recover via documented command, explicitly restore API mode. Archive acceptance report with unresolved gates if any.

## Test strategy and completion definition

Tests use local mock issuer/inference servers, fake clocks and temporary homes. No paid requests in default CI. Keep capture fixtures synthetic or carefully sanitized; never store encrypted personal payloads, auth tokens, user codes or refresh credentials.

Most important invariants: old API requests unchanged; selected backend stays selected; no secret destination drift; logout wins refresh race; completed tools never rerun; no partial tool arguments execute; opaque state doesn't leak; every helper has accounting/deadline; model/cost limits are transport-correct.

Completion requires A01–A11 automated and relevant A12 live evidence, explicit platform limitations, final code/typecheck/full suite green, docs matching actual behavior, and rollback exercised. If live client registration fails, adapter can remain experimental/mock-tested but task is not “subscription integration complete.”

## Gotchas reviewed after drafting

| Pitfall | Resolution in spec/plan |
|---|---|
| URL rewrite mistaken for protocol adaptation | S2 request + SSE codecs; OpenCode already uses Responses |
| API key still required by safety/digest helpers | S3 all-call-site migration and endpoint fence |
| API helper defaults choose unsupported cheap model | Explicit overrides validated; omitted Codex helper uses primary |
| OAuth refresh race across CLI/server processes | S1 lock, reread, generation, tombstone; conservative ambiguous-refresh failure |
| Zero subscription price bypasses autonomy budget | Preserve equivalent estimate; separate actual billing unknown |
| Unlimited hidden helper requests | Shared model-attempt cap, deadlines, bounded detached improvement |
| Reasoning lost on second tool turn/restart | S2/S3 atomic continuation grouping and live test |
| Ciphertext leaks through REST/replay/export | Reader inventory + explicit private metadata filter |
| OAuth callback lands in wrong host/container | Runtime-host login guidance; device method for remote host |
| Personal use mistaken for guaranteed OAuth permission | Explicit compatibility/policy evidence; no impersonation or bypass |
| Dirty files overwritten or broad commit staged | Baseline ownership, scoped edits/commits, reinspection before execution |

No additional user decision is required to review these documents. Scope assumptions remain explicit; changing account multiplicity or major UX later requires revision before implementing those changes.

## Rollback

Use `HARNESS_DISABLE_CODEX_OAUTH=1` to stop new OAuth inference; explicit profile edit restores API configuration. Keep API env file and credentials untouched. Local logout removes Codex secrets only. Preserve historical sessions and filter unsupported continuation metadata. Validate old binary behavior before version rollback. Never copy token stores between apps or restore token-bearing automatic backups.


## Implementation checkpoint — 2026-09-06

S1–S4 code implemented and automated regression checks passed. S0 source/probe evidence recorded; actual client registration remains unverified. S5 automated validation and operator documentation recorded; personal live acceptance (5.2), platform acceptance, and release/deployment remain pending. No implementation commits created in the pre-existing dirty checkout.

Final local evidence: [implementation acceptance](../reports/codex-implementation-acceptance.md). This checkpoint does not mark the full subscription acceptance matrix complete.
