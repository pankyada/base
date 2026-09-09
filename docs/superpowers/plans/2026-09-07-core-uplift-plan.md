# Core uplift implementation plan

Date: 2026-09-07. Complexity: high. Implementation: **gpt-5.6-luna, high**.
Source of truth: [Core spec](../specs/2026-09-07-core-uplift-spec.md).
Tracking: [PRODUCT_STATE.md](../../PRODUCT_STATE.md), PT-022–PT-030.

## Execution rules

Run S0 → S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8 in order. Each sprint is a bounded, testable increment; preserve earlier green behavior. If a live/platform gate is unavailable, record it separately and continue independent local work. Do not interpret that as permission to skip local criteria or claim full acceptance.

Core-only. Handwritten Web/TUI/Studio changes forbidden; machine-generated protocol artifacts permitted. Existing client regressions remain separate tasks. No library/API expansion needed for S1–S3; S4 must verify primary provider docs before changing any external payload. No UI/UX approval needed because no UI work occurs. User explicitly requested implementation after planning; planner skill's plan-only default does not cancel that handoff.

Before edits record `git status`, HEAD and scoped diff; capture existing Codex stream/test changes without exposing secrets. Never reset/clean or stage whole tree. Classify existing tracker/spec docs and preserve them. Small logical changes should be individually committable; commit only classified own changes if safe and all required checks pass, otherwise leave reviewed diff with explicit reason. No push/release/deploy.

## S0 — Baseline and ownership map (PT-022 planning; implementation baseline in PT-023)

- **0.1 Read contracts.** Read AGENTS.md, CLAUDE.md, tracker/features/roadmap, Core spec, relevant ADRs, `src/types.ts`, profile schema, loop, builtin index, memory interface and user paths. Check actual protocol version and generated consumers.
- **0.2 Establish green baseline.** Root `pnpm test`, `pnpm typecheck`, `pnpm build`, `bash scripts/check-boundary.sh`; protocol freshness via existing generator check scripts. Save safe results in acceptance report. If baseline fails, distinguish pre-existing failures and fix only relevant blockers.
- **0.3 Map route/state seams.** Inventory explicit/omitted scope, lease/control, snapshot/event projection, pending/approval resolution. Report file/function pointers before adding helpers.
- Demo: report identifies actual reusable functions, tests and pre-existing dirty paths; no unverified blanket claims.

## S1 — Explicit scope coherence (PT-023)

- **1.1 Tests first:** add fixture route tests for user/profile A/B, malformed body/query scope, global legacy lists, wrong-scope read/cancel/answer and contradictory scopes. Paths: `tests/`, existing REST/read API tests.
- **1.2 Shared resolver:** small helper under `src/server/` reusing `src/session/user-paths.ts`; wire `read-api.ts`, `rest.ts`, `index.ts`/project handlers only where behavior requires it. Preserve current omitted defaults and documented aggregate routes.
- **1.3 Boundary enforcement:** scope ID-based operations before `RunStore.get`, PendingStore resume/cancel, session/artifact/mission reads. Extend existing helpers instead of changing unrelated stores.
- **1.4 Contract/ADR:** document route matrix, fallback policy, cross-client required explicit fields and compatibility. Client tasks PT-004 remain open.
- Dependencies: S0. Demo: mounted fixture requests return correct scoped data and wrong-scope 404 without mutation; legacy reads still pass.

## S2 — Runtime state and response recovery (PT-024)

- **2.1 Regression cases:** `src/server/session-runtime.ts` production tests for >256 events, future/stale cursor, mutation of returned snapshots, restart, two controllers and duplicate asynchronous handlers.
- **2.2 Authoritative projection:** preserve current recoverable state separately from ring buffer; integrate actual server events and bounded serialization in runtime registry. Keep legacy serialized records readable with safe defaults/reconstruction; unknown state remains explicit.
- **2.3 Control response lifecycle:** bounded deduplication and consistent pending/success/failure behavior; controller/action ownership; no persisted executable callbacks or leases restored as authority.
- **2.4 Public seam:** extend existing opt-in runtime subscriptions/snapshots/correlation only as required, update `src/types.ts`, regenerate with repository scripts, document capability/compatibility.
- Dependencies: S1. Demo: two WS clients recover authoritative state after overflow/reconnect and cannot double-execute a response.

## S3 — Discoverable, acknowledged human work (PT-025)

- **3.1 Inventory/test:** `src/runs/pending.ts`, `resume.ts`, `src/server/session-approvals.ts`, interactive prompt and server handlers; characterize actual persistence before changes.
- **3.2 Wire current state:** existing pending/list/snapshot fields expose owning scope/run/options/expiry. Interactive approvals remain recoverable while executing and explicitly invalid on restart; no false callback resurrection.
- **3.3 Atomic resolution:** validate answers/expiry/current state, controller where applicable, remember-versus-deny; acknowledge recorded transition; prevent duplicate resume and resolve cancel/answer races.
- **3.4 Integration verification:** local REST/WS/restart fixtures, bounded event overflow, legacy error/response compatibility and server-granted scope.
- Dependencies: S2. Demo: outstanding question survives restart, competing answers resume once, old approval cannot execute after restart.

## S4 — Model capabilities and effort backend (PT-026)

- **4.1 Inspect/scope:** read existing effort spec/plan and current `src/models/discovery.ts`, registry, `src/provider/codex/models.ts`, request/factory/API-key adapter. Keep existing dirty `codex/stream.ts` and review tests intact; changes there only if necessary and isolated.
- **4.2 Capability parsing:** tests for malformed/unknown/default/none/disabled ultra; carry metadata with source/freshness/opaque scope. Remove false live inference while preserving model-default use. No added provider calls during unrelated tests.
- **4.3 Profile/protocol:** optional effort with alias conflict detection, model/effort atomic request/ack and capabilities. No profile rewrites or client picker changes. Update generated contracts only.
- **4.4 Runtime resolver:** async selection generation checks, turn snapshot, default omission, explicit invalid rejection, helper/child/workflow isolation and provider serialization.
- **4.5 Provider evidence:** fixture full WS→provider flow; fresh primary docs for any enabled API-key payload; adapters without evidence remain unsupported/unknown for explicit effort. Codex account/live tier checks are external gates, not fixture success.
- Dependencies: S3. Demo: fixture model catalog/selection emits exactly expected provider field, failed selection leaves current pair unchanged.

## S5 — Lifecycle, history and platform diagnostics (PT-027)

- **5.1 Multi-profile fixture:** server startup/run/shutdown, profile-owned MCP/voice adapters, global concurrency; use fake processes/providers and temporary homes. Verify failures cancel owned resources without touching user's services.
- **5.2 History API:** `src/runs/store.ts`, REST run handlers and existing atomic-json/session-history helpers; opt-in scoped cursor page, stable tie ordering, validated bounds, corruption diagnostics and legacy array compatibility.
- **5.3 Fault tests:** concurrent revisions, malformed records, disconnect/restart, late cancellation; fix only reproduced Core defects.
- **5.4 Doctor/evidence:** extend existing safe diagnostic seam only where needed; record package/build/running process distinction and exact host acceptance. Document Windows/real device/live provider checklist without inventing pass.
- Dependencies: S4. Demo: temporary multi-profile server restarts cleanly; scoped history page resumes without wrong-scope access; recovery diagnostics visible.

## S6 — Safe diagnostics and narrow execution audits (PT-028)

- **6.1 Prompt/config map:** identify real assembly seams, test precedence, expose metadata via existing diagnostic path without content/secret leakage. No prompt policy redesign.
- **6.2 Cancellation review:** loop/helper/tool/MCP/hook/subprocess boundaries; create failing production regression tests only for discovered defects, then narrow fixes. Record no-change outcomes explicitly.
- **6.3 Telemetry review:** compare actual WS/SSE/REST/persisted terminal and usage events; ensure correlation and unknown/cancelled/budget states remain honest; fix demonstrated inconsistencies without new observability service.
- Dependencies: S5. Demo: diagnostic output passes secret canary tests; cancelled execution leaves no late success or double-counted usage.

## S7 — Existing orchestration contract groundwork (PT-029)

- **7.1 Inventory:** inspect spawn/agents/cancel/board/attach and delegate/budget stores; document IDs, ownership, lifetimes and client-facing state. Do not add agent scheduler or decide worktree policy.
- **7.2 Contract tests:** two agents, same versus different project scopes, cancellation and direct observer/controller behavior through supported seams; fix demonstrated violations only.
- **7.3 Discovery handoff:** list missing contracts/questions for PT-020, with current capabilities and acceptance evidence. Keep game UI and orchestrator product not_started.
- Dependencies: S6. Demo: fixture agents coordinate using existing supported messages; unauthorized scope/control rejected; missing future behavior explicitly identified.

## S8 — Integrated validation and handback (PT-030)

- Full root suite/typecheck/build; boundary guard; generated Web/Studio freshness using existing scripts.
- If shared types change: Web/Studio typechecks and Go tests from `tui/` using `GOCACHE=/tmp/base-go-cache`. Read actual package scripts, do not invent commands. These are compatibility checks, not UI changes.
- Repeat mounted local scope/recovery/decision/provider fixture path against final build. Negative paths matter as much as happy path; no paid inference needed.
- Report exact counts/results, source changes, affected client capabilities/adoption work, remaining live/platform gates and commit/worktree state. Preserve earlier test evidence dates.
- Update PRODUCT_STATE.md, FEATURES.md baseline where justified, ROADMAP.md Core track, ADR for load-bearing changes. No greenwashing of client bugs, full effort UX, live Codex, or Orchestrator.

## Risks and rollback

- Additive compatibility first; old consumer tests guard required fields and default behavior. New consumer opt-in cannot silently weaken old ACL/scope semantics.
- Persistent snapshot additions must read old records and avoid storing secrets/unbounded payloads. Unknown/corrupt state fails visibly; no migration deleting old data.
- Race tests use controlled promises/clocks and isolated servers, not flaky sleep-based assertions.
- Revert logical Core patches if regression occurs; retain readable old records and default provider path. No external state changes to roll back in this task.
- If client adoption is needed, record separate PT follow-up; never bypass Core-only restriction to make a demo look complete.
