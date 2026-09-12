# Primary product features

Updated: 2026-09-12. Seven primary areas agreed from product direction; feature breakdown below is an initial scope proposal, not a claim of implementation or final UX approval.

Use [PRODUCT_STATE.md](PRODUCT_STATE.md) for current state, evidence and tasks; [ROADMAP.md](ROADMAP.md) for existing numbered commitments. Feature IDs below classify work without replacing roadmap IDs or `PT-NNN` task IDs. Preserve IDs when names change.

## Ownership rules

- **Core owns shared behavior and contracts.** Clients expose them through task-appropriate interaction. Provider authentication, model capabilities, prompts, safety, persistence and orchestration execution must not become separate implementations per client.
- Each task identifies one primary area/feature and all affected clients. A Core change records API/WS/schema/prompt compatibility, required client updates, and checks or explicit acceptance gaps for affected clients. Use `none` with a reason where no client change is required.
- Cross-client features keep one Core contract plus client-specific presentation work. Shared Web components may serve Chat, Analyst, Ops, Home and Orchestrator; these are product areas, not a requirement for five separate applications.
- Primary area list: `CORE`, `TUI`, `CHAT`, `ANALYST`, `OPS`, `HOME`, `ORCH`.
- Scope markers: **Existing** = implementation foundation identified in current tracker; **Partial** = known completion gaps; **Proposed** = product direction requiring design/acceptance definition. These markers do not replace the detailed acceptance state in the tracker.

## 1. Core — shared harness platform

Active Core uplift: [spec](superpowers/specs/2026-09-07-core-uplift-spec.md), [ordered plan](superpowers/plans/2026-09-07-core-uplift-plan.md), PT-023–PT-030. Implementation in progress does not change the evidence baselines below until validated.

Purpose: one runtime and set of contracts every client can understand and depend on.

| ID | Primary feature | Scope | Baseline |
|---|---|---|---|
| CORE-01 | Identity, credentials and trust | User/profile/project scope, provider authentication, credential lifecycle, origin policy, existing API-key protection and approval boundaries | Existing; client scope propagation partial. Product account login/RBAC is not an approved implementation scope |
| CORE-02 | Server and connection lifecycle | Startup/discovery, health, configuration, multi-profile hosting, connect/reconnect, shutdown and recovery | Per-session CWD now travels on hello and survives reconnect/resume (PT-047); other acceptance gaps remain |
| CORE-03 | Client protocols and APIs | Versioned WebSocket/REST/SSE contracts, capabilities, events, snapshots, acknowledgments, errors, cancellation and compatibility | Additive optional working-directory WS fields are implemented and mirrored in generated Web/Studio types (PT-047); live-socket controller leases now survive idle time and release on socket close, with optional expiry metadata for non-expiring leases (PT-049); no protocol bump; other client recovery gaps remain |
| CORE-04 | Providers, models and effort | Provider adapters, catalogs, availability, capability discovery, model switching, reasoning effort and billing attribution | Core effort backend implemented and fixture-validated (PT-026); client picker and live provider acceptance remain open (PT-016/PT-014) |
| CORE-05 | Profiles and core prompts | Profile configuration, base/system prompts, persona/task overlays, model/tool policies, context construction and change visibility | Existing profile/prompt foundations; management UX not implied |
| CORE-06 | Execution, tools and extensions | Agent loop, tool registry, MCP, skills, hooks, sandbox/executor integrations | Existing |
| CORE-07 | Sessions, projects and memory | Durable history, project association, context projection, scoped memory, temporal beliefs and conflicts | Session working directory is validated/persisted/restored locally (PT-047); broader client consistency gaps remain |
| CORE-08 | Safety and human control | ACLs, approval modes, provenance, budgets, deferred asks, rehearsal, cancellation, undo and audit | Existing; client operational handling partial |
| CORE-09 | Multi-agent execution | Delegation, agent-as-tool, profiles, concurrent runs, handoffs and collaboration contracts for agents sharing or separating workspaces | Existing delegation foundation; new Orchestrator requirements proposed |
| CORE-10 | Background work and channels | Schedules, watch/poll, webhooks, durable runs, inbound/outbound channels and voice interfaces | Existing; multi-profile/audio acceptance partial |
| CORE-11 | Evidence, artifacts and observability | Usage/cost, telemetry, missions/receipts, artifact lineage/refresh, replay, evaluations and correction gates | Existing foundations; live acceptance gaps |
| CORE-12 | Installation and compatibility | CLI, init/doctor, platform packaging, migration/version evidence, documentation and extension boundaries | Existing; platform/delivery acceptance partial |

Authentication belongs here conceptually. Current repository instruction excludes adding product authentication/authorization; a future account/RBAC project needs explicit scope revision. Provider OAuth and existing transport safeguards remain within current scope.

## 2. TUI — terminal developer workspace

| ID | Primary feature | Scope | Baseline |
|---|---|---|---|
| TUI-01 | Conversation and execution | Streaming transcript, reasoning/tool visibility, queueing, cancel, readable errors | Existing; delivery failures open |
| TUI-02 | Coding workspace | File/context attachments, local shell, diffs, project/git/task context | Interactive execution and project context use the TUI launch CWD (PT-047); installed-binary acceptance PT-013 |
| TUI-03 | Human decisions | Approvals, input requests, deferred inbox, plans, rehearsal and undo | Existing |
| TUI-04 | Session and runtime controls | Sessions/projects, profiles, provider/model/effort selection, memory and skills | Session CWD survives profile switch and is restored on resume (PT-047); effort controls planned and installed acceptance PT-013 |
| TUI-05 | Terminal interaction and health | Keyboard palette, focus/navigation, themes/density, cost/context, reconnect and setup handoff | Existing; recovery/platform acceptance partial |

## 3. Web Chat — coding and general agentic work

| ID | Primary feature | Scope | Baseline |
|---|---|---|---|
| CHAT-01 | Reliable agent conversation | Streaming, input/context attachments, interruption, unsent/error recovery and transcript history | Partial |
| CHAT-02 | Coding and task workspace | Tool timeline, file/diff/terminal output, plans/todos, artifacts and project context | Existing foundation; complete coding journey needs acceptance |
| CHAT-03 | Session and agent configuration | Project/session navigation, profile/model/effort controls, memory/skills discovery | Partial; effort planned |
| CHAT-04 | Review and control | Approvals, questions, rehearsal, undo, evidence and outcome review | Existing foundation; reliability gaps |
| CHAT-05 | Workspace continuity | Reload/reconnect, identity consistency, persistent preferences, export and responsive/accessibility behavior | Partial |

## 4. Analyst Workbench — data to verified output

| ID | Primary feature | Scope | Baseline |
|---|---|---|---|
| ANALYST-01 | Data intake and understanding | Upload/select datasets, schema/preview/profiling, source context and provenance | Existing foundation |
| ANALYST-02 | Analysis execution | Conversational analysis, Python/code cells, execution results/files, package/executor constraints | Existing foundation |
| ANALYST-03 | Visual exploration | Tables, charts, filtering/sorting, null/baseline honesty and generated interactive surfaces | Existing foundation |
| ANALYST-04 | Research canvas | Pin/organize artifacts, source/code lineage, recipes, refresh and last-good stale state | Partial |
| ANALYST-05 | Reproducibility and delivery | Evidence, rerun/review, durable analysis context, faithful CSV/image/PDF/session exports | Partial |

## 5. Operator `/ops` — runtime administration

| ID | Primary feature | Scope | Baseline |
|---|---|---|---|
| OPS-01 | Fleet/run supervision | Servers/profiles/runs, lifecycle, blocked/waiting/failed states, cancellation and recovery | Partial; fleet breadth proposed |
| OPS-02 | Human-action centre | Durable approval queue, deferred asks, expiration, acknowledgments, undo and escalations | Partial |
| OPS-03 | Cost, performance and budgets | Spend/model mix, tool outcomes/latency, workflow effectiveness, budget limits and alerts | Partial |
| OPS-04 | Audit and evidence | Provenance/taint review, action history, missions/receipts, replay/evaluation entry points | Existing foundation; integrated operator workflow partial |
| OPS-05 | Configuration and service health | Profiles/providers, skills, channels, triggers, connection/health diagnostics and configuration visibility | Partial; administration expansion proposed |

Ops supervises runtime health and policy across work. It is not automatically a user/account administration system. Task-level team coordination belongs to Orchestrator.

## 6. Assistant `/home` — personal context and ongoing help

| ID | Primary feature | Scope | Baseline |
|---|---|---|---|
| HOME-01 | Personal brief | Needs-you, recent/overnight outcomes, upcoming work, spend and attention summaries | Partial |
| HOME-02 | Personal memory | Preferences, entities, temporal beliefs, sources/conflicts and reviewed corrections | Existing foundation; presentation partial |
| HOME-03 | Routines and proactive work | Reminders, schedules, watch/poll, trigger history, meaningful notifications and channel delivery | Core foundations; Home experience partial |
| HOME-04 | Personal conversations and decisions | Direct assistant interaction, approvals/questions, follow-ups and context continuity | Proposed integrated Home journey; shared chat/decision foundations exist |
| HOME-05 | Personal setup and connections | Persona/profile, skills, connected channels and voice where available | Partial foundations; integrated setup proposed |

## 7. Multi Agent Orchestrator — collaborative agent workspace

**New product area, not started as the requested experience.** Existing Core delegation, live sessions, project records, missions and Studio features are candidates for reuse; they do not establish that this product already exists.

User direction: multiple Base harness agents working on different tasks, in the same or different projects, interacting with each other; direct user interaction with individual agents; optional orchestrator agent; game-like visual representation, potentially SimCity-inspired. Detailed concept will be brainstormed separately under PT-020.

| ID | Primary feature | Proposed capability |
|---|---|---|
| ORCH-01 | Projects and agent teams | Create/select projects, compose agents with profiles/roles/models, assign agents to shared or separate project work |
| ORCH-02 | Task orchestration | Create/assign work, dependencies, parallel tasks, milestones, handoffs and outcome review |
| ORCH-03 | Agent collaboration | Inspectable agent-to-agent messages, shared artifacts/context and requests for help; explicit scope for what each agent may read/change |
| ORCH-04 | Direct user interaction | Select any agent to chat, inspect current task/tool/evidence, steer work, answer questions or stop it; preserve task ownership/context |
| ORCH-05 | Optional orchestrator agent | Delegate planning, assignment, progress checks and escalation to a supervising agent; human-led orchestration remains possible |
| ORCH-06 | Game-like live world | Map real agents/projects/tasks to a visual world; show work, movement/handoffs, collaboration, waiting, failures and completion from actual runtime events |
| ORCH-07 | Shared-project coordination | Make branch/worktree/shared-directory policy explicit; detect conflicting work and provide review/merge/handoff decisions using Core contracts |
| ORCH-08 | Team control and evidence | Team/task budgets, approval routing, intervention, receipts, timeline/replay and actual versus estimated progress |

### Brainstorm questions — not decisions

- World metaphor: city, workshop, campus, game board, or something else? 2D/isometric/3D remains open.
- Meaning of an agent: persistent teammate, profile instance, or task-bound worker? How long does memory/identity live?
- Same-project work: isolated worktrees by default, coordinated shared checkout, or user choice? Who resolves conflicts?
- Collaboration: direct messages, task handoffs, shared rooms, orchestrator routing, or combinations? How are messages/context bounded?
- Control: which actions can the orchestrator take automatically; which need user approval? How does user steering interrupt or override it?
- Truthful animation: which runtime events justify each visual state? How are disconnected/unknown states represented without pretending progress?
- Product placement: extend Studio, add a route, or another client? No choice made yet; first inventory reusable code and validate the desired journey.

No visual metaphor, major layout, route, new dependency, multi-host topology, or implementation plan approved by this taxonomy. Confirm major UX decisions before building.

## Cross-area task examples

| Change | Primary feature | Affected clients / areas |
|---|---|---|
| Model capability/effort contract | CORE-04 | TUI-04, CHAT-03, Analyst agent controls, Orchestrator agent setup |
| WS reconnect/acknowledgment contract | CORE-03 | TUI and every connected Web area |
| Core system prompt change | CORE-05 | Every profile/client using that prompt; record expected behavior and evaluation coverage |
| Chart export correction | ANALYST-05 | Other areas embedding/exporting the shared widget kit |
| Agent-to-agent handoff | CORE-09 | ORCH-03/ORCH-05; Ops visibility and audit as affected consumers |

New tasks should cite these feature IDs alongside existing roadmap IDs where applicable. A taxonomy entry is not an implementation task; proposed capabilities become bounded tasks after discovery and scope agreement.
