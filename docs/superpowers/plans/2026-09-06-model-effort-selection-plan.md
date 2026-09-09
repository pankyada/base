# Plan: Model effort selection

Generated: 2026-09-06. Complexity: medium for Codex; high across all providers.
Status: Draft; implementation not started.
Source of truth: [spec](../specs/2026-09-06-model-effort-selection-spec.md).

## Overview and prerequisites

Deliver provider-aware effort from shared discovery to runtime execution and UI. Default sequencing is Codex first; OpenAI API and Anthropic are explicit follow-on phases. Obtain UX approval for the proposed in-panel effort subpanel before UI work. Confirm provider sequencing when the pending preference is answered. No new dependencies needed for Codex work.

Read ROADMAP, relevant ADRs, CLAUDE and the spec before implementation. Establish full-suite/typecheck baseline, classify dirty worktree, and preserve unrelated Graphify/settings/artifacts. Use TDD and one logical commit per task. Revalidate provider docs/catalog at implementation time; snapshot in the spec is evidence, not a hardcoded allowlist.

## Sprint 1 — Capability truth and provider plumbing

Goal: developer can inspect exact effort capabilities and validate a profile-driven request.

### 1.1 Capability schema and discovery

Locations: `src/types.ts`, `src/models/discovery.ts`, `src/models/registry.ts`, new focused tests.
Dependencies: none.
Add effort metadata and scope; retain provider options/default/descriptions; distinguish advertised/selectable. Add bounded same-account cache and invalidation, explicit unknown/unsupported/stale states. Keep setup and runtime on the same discovery path.
Acceptance/tests: all seven live shapes, omitted/malformed metadata, duplicate/novel values, timeouts, account changes, stale refresh failure, transport-separated same model IDs. Snapshot fixtures contain no credentials.

### 1.2 Profile compatibility and effective-effort resolver

Locations: `src/profiles/schema.ts`, new `src/models/effort.ts`, profile tests.
Dependencies: 1.1.
Implement generic optional profile field, deprecated Codex alias rules, Default/null semantics and deterministic precedence. Keep schema loading offline; perform capability validation at invocation/selection time. Remove synthetic effort support and fake live provenance in Codex capability fallback without broadening unrelated capability refactors.
Acceptance/tests: conflicting aliases fail, old profiles load, unknown explicit values fail before inference, default omits parameter, model changes cannot inherit incompatible values.

### 1.3 Codex adapter and turn propagation

Locations: `src/provider/codex/models.ts`, `request.ts`, `adapter.ts`, `src/provider/factory.ts`, `src/provider/invocation.ts`, `src/loop/agent-loop.ts`.
Dependencies: 1.2.
Use validated capabilities instead of fixed effort list. Capture selected settings per turn; preserve across retries/tool continuation. Audit fallback/workflow/helper paths for unintended inheritance. Advertised ultra stays disabled until separate compatibility probe proves its behavior fits Base's tool ownership and budgets.
Acceptance/tests: exact outgoing effort for supported literals, omission for Default, unsupported values fail without network, cancellation/deadline/call limits preserved. Record a runnable bounded provider probe.

Demo gate: fixture catalog → profile resolver → captured Codex request; live catalog metadata displayed with honest provenance.

## Sprint 2 — Atomic runtime selection and durable restore

Goal: real WebSocket client changes model/effort together and reconnects correctly.

### 2.1 Protocol and server state

Locations: `src/types.ts`, `src/server/index.ts`, `tui/internal/protocol/`, `web/lib/protocol.ts`.
Dependencies: 1.3.
Add optional effort/request correlation and feature advertisement. Emit authoritative state in initial/models/changed responses. Recheck active-turn/approval/observer/profile/account constraints after awaits; reject invalid pairs atomically. Preserve v4 model-only clients.
Acceptance/tests: actual server WS list → apply → acknowledgment; invalid pair changes neither field; profile switch during discovery, concurrent requests, active-turn start during refresh and old-client compatibility.

### 2.2 Persistence and reconnect

Locations: `tui/internal/prefs/prefs.go`, `tui/internal/ui/model.go`, server turn/session metadata.
Dependencies: 2.1.
Persist only acknowledged pair using opaque provider scope/profile/model key. Migrate existing model preferences. Refresh capabilities before restore; send one pair. Capture effective settings in run metadata; distinguish provider default from explicit literal.
Acceptance/tests: restart, removed effort/model, account replacement, malformed old preferences, rejected ACK and cross-profile isolation. Existing saved-model behavior remains intact.

Demo gate: select high, reconnect, inspect acknowledgment and next outgoing provider request. Repeat Default and unsupported literal paths.

## Sprint 3 — Operator controls

Goal: effort selection works in actual TUI and setup.

### 3.1 TUI MODEL subpanel

Locations: `tui/internal/ui/overlay.go`, `model.go`, associated app-flow tests.
Dependencies: 2.2 and approval of proposed UX.
Implement model → effort subpanel, direct current-model effort edit, descriptions/default marker, loading/disabled/error states and current effort display. Preserve filtering, long IDs, shared Tab navigation and cancellation.
Acceptance/tests: keyboard-only choose/apply/back, all outer tabs, narrow/wide resize, unsupported/unknown states, stale response, rejected change. Manual real TUI capture must show options beyond high where eligible.

### 3.2 Setup

Locations: `src/cli/init.ts`, `tests/init.test.ts`.
Dependencies: 1.3 and 2.1; can follow 3.1 without shared-file edits.
Ask effort after model; preserve existing diff/confirmation, backups and credential handling. Include effort in actual saved profile summary. Preserve --yes/offline behavior and alias migration.
Acceptance/tests: selected pair survives YAML reload, decline writes neither setting, default clears prior override when confirmed, unsupported skips selector, no API-key output.

### 3.3 Web and readline parity

Locations: `web/components/Palette.tsx`, `TopBar.tsx`, `web/hooks/useHarnessWS.ts`, `src/cli/index.ts`.
Dependencies: 2.1; design follows approved pattern for each surface.
Consume shared capabilities/state, expose pair selection and defaults, gate on server support. Keep persistence acknowledgment-based and provider-scoped.
Acceptance/tests: old server, reconnect, rejection, model changes and exact selected setting reaching server. No independent hardcoded effort list.

Demo gate: same model/effort chosen through setup, TUI, web and CLI; report each surface's actual acceptance independently.

## Sprint 4 — Additional provider adapters

### 4.1 OpenAI API effort

Locations: `src/provider/api-key.ts`, provider capability records, schema/factory if explicit transport required.
Dependencies: 1–2.
Verify official endpoint-specific model support; resolve forced-none tools branch and sampling/token constraints. Add documented capability records where API listing omits them. An explicit Responses adapter, if required, is a separately reviewed prerequisite rather than an invisible transport switch.
Acceptance/tests: ordinary generation plus tool continuation for selected efforts; provider default omission; unsupported combinations rejected; unchanged billing mode. Live probes required before marking provider supported.

### 4.2 Anthropic effort

Locations: provider schema/factory, new native adapter if required, model capability records.
Dependencies: shared resolver/protocol; independent of 4.1.
Validate actual transport support for `output_config.effort` and thinking requirements. If native Messages adapter is needed, write adapter-specific ADR/tasks before implementing its stream/tool/usage translation. Keep control disabled with explanation until implemented and verified.
Acceptance/tests: exact native payload, per-model levels, incompatible thinking combinations, tool-result continuation, cancellation and usage normalization. No generic `reasoning_effort` forwarding to Anthropic.

Demo gate: selected effort appears in correct provider-specific request on each enabled transport. Unfinished adapters are explicitly unavailable.

## Sprint 5 — Acceptance and release

### 5.1 End-to-end matrix

Dependencies: each shipped provider/surface sprint.
Run full `pnpm test`, `pnpm typecheck`, `bash scripts/check-boundary.sh`, and `GOCACHE=/tmp/base-go-cache go test ./...` from `tui/` for Go. Verify actual server WS selection and preference restore. Execute bounded live text/tool probes for enabled effort tiers; record model, transport, catalog date, exact requested setting and provider acceptance without secrets or reasoning text. Do not claim quality improvement from a successful request.

### 5.2 Build/deploy and documentation

Dependencies: 5.1.
Update roadmap/status and operator docs, commit scoped tasks, then perform authorized version bump, build, install and push/tag workflow. Verify local CLI/TUI/server versions, restart correct server with preserved profile/CWD, and inspect its live catalog/state. Existing running processes do not inherit new binaries. Windows cross-compilation is not Windows UI acceptance.

## Risks and rollback

- Catalog may advertise modes requiring unsupported protocol behavior: separate advertised and selectable, especially ultra.
- API and subscription options/defaults differ: never merge by model name alone.
- More effort can exhaust unchanged output/time budgets: retain caps and report clear failures.
- Legacy forced-none logic may conflict with operator intent: resolve before API rollout, never silently override explicit effort.
- Helpers/fallbacks can change models: resolve independently; test no parent setting leaks.
- Old clients/preferences and async catalog refresh can undo selection: capability handshake, correlated ACKs and scope-aware restore.
- UI approval/provider sequencing are open review items, not assumptions that implementation may silently finalize.

Rollback: disable effort UI capability advertisement; preserve legacy model-only wire path and legacy profile alias; revert affected sprint commits without deleting profiles/preferences. Restore prior binaries and restart only the identified server. Keep unknown preference fields harmless to older clients.
