# Harness product state and task tracker

Last updated: 2026-09-07 (Australia/Sydney).

Canonical current-state and task record for this repository. Update before reporting any task complete. All tasks count: implementation, fixes, reviews, documentation, validation, releases, and deployments.

## Authority and maintenance

- **This file:** current component/feature state, next priorities, task status, completion evidence, and unresolved gaps.
- **[FEATURES.md](FEATURES.md):** primary feature taxonomy across Core, TUI, Web Chat, Analyst Workbench, Operator, Assistant and Multi Agent Orchestrator. Tasks cite a primary feature ID plus affected clients; Core changes record shared-contract compatibility and client impact.
- **[ROADMAP.md](ROADMAP.md):** numbered feature requirements and sequencing. Specs linked there define acceptance criteria; this tracker cannot waive them.
- **[ADR.md](ADR.md):** architectural decisions. Detailed plans and reports remain linked evidence, not competing current-state trackers.
- When evidence conflicts, verify current source/runtime and update affected rows. Preserve dated reports; explain which newer evidence supersedes them. Unknown is preferable to an unsupported completion claim.
- Every task gets a stable `PT-NNN` ID. Allocate the next unused number; never renumber or recycle IDs. An external issue/PR may be linked alongside it.
- Before implementation, record scope, component/feature, acceptance criteria, and `in_progress`. Short read-only tasks may be recorded at closeout. Update status when blocked or paused.
- At completion, update affected state rows, task row, last-updated date, and completion log. Record checks actually run, remaining gaps, and delivery state. Include these changes in the task commit/PR when one is made.
- Every open problem must remain an open task or have an explicit linked follow-up. Do not close a feature merely because one task or its tests passed.
- Keep secrets, credentials, private runtime payloads, and machine-generated logs out of this file. Link safe repository evidence; temporary logs are supplementary and may disappear.
- No script currently enforces these updates. `AGENTS.md` and `CLAUDE.md` require them; reviewers should check compliance.

## Status vocabulary

| Dimension | Values and meaning |
|---|---|
| Task | `planned`, `in_progress`, `blocked` (state reason), `paused`, `done` (stated criteria met), `cancelled` (record reason) |
| Implementation | `not_started`, `partial`, `implemented`, `unknown` |
| Acceptance | `not_verified`, `automated`, `local_runtime`, `partial`, `accepted` (all named feature criteria met) |
| Delivery | `working_tree`, `committed` (verified SHA), `released` (verified tag/artifact), `deployed` (verified host/version), `unknown` |

Dimensions are independent. Acceptance labels identify evidence, not a percentage or universal quality score. Record the date and exact coverage alongside them. Deployment alone does not establish acceptance.

## Product snapshot

2026-09-07 review baseline: package version `0.9.6`, HEAD `4d728b9`, with pre-existing tracked/untracked edits. Review included working-tree code. This is not proof that installed binaries or deployed services match HEAD.

**Assessment:** substantial runtime and developer TUI; broad Web implementation with unresolved transport, identity, operational-state, and UX gaps. Single-operator localhost posture; user scopes are not authenticated multi-tenant accounts. No defensible single completion percentage.

Delivery: current tracker/instruction changes are `working_tree`; overall installed/released/deployed parity `unknown`. No harness service was listening on expected local ports during the review. Temporary Web dev server was started for disconnected-state inspection and stopped afterward.

## Component state

| Component | Implementation / acceptance | Available capability | Remaining limits / tasks |
|---|---|---|---|
| Runtime, profiles, tools, memory, workflows | implemented / automated | Profile-driven loop, ACL/approvals, MCP, delegation, context projection, persistence, budgets, provenance | Suite coverage is not exhaustive live acceptance; see feature register and PT-015 |
| Go TUI | implemented / partial | Transcript/tool timeline, approvals, models/profiles, skills, sessions, memory, inbox, undo, queueing, cost/context, setup delegation | Disconnected sends and reconnect/session recovery need validation/fix; no WS package tests; PT-003, PT-013 |
| Web chat | partial / partial | Streaming, approvals, sessions, models/profiles, stages, notebook output, cost/context | Offline send failure browser-confirmed; identity/reconnect/history gaps; PT-002, PT-004, PT-005 |
| Web analyst / widgets / surfaces / canvas | partial / partial | Fixed charts/tables, dataset drawer, opaque-origin surfaces, notebook files, artifact lineage, recipes/refresh | Export fidelity and browser-local canvas durability; PT-009, PT-010 |
| Web operator `/ops` | partial / partial | Run rows, approval queue, inbox, undo, audit, telemetry, skills, channels | Unavailable shown as empty, stale fetches, event-buffer state loss, incomplete layout; PT-006–PT-008, PT-011 |
| Web assistant `/home` | partial / partial | Brief cards, memory timeline/conflicts, trigger health | Raw object summaries, missing skills fetch, offline/identity errors; PT-004, PT-006, PT-012 |
| Replay, evaluations, missions, rehearsal, corrections, Studio challenges | implemented / partial | R1–R11 integration reported with local runtime/browser gates | Prior report evidence, not revalidated comprehensively in this review; independent/live quality gates remain; PT-015 |
| CLI / installers / onboarding | implemented / partial | Init/doctor, profile pointer, contained env, platform artifacts | Windows runtime acceptance and installed binary parity unverified; PT-013 |
| Codex OAuth transport | implemented / partial | Explicit opt-in provider transport, credential lifecycle, budget/accounting seams | Live entitlement/login/tool/restart/billing acceptance remains recorded pending; PT-014 |
| Model-aware effort selection | not_started / not_verified | Draft spec and plan | Capability-aware effort UI/runtime implementation; PT-016 |
| Multi Agent Orchestrator | not_started / not_verified | Proposed agent-team/project/task workspace with direct interaction, optional orchestrator agent and game-like visualization; existing delegation/Studio foundations may be reused | Separate discovery PT-020; metaphor, layout, shared-project policy and implementation not decided |

## Feature register

Roadmap ✅ labels below are historical roadmap claims, not newly verified release evidence. Feature groups preserve every original numbered item. For detailed criteria, follow [ROADMAP.md](ROADMAP.md).

| Roadmap feature IDs | Scope | Current implementation state | Acceptance / next action |
|---|---|---|---|
| #1, #2 | User isolation, custom tools, pluggable memory | implemented (roadmap ✅) | Core tests pass; Web scope propagation defect PT-004 |
| #3, #4 | Agent composition, REST/SSE typed contracts | implemented (roadmap ✅) | Automated baseline; external integration coverage not re-established |
| #5, #6 / #6a | Durable triggers, A2A/ACP interoperability | implemented (roadmap ✅) | Runtime breadth documented; external protocol acceptance not re-established |
| #7, #14, #24 | TUI uplift/revamp/runtime parity | implemented with open defects (roadmap ✅) | Go packages pass; PT-003, PT-013 |
| #8, #9 | Web client, input requests/todos | implemented with open defects (roadmap ✅) | PT-002, PT-007, PT-008 |
| #10, #13 | Documentation, deployment/usage | implemented (roadmap ✅) | Docs status drift and deployed parity PT-013, PT-017 |
| #11, #12 | Code executors, instance modes | implemented (roadmap ✅) | Live executor/provider matrix not re-established |
| #15, #16 | Adaptive workflow, context projection | implemented (roadmap ✅) | Root automated baseline |
| H0.1, #17–#22 | Boundary guard, channels, deferred asks, temporal memory, watch/poll, budgets, provenance | implemented (roadmap ✅) | Runtime implementation exists; browser control-plane gaps PT-006–PT-008 |
| #23 | Multi-profile server and audio | partial acceptance (roadmap 🔄; code implemented per roadmap) | Full multi-profile/audio acceptance and delivery status PT-015 |
| #25, #26 | Origin/approval transport boundaries, read APIs, Web protocol parity | implemented with open defects (roadmap ✅) | Read scope, connection and operator-state defects remain; PT-004–PT-008 |
| #27 | Generative surfaces and widget kit | partial, substantial code exists (roadmap ❌) | Older widget-stub notes superseded by R1 report; full checklist reconciliation PT-017 |
| #28 | Analyst workbench | partial, substantial code exists (roadmap ❌) | Recipe refresh/lineage reported locally accepted; export/storage gaps PT-009, PT-010 |
| #29 | Operator and assistant surfaces | partial, pages exist (roadmap ❌) | Reliability + UI + typed inbox work PT-006–PT-008, PT-011, PT-012 |
| #30 | Guided install / first run | implemented (roadmap ✅) | Windows and live install acceptance PT-013 |
| R1–R11 (additional track) | Verifiable agent work | implemented per integrated report | See E-003; local fixtures do not establish live model quality; PT-015 |
| Codex subscription | OAuth provider integration | implemented, experimental | See E-004; PT-014 |
| Model-aware effort | Capability-aware model/effort preference | not_started | Draft spec/plan; PT-016 |
| ORCH-01–ORCH-08 (new product area) | Multi-agent teams, tasks, collaboration, direct interaction, optional orchestrator and game-like world | not_started | [Primary features](FEATURES.md#7-multi-agent-orchestrator--collaborative-agent-workspace); discovery PT-020 |

## Tasks and open gaps

### Active Core-only uplift (2026-09-07)

User authorized ordered Core implementation by Luna high. [Specification](superpowers/specs/2026-09-07-core-uplift-spec.md) and [plan](superpowers/plans/2026-09-07-core-uplift-plan.md) govern PT-023–PT-030. No handwritten client/UI changes; generated protocol artifacts and compatibility checks allowed. Existing client tasks remain open.

### Core uplift triage (2026-09-07)

Priority order: identity/scope consistency (CORE-01/07), client protocol recovery (CORE-02/03), durable human decisions (CORE-08), provider/model/effort completion (CORE-04), then multi-profile/platform acceptance (CORE-02/10/12). Existing PT-003–PT-008 and PT-013–PT-016 cover these gaps. Current evidence identifies several client defects, not proof that their Core mechanisms are missing: reuse existing live-session/snapshot/control contracts before extending protocols.

Prompt/config explainability (CORE-05), cancellation/resource cleanup audits (CORE-06), and canonical telemetry semantics (CORE-11) are proposed improvement/audit scopes, not newly confirmed defects. Multi-agent workspace/message/task contracts (CORE-09) depend on PT-020 discovery; no implementation scope approved yet. Product login/RBAC remains outside current scope.

Priority: P1 = correctness/operator trust; P2 = completeness/acceptance; P3 = follow-on capability. This is planning priority, not a security severity rating. Follow explicit user scope first.

| ID | Priority | Component / scope | Status | Completion criteria / evidence needed |
|---|---|---|---|---|
| PT-001 | P2 | Product tracker and instruction workflow | done | Seed state/features/review backlog; require every-task closeout in both instruction files; validate links and diff |
| PT-002 | P1 | Web disconnected message delivery | planned | Reject or visibly retain unsent input; no false working state; browser disconnect/reconnect/cancel tests. Evidence: `useHarnessWS.ts:55`, `HarnessApp.tsx:97`; E-002 |
| PT-003 | P1 | TUI send errors and session recovery | planned | Surface write failures, preserve unsent text, recover selected session/profile after reconnect; add meaningful transport tests. Evidence: `tui/internal/ws/client.go:124`, `tui/internal/ui/model.go:1531` |
| PT-004 | P1 | Web REST/WS identity and transcript scope | planned | All user-scoped reads/writes use active WS identity/profile consistently; switching identity clears stale state; test history, usage, audit, memory across two scopes. Evidence: `web/hooks/useHarnessQuery.ts`, `src/server/read-api.ts:165` |
| PT-005 | P1 | Web reconnect lifecycle | planned | Cancel retries on cleanup; one active socket; stale callbacks ignored; session recovery validated. Evidence: `web/hooks/useHarnessWS.ts:18` |
| PT-006 | P1 | Web unavailable versus empty | planned | Backend failure displays unavailable/error with retry; never reassuring empty state; verify `/ops` and `/home`. Evidence: E-002, `web/app/ops/page.tsx:30`, `web/app/home/page.tsx` |
| PT-007 | P1 | Operator persistent state and acknowledgments | planned | Outstanding approvals/budget/skills survive >200 events, navigation and reconnect; decisions remain pending until acknowledged; initial requests wait for connection. Evidence: `SocketProvider.tsx:22`, `web/app/ops/page.tsx:47` |
| PT-008 | P1 | Operator refresh and deferred inbox | planned | New/answered/expired asks update live; supported text/select/multi-select values validate; run/channel/metrics snapshots stay current. Evidence: `web/app/ops/page.tsx`, `web/components/ops/Inbox.tsx` |
| PT-009 | P2 | Export fidelity | planned | Define and meet visual PDF/PNG scope, complete session/artifact bundle, Unicode/pagination and failure reporting; inspect exported artifacts. Current PDF is text-only, SVG/PNG first-SVG only; `web/lib/export.ts` |
| PT-010 | P2 | Canvas durability | planned | Explicit storage limits/errors, recoverable oversized artifacts, documented browser-local versus server persistence; no silent loss. Evidence: `web/lib/canvas.ts` |
| PT-011 | P2 | Operator UX completion | planned | Confirm major layout first; run lanes, clear statuses, readable tables, actionable summaries, responsive verification. Current browser layout lacks hierarchy; E-002 |
| PT-012 | P2 | Assistant UX/data completion | planned | Confirm major layout first; meaningful brief summaries, actual skills/channels wiring where required, next-fire/spend/attention states; verify populated and empty cases. Evidence: `web/components/assistant/Brief.tsx`, `web/app/home/page.tsx` |
| PT-013 | P2 | Platform and delivery acceptance | planned | Establish installed/release/checkout parity separately; interactive TUI recovery plus Windows installer/runtime checks; record exact versions/platforms |
| PT-014 | P2 | Codex live acceptance | planned | Complete documented login/entitlement, text/tool/multi-turn/restart, refresh and attribution gates; no mock-only acceptance. E-004 |
| PT-015 | P2 | Multi-profile/audio and verifiable-work acceptance | planned | Reconcile named spec gates with latest integrated evidence; track live/device/model and independent review gaps separately; do not equate fixtures with external quality. E-003 and #23 |
| PT-016 | P3 | Model-aware effort selection | planned | Execute approved spec/plan with capability-aware model/effort acknowledgment and transport validation; UX/provider sequencing remains review item |
| PT-017 | P2 | Roadmap acceptance reconciliation | planned | Reconcile #23/#27–29 and stale sequencing/prose against current source and named criteria; mark partial honestly, preserve historical reports |
| PT-018 | P2 | TUI/Web product-state review | done | Source/test review plus disconnected Web browser checks recorded; findings remain open as PT-002–PT-017; E-001/E-002 |
| PT-019 | P2 | Seven-area primary feature taxonomy | done | Stable feature IDs and ownership defined in FEATURES.md; existing/proposed scope distinguished; Orchestrator discovery PT-020 added without UX decisions |
| PT-020 | P2 | Multi Agent Orchestrator discovery | planned | Brainstorm user journeys, agent/project/workspace model, direct interaction, optional orchestrator, collaboration boundaries and event-driven game view; confirm major UX before implementation |
| PT-021 | P2 | CORE / uplift triage review | done | Prioritize Core cleanup versus client defects, acceptance gaps and proposed audits; inspect current tracker/protocol/scope contracts; record findings without implementation claims |

| PT-022 | P2 | CORE / ordered uplift specification and plan | done | Core-only spec/atomic sprint plan created; existing contracts and exclusions explicit; Luna high handoff prepared |
| PT-023 | P1 | CORE-01/07 / explicit scope consistency | done | Core spec S1: real route isolation, malformed scope, legacy omitted defaults and wrong-scope mutations; clients unchanged |
| PT-024 | P1 | CORE-02/03 / runtime recovery contracts | done | Core spec S2 local criteria pass: authoritative bounded snapshots, cursors, controller and response deduplication; additive correlation and mounted overflow/decision checks; no handwritten client changes |
| PT-025 | P1 | CORE-08 / human decision recovery | done | Core spec S3 local criteria pass: scoped outstanding work, atomic durable questions, validated acknowledgment and race-safe resolution; mounted REST/WS/store coverage; no resurrected callbacks |
| PT-026 | P2 | CORE-04 / provider capability and effort backend | done | Core spec S4 local criteria pass: truthful scoped metadata, unknown/default compatibility, bounded profile aliases, atomic model/effort validation and Codex payload fixture; API-key effort remains adapter-unknown; no picker/UI or new adapters; PT-014/PT-016 remain partial |
| PT-027 | P2 | CORE-02/07/10/12 / lifecycle history platform | done | Core spec S5 local criteria pass: versioned scope-bound keyset run cursor, corruption diagnostics count, awaited MCP shutdown and voice barge-in fixture; external platform acceptance explicit |
| PT-028 | P2 | CORE-05/06/11 / diagnostics and execution audits | done | Core spec S6 local criteria pass: opt-in safe prompt source/size diagnostics plus existing cancellation, provider failure and telemetry status audits; no prompt content export |
| PT-029 | P2 | CORE-09 / orchestration contract groundwork | done | Core spec S7 local criteria pass: existing spawn/agent/fanout/cancellation/taint/workflow compatibility inventory and tests; no game UI or new scheduling/workspace policy |
| PT-030 | P2 | CORE / integrated uplift acceptance | done | Final Core fixture matrix and full checks pass; generated protocol/Web typecheck and Go verification pass; implementation, client/live acceptance and deployment state separated |

Suggested first sequence: PT-002/PT-003 → PT-004/PT-005 → PT-006/PT-007/PT-008 → PT-009–PT-012. This does not authorize unrelated implementation automatically.

## Evidence register

| ID | Date | Scope and result | Limits / durable pointers |
|---|---|---|---|
| E-001 | 2026-09-07 | Root `pnpm test`: 157 files / 896 tests passed. Web `pnpm --filter harness-web test`: 23 files / 62 tests passed. Root/Web typecheck passed. `GOCACHE=/tmp/base-go-cache go test ./...` from `tui/`: six tested packages passed; WS package no tests | Review working tree; some Go results cached. No production build, full E2E rerun, interactive TUI, live model, or deployed-version check. Supplemental logs: `/tmp/base-review-tests.log`, `/tmp/base-review-web-tests.log` |
| E-002 | 2026-09-07 | Real browser, temporary Next dev server on 3107 with backend unavailable: chat submission falsely entered working state; `/ops` and `/home` showed reassuring empty states. `/ops` screenshot showed plain stacked layout and cramped audit headings | Disconnected-state review only. Browser/tool outputs in review task; no permanent screenshot saved. Source pointers in PT-002/PT-006/PT-011. Playwright wrapper failed `sh: playwright-cli: command not found`; available browser tool used instead |
| E-003 | 2026-09-05 | [Integrated R1–R11 report](superpowers/reports/2026-09-05-verifiable-agent-work-implementation.md) records repository runtime/browser gates and implementation | Historical report, not a fresh comprehensive acceptance run. Its final integration matrix supersedes earlier sub-report gaps where explicitly resolved; external/live model/device quality and independent review remain separate |
| E-004 | 2026-09-06 | [Codex implementation acceptance](superpowers/reports/codex-implementation-acceptance.md) records automated/mock integration validation | Historical report; live account/client compatibility, entitlement, attribution and Windows gates remain pending in report. Later commits may change catalog details; verify before relying on those details |
| E-005 | 2026-09-07 | PT-001 documentation validation: local Markdown links resolve; task IDs unique; task/log references resolve; targeted diff whitespace clean | Documentation-only changes; product tests not rerun for tracker edits. E-001 remains dated review evidence, not validation of new runtime changes |
| E-006 | 2026-09-07 | PT-019 documentation validation: seven area prefixes, unique feature/task IDs, local links and completed-task log coverage checked; diff whitespace checked | Taxonomy only; no runtime/UI changes or product tests; proposed Orchestrator not implemented |
| E-007 | 2026-09-07 | PT-023 S1 partial evidence: root baseline 157 files / 896 tests, typecheck, build and boundary guard passed; focused scope/read-api/rest/deferred checks 4 files / 71 tests passed; REST wrong-scope reads/cancel/answers return 404 without mutation, malformed object/scope and contradictory scope return 400; profile/session relationship checks pass; WS entrypoint validation still needs real fixture coverage | Local automated evidence only; caller-asserted identity, client adoption, live authentication and later uplift sprints remain open. S2+ working-tree drafts are unaccepted pending ordered review |
| E-008 | 2026-09-07 | PT-023 WS fixture: subprocess `src/server/index.ts` with temporary HOME, two profiles and fake API endpoint; 2 WS tests pass for user/profile session selection, cross-user attach denial, omitted default user, null/array envelopes and invalid scope/cursor | Local subprocess evidence only; caller-asserted identity is not authentication. Client adoption/live platform gates remain open |
| E-009 | 2026-09-07 | PT-024/PT-025 local evidence: targeted Core suite 6 files / 34 tests passed (runtime projection, mounted correlated approval/input, real WS overflow/gap, scope/list routes, atomic pending answers, deferred restart races); broader 8-file focused suite 97 tests passed; root full suite 161 files / 926 tests passed; typecheck, generated protocol check, boundary guard and diff check passed | Local Core criteria complete; caller identity remains unauthenticated local scope, client adoption/live provider/platform/deployment gates remain open; no commit |
| E-010 | 2026-09-08 | PT-026 local evidence: S4 suite 7 files / 46 tests passed (provider-native discovery metadata, opaque scope, bounded aliases, unknown model default, atomic validation, Codex serialization, API-key adapter-unavailable behavior, mounted WS selection); root full suite 162 files / 932 tests passed with one worker; typecheck, generated protocol check and diff check passed | Local Core criteria complete; no live catalog/entitlement/quality/billing claim; API-key effort, client picker/adoption, PT-014/PT-016 and deployment remain open |
| E-011 | 2026-09-08 | PT-027–PT-029 local evidence: S5/S6 suite 12 files / 81 tests and S7 suite 9 files / 35 tests passed; history cursor, lifecycle cleanup, safe diagnostics and existing orchestration contracts exercised; typecheck/generator/boundary checks pass | Local Core criteria complete; physical audio, Windows, live provider, client adoption, auth and deployment remain open |
| E-012 | 2026-09-08 | PT-030 integrated evidence: root Vitest 165 files / 937 tests passed with one worker; `pnpm typecheck`, generator freshness, boundary guard, `git diff --check`, Web typecheck and `GOCACHE=/tmp/base-go-cache go test ./...` pass | Core-only working-tree implementation complete; generated protocol artifacts only on client paths; live provider/account, physical/device, Windows, client adoption, auth and deployment remain open; no commit |

## Completion log

Append one dated row per completed task; corrections retain original date and explain updated evidence. Large tasks may link a detailed report, but must still record their outcome here.

| Completed | Task | Outcome | Validation | Delivery / remaining work |
|---|---|---|---|---|
| 2026-09-07 | PT-018 | Reviewed TUI/Web state; recorded maturity, transport/identity/dashboard/export gaps | E-001/E-002 | Review only; no fixes or release. PT-002–PT-017 remain open |
| 2026-09-07 | PT-001 | Created product/component/feature/task tracker; added required every-task updates to AGENTS.md and CLAUDE.md; linked roadmap; removed stale agent status summary | E-005 | Working-tree documentation, not committed/deployed. PT-017 retains full roadmap reconciliation |
| 2026-09-07 | PT-019 | Defined seven primary areas and stable feature IDs; Core/client impact rules; added new Orchestrator track and separate discovery task | E-006 | Working-tree documentation. PT-020 open; no major UX or implementation decisions made |
| 2026-09-07 | PT-021 | Recorded Core uplift priorities; distinguished client wiring defects from Core foundations and proposed audits | Read FEATURES.md, tracker, src/types.ts, read-api scope resolution and Codex/persistence acceptance notes; documentation-only, no product tests run | Working-tree triage; PT-003–PT-008/PT-013–PT-016/PT-020 remain open; no runtime/API changes |

| 2026-09-07 | PT-022 | Created ordered Core-only spec and sprint plan; mapped PT-023–PT-030; prepared requested Luna high implementation handoff | Read runtime/scope/provider contracts, roadmap/ADRs and prior effort spec; documentation links and task references checked | Working-tree planning; implementation not yet accepted; client/UI/live gates excluded or retained separately |
| 2026-09-07 | PT-023 | Added centralized bounded caller-scope normalization and applied ownership checks to Core REST ID actions, run preparation, read APIs and WS hello/attach/runtime cursors; control attach fails closed across sessions | E-007/E-008; focused 5-file/73-test run, typecheck, build and boundary guard pass | Working-tree Core implementation; PT-004 client adoption and PT-024–PT-030 remain open |
| 2026-09-07 | PT-024 | Integrated bounded detached runtime projections, overflow/future cursor resync, restart interruption, lease checks, root/child projection rules, registry reconstruction and opt-in request correlation through mounted WS handlers | E-009; targeted 6-file/34-test and root 161-file/926-test runs; typecheck, protocol generator, boundary guard and diff check pass | Working-tree local Core complete; cross-session control execution, client adoption and live/platform gates remain open |
| 2026-09-07 | PT-025 | Integrated atomic PendingStore answers, legacy option compatibility, profile/session ownership checks, post-transition ACKs and cancellation/late-park race protection through REST/WS/store seams | E-009; targeted 6-file/34-test and root 161-file/926-test runs; typecheck, protocol generator, boundary guard and diff check pass | Working-tree local Core complete; durable multiprocess transactions, client adoption and live/platform gates remain open |
| 2026-09-08 | PT-026 | Replaced prefix-derived Codex effort claims with provider-native bounded metadata, opaque transport/account scope, unknown/default model behavior, offline alias validation, atomic WS model/effort selection and Codex payload serialization; API-key effort stays unknown pending verified adapter evidence | E-010; targeted 7-file/46-test and root 162-file/932-test runs with one worker; typecheck, generator and diff check pass | Working-tree local Core complete; no live provider or client picker acceptance; PT-014/PT-016 remain open |
| 2026-09-08 | PT-027 | Added stable versioned scope-bound run history cursors, anchor-independent paging, safe diagnostics count, awaited MCP shutdown and barge-in lifecycle fixture | E-011; targeted S5 suite pass | Working-tree local Core complete; multi-process and physical/platform gates remain open |
| 2026-09-08 | PT-028 | Added opt-in prompt assembly source/size diagnostics and verified cancellation, provider failure, telemetry and status distinctions through existing seams | E-011; targeted S6 suite pass | Working-tree local Core complete; no prompt content export or live model-quality claim |
| 2026-09-08 | PT-029 | Recorded executable compatibility coverage for existing spawn, agent, fanout, cancellation, taint and workflow contracts | E-011; targeted S7 suite pass | Working-tree inventory only; persistent teammate/worktree/scheduler/game policy remains PT-020 |
| 2026-09-08 | PT-030 | Completed ordered Core uplift integration and reconciled implementation versus external acceptance gates across scope, runtime recovery, human decisions, provider effort, lifecycle/history, diagnostics/telemetry and orchestration contracts | E-012; full suite, TypeScript/Web/Go checks, generator, boundary and diff checks pass | Working-tree only; no commit/push/deploy; PT-004/PT-014/PT-016 and live/platform/client tasks remain open |

## Entry templates

Task row:

```markdown
| PT-NNN | P2 | Primary feature ID / bounded task scope | in_progress | Observable criteria; affected clients and compatibility impact (or none with reason); linked spec; blockers/owner if relevant |
```

Completion row:

```markdown
| YYYY-MM-DD | PT-NNN | Concrete outcome | Commands/results or evidence IDs; checks not run and why | Verified delivery state; linked remaining task IDs or none |
```

Closeout checklist:

- [ ] Task criteria met; task status accurate; unfinished scope linked separately.
- [ ] Affected component and feature rows updated; roadmap/ADR synchronized when applicable.
- [ ] Evidence dated and scoped; automated/live/release claims distinguished.
- [ ] Completion row appended; last-updated date refreshed.
- [ ] Tracker changes included in task diff; no unrelated edits staged or overwritten.
