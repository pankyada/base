# Town artisans — persistent agents, roster assignment and the staging walk

Status: approved direction 2026-09-25 (user "LGTM"). Tasks: PT-116 (this spec),
PT-117 (Core), PT-118 (Web), PT-119 (inspection chain, planned).
Feature IDs: ORCH-01, ORCH-02, ORCH-04, ORCH-06 primary; CORE-09/10 affected.

## Problem

Town dispatch works, but the journey is hard to follow:

- An agent record exists only after the orchestrator assigns work
  (`TownAssign` creates a task-bound worker), so the town starts empty and the user
  cannot pick who does the work.
- Submission is split between an orchestrator textarea in Operations and a
  collapsed "Post a work order" form in a project card. That form only saves a
  draft, and starting it takes a second action.
- Every figure is the same generic villager that teleports to a house. Its status
  label is hidden by default.

## Decisions

1. **Persistent artisans.** Every Town agent the user sees is a named, persistent
   artisan with a craft. Task-bound agents stay readable for compatibility.
   The orchestrator's `TownAssign` prefers an existing artisan.
2. **Cast.** Indian scholars and divine artisans, one per craft:

   | Key | Name | Craft | Runtime role | Default workspace |
   |---|---|---|---|---|
   | `chanakya` | Chanakya | planner | orchestrator | read_only |
   | `maya-danava` | Maya Danava | designer | worker | shared_checkout |
   | `vishwakarma` | Vishwakarma | builder | worker | shared_checkout |
   | `panini` | Panini | reviewer | worker | read_only |
   | `aryabhata` | Aryabhata | tester | worker | shared_checkout |
   | `sushruta` | Sushruta | debugger | worker | shared_checkout |
   | `gargi` | Gargi Vachaknavi | researcher | worker | read_only |
   | `ganesha` | Ganesha | scribe | worker | shared_checkout |
   | `nandi` | Nandi | guardian (security) | worker | read_only |

   Apprentice builders can be hired on demand: `manu`, `tvashta`, `shilpi`,
   `daivajna`, the traditional sons of Vishwakarma. Maya is left out to avoid a
   name clash with Maya Danava. Narada (the messenger) is visual only and never
   runs work; he is deferred to a later task.
3. **Respect rule.** No figure is ever shown slumped, broken or mocked. Failure is
   shown on the work order (the leaf) and by a red status lamp; the figure stands
   still.
4. **Assignment from the roster bar.** Choosing an artisan and then a project,
   by list, by picking a house on the map, or by dragging the portrait onto a house,
   creates and dispatches one work order in a single action.
5. **Truthful choreography.** Each figure's location comes only from persisted
   task and agent state:

   | Runtime state | Place | Pose / lamp |
   |---|---|---|
   | idle, completed, cancelled | Guild Hall verandah | resting, no lamp / green lamp on the latest leaf |
   | draft, ready, queued_*, dispatching | Staging mandapam | standing with leaf, amber lamp plus reason sign |
   | running with matching session and run linkage | project house workbench | working animation; brighter on real tool activity |
   | waiting_user with an open question | project house gate | leaf raised, pulsing amber lamp, portrait pulses |
   | blocked, failed, interrupted | project gate (blocked) or Guild Hall (failed, interrupted) | still, red lamp |
   | disconnected or unknown | last place | translucent figure, grey lamp |

   Walking between places follows the town road graph. Reduced motion teleports
   the figure instead.
6. **Continuity with the current work.** Each artisan gets a persona prompt plus
   its five most recent work orders (title, state, first 300 characters of the
   evidence). This is appended to the run's system prompt; no new memory store.

## Core contract (PT-117) — additive

- `TownAgent` gains optional `persona`, `craft`, `retired_at`, `last_activity_at`
  and `last_tool`. Existing records remain valid.
- `src/town/artisans.ts` holds the catalog: key, display name, craft, runtime
  role, default workspace mode, epithet and persona prompt.
- Seeding: the first time a user's store is opened, `ensureArtisans(store, profile)`
  creates the nine masters with stable IDs `artisan-<key>`. It never overwrites a
  record.
- `POST /town/agents` `{ persona }` hires a catalog artisan not yet present.
  It returns 409 if the artisan exists and 400 for an unknown key.
- `POST /town/agents/:id/assign` `{ project_id, prompt, title?, workspace_mode?, revision }`
  creates a task bound to the agent, makes it ready and runs the existing
  `dispatch` path. It returns `{ decision, task, reason?, quota }`.
  It is refused for retired or unknown agents.
- **Agent busy gate.** A persistent agent runs at most one task at a time. If it
  already has a task in `dispatching`, `running` or `waiting_user`, the new task
  queues as `queued_concurrency` with `block_reason: 'agent_busy'`. The scheduler
  retries on its normal cadence.
- `POST /town/orchestrate` uses Chanakya when present. Otherwise it falls back to
  the legacy task-bound orchestrator.
- `TownAssign` accepts `agent_id` and prefers it. `TownRead` lists each artisan's
  persona and craft, and the orchestrator prompt tells Chanakya to assign by craft.
- **Activity.** The worker `onToolStart` handler writes `last_activity_at` and
  `last_tool` at most once every 5 s per run, as an `agent.activity` event. The Web
  client also subscribes to `agent.updated` and `agent.activity`.
- Compatibility: additive REST and SSE only; no WS protocol, profile schema or
  TUI change.

## Web contract (PT-118)

- **Roster bar** along the bottom edge: one portrait per artisan showing the
  craft emblem, name, a status ring and a badge for waiting or blocked.
  - Waiting-for-you portraits sort first and pulse.
  - Clicking a portrait flies the camera to that artisan and opens the assign card.
  - A "+" button hires an apprentice.
- **Assign card:**
  - Current task and state, or "Idle at the Guild Hall".
  - Project search list plus **Pick on map**: the next house click chooses the
    project; Escape cancels.
  - Work-order text and a **May change files** toggle that defaults from the craft.
  - **Send** creates and dispatches the order in one call. The result notice
    states started, or queued with the reason.
- **Drag a portrait onto a house** to open the assign card with that project set.
- **Guild Hall** is a new building west of the temple's south approach.
  **Staging mandapam** is a new pillared hall east of it. Both reserve lot
  clearance so project lots and roads route around them.
- **Figures by craft:** attire colour, headgear and a prop. Ganesha has an
  elephant head and Nandi is a bull guardian.
  - A diya (small oil lamp) status light and a CSS status badge are always
    visible, independent of the label toggle.
- **Movement** along the road graph at walking speed with a leg and arm swing.
  Reduced motion teleports.
- The existing Operations orchestrator form and the project-card work-order form
  remain as secondary paths. The project-card form gains "Send now" beside
  "Save draft".

## Acceptance

Automated:

- Core:
  - catalog seeding is idempotent;
  - hire and duplicate rejection;
  - assign-and-dispatch returns started, queued for quota, and queued as
    `agent_busy` when a second task is sent to a busy artisan;
  - the orchestrator uses Chanakya;
  - `TownAssign` with `agent_id`;
  - activity throttling;
  - persona and recent-work prompt contents.
- Web:
  - the place and pose projection for every state in the table;
  - the road-graph route connects the Guild Hall, staging and any project entrance;
  - lots never overlap the new sites;
  - roster ordering puts waiting-for-you first.
- Root and Web suites, both typechecks and the diff check pass.

Live (local): in the isolated 7341 runtime, assign Vishwakarma from the roster to
a project in the browser. Observe him leave the Guild Hall and reach staging;
then either start work at the house, or queue with a visible reason.
Screenshot evidence goes in the report.

User acceptance of the look and feel is tracked separately and is not implied by
local evidence. No release or deployment is implied.

## Out of scope

- Narada messenger animation.
- Inspection hand-off (reviewer or tester automatically receiving a builder's
  completed leaf) and verified completion: PT-119.
- Retiring or renaming artisans in the UI.
- Isolated worktrees.
- Automatic retry.
