# Orchestrator town — exploratory discovery

Date: 2026-09-13. Task: PT-020. Status: discovery in progress; user-confirmed choices below, remaining proposals exploratory; **not an implementation specification**.

Primary feature: ORCH-06; related ORCH-01–ORCH-08 and Core contract assessment CORE-09. Proposed client: Orchestrator, placement unresolved. No protocol, API, schema or prompt changes; no existing client changes required by this document.

## User direction

An Age-of-Empires-like landscape represents projects as buildings under construction or offices where agents work. Each project has a bulletin/kanban board showing its work. A central town-centre board accepts user information and instructions for an orchestrator agent that can inspect work across projects and communicate with their agents. Project agents hand back status and questions.

The discovery root is `~/Desktop/development`, including projects and subprojects. The user's initial proximity idea places active projects centrally and projects with older commits further away. The navigable 3D design direction is approved below; detailed layout and implementation remain unapproved.

## User-confirmed choices — 2026-09-13

- **Medieval visual look and navigable simulated 3D town.** A single fixed isometric view is rejected. Approved camera and viewing interactions are recorded below; rendering technology and detailed implementation remain open.
- **Orchestrator may assign and start work when sufficient provider remaining subscription/API quota is available.** The provider quota gate is confirmed below; sufficient-capacity thresholds, reservation and limits remain unresolved. This product authority preference does not approve building the proposed experience or establish workspace/merge policy.

- **Provider’s remaining subscription or API quota is the dispatch gate.** This is not a manually assigned town token allowance. Quota units depend on the provider; internal spend estimates cannot substitute for actual remaining provider/account quota.

## Approved 3D interaction direction — 2026-09-13

User requested “simulated 3d map... not just 1 isometric view” and accepted the proposed navigable medieval town (“looks good”). Design approval covers:

- Orbit, pan, tilt and zoom around the town.
- Town-level and building-level viewing.
- Camera-facing labels and readable board side panels.
- Return to town centre and saved viewpoints.
- Stable building positions during interaction.

Roof-off workshop interiors remain an optional exploration, not required approved scope. Detailed layout, rendering technology, performance/accessibility treatment and implementation plan still need definition. This is design approval, not an explicit request to implement code.

## Proposed interaction

The town is a living workshop: zoom out to see where attention goes; zoom in to see why work moved or stopped.

- **Town hall:** persistent instruction composer plus “Needs you,” “In motion,” and “Delivered.” An outcome such as “Get these two projects talking” can lead to linked work proposals across buildings.
- **Project building:** distinctive silhouette, local board, current agents, blockers, next action and evidence. Clicking opens a useful work surface. A mature office can gain a scaffolded extension for its current milestone.
- **Workers:** visible agents reflect actual states such as implementing, testing, waiting or needing a decision. Animation follows runtime evidence.
- **Districts:** related projects cluster; subprojects may be wings or nearby workshops. Folder nesting seeds discovery, but users must be able to correct project boundaries.
- **Direct interaction:** select an individual agent to inspect, chat or steer, with ownership and current work context visible. The central orchestrator does not remove this path.

## Useful creative details

1. **Question couriers:** a blocked agent posts a concise decision card at town hall carrying context, suggested answer and consequences. The user's answer returns to its originating work item.
2. **Dependency roads:** selecting a project reveals its dependencies and highlights downstream work waiting on it. Hide connections otherwise to keep the town readable.
3. **Town chronicle:** a time scrubber reveals completed milestones, changed plans, handoffs and unanswered questions. Events link to evidence.

## Truthful world semantics

Last commit is an activity signal, not a complete account of importance or current work. An agent can work for hours without committing; an old stable dependency may still be critical. Explore proximity based on active runs, outstanding questions, user priority and recent verified work, with pinning. Reposition at deliberate refresh points so spatial memory survives. No ranking formula adopted.

Scaffolding should represent a defined milestone. Avoid fabricated whole-project completion percentages. “3 of 5 acceptance checks verified” is meaningful only when checks exist. Preserve distinct states for code written, tests passed, deployed and user accepted.

The orchestrator needs a durable, inspectable view of known state, including freshness and unknown/disconnected states. Its prose summary alone cannot establish that every project is current or complete.

## Bounded first experience — proposal

Discover projects under the root; let the user confirm three buildings; show Git activity and current work state; open one local board; send one instruction through town hall; watch one question and answer complete the round trip. This journey is a candidate for acceptance design, not an approved build scope.

## Missing-Core assessment — preliminary source-backed inventory

Current source review identifies reusable foundations and gaps for this proposed experience. These findings are discovery evidence, not approved implementation requirements.

| Capability | Existing foundation | Gap for the town experience |
|---|---|---|
| Project identity and discovery | Project metadata and session tagging: `src/projects/types.ts:1–7`, `src/server/project-handlers.ts:6–22`; persisted session working directory: `src/session/types.ts:21–42` | Project repository/path identity, root discovery, nested project boundaries and commit/activity collection |
| Persistent boards and shared state | Bulletin board is connection/session memory, capped at 200: `src/agents/bulletin.ts:20–42`; created/reset in `src/server/index.ts:442,527` | Durable project tasks, dependencies, ownership and board history; current bulletin is not persistent kanban or town state |
| Teams and execution | Profile catalog and delegated frames: `src/agents/catalog.ts:4–29`, `src/agents/frames.ts:24–40`; lifecycle events and bounded pool: `src/types.ts:331–338`, `src/agents/pool.ts:18–76` | Persistent teammate identity and project/task assignment; child working directory currently comes from sub-profile rather than parent session (`src/tools/builtin/delegate.ts:68–117`), requiring explicit workspace semantics |
| Collaboration and questions | Same-live-session recipient routing: `src/server/board-handler.ts:17–50`, `src/server/index.ts:1527–1546` | Durable cross-session/project message routing, acknowledgement/retry, correlation of questions to original work |
| Scheduling and recovery | Durable trigger runs/caps: `src/triggers/manager.ts:88–160`; atomic/revision storage foundations: `src/session/store.ts:85–109`, `src/runs/store.ts:73–95` | Dependency-aware task scheduling and task/message recovery; interrupted work must remain visibly interrupted rather than presumed complete |
| Provider quota visibility | Current Base RunBudget covers internal USD/tool/wall-time limits and child USD reservation; Codex classifies quota errors, but source review found no preflight remaining-quota API | Provider/account remaining-quota visibility, source freshness, reset time/window and unknown handling. API-equivalent usage estimates do not establish billed usage or subscription quota. Holding automatic start when quota is unknown is a proposal, not an approved policy |
| World state | Existing lifecycle and storage foundations | Aggregate project/team/task snapshot with resumable event cursor and freshness; explicit shared-workspace collision policy |

Core should provide reusable project, task, message, execution and recovery contracts. The application/orchestrator should own attention-ranking policy; the visual client should own scenery and geometry. Exact boundaries need specification. See [current tracker](../../PRODUCT_STATE.md) PT-020/PT-029 and [feature ownership](../../FEATURES.md).

## Decisions still open

- How is real provider/account quota obtained, refreshed and reserved across concurrent work? What establishes sufficient quota? How should unknown quota behave? Holding automatic start when unknown remains proposed.
- Does each project have a persistent steward, or are agents recruited only for active work?
- Navigable 3D/camera direction is approved; detailed layout, rendering technology, accessibility and movement/repositioning outside active interaction remain open. Roof-off interiors remain optional.
- Project identity, nested repositories, shared-checkout/worktree policy, conflict ownership and cross-project context boundaries need definition.
- Placement in Studio, a new route, or another client remains open.

## Checkpoint evidence

Read current PRODUCT_STATE, relevant ROADMAP and ORCH feature taxonomy; incorporated source-backed Core review supplied by the parallel contract assessment. Documentation only; no product tests run. No implementation, ADR decision, commit, release or deployment. PT-020 remains in progress; this document records brainstorming rather than feature completion.

2026-09-13 follow-up checkpoint: recorded user confirmation of medieval visuals and assignment/start authority given sufficient token budget. Exact layout, teammate lifetime, workspace/merge policy and budget mechanics remain open. No build approval inferred; documentation diff check only, no product tests or ADR decision.

2026-09-13 quota checkpoint: user selected the provider’s remaining subscription or API quota as the dispatch gate. Quota data source, freshness/reset/window handling, sufficient-capacity threshold and reservation remain open. Unknown-quota hold is proposed only.

2026-09-13 3D design checkpoint: recorded approved navigable simulated 3D town, camera/viewing interactions, readable panels and stable buildings during interaction; single fixed isometric view rejected. Optional roof-off interiors are not required scope. Implementation and remaining workspace/quota policies remain open; documentation-only diff check, no product tests or commit.
