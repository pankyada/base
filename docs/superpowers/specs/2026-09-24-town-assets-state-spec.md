# Town assets and truthful state — acceptance specification

Date: 2026-09-24. Task: PT-104. Status: approved for implementation.

Primary feature: ORCH-06. Affected client: Web `/town`. This implements the
approved PT-103 direction: richer Tamil/Kaveri property and countryside assets,
plus Town task/agent activity and *surveyed* Git state. Roadmap progress,
testing/acceptance, release, deployment, and repository maturity are excluded.

## Contract and prerequisite

The existing Town REST/SSE snapshot is the sole evidence source. This slice adds
no Core API, WS, schema, prompt, quota, dispatch, persistence, or TUI contract.
`PT-098` is a prerequisite: its scope/generation/abort and cursor guards must
land first (or in the same atomic Web change) and prove an older or other-scope
snapshot/error cannot replace the selected scope's state. Until that is true,
Town must not claim a live/current state after a scope change.

`GET /town/snapshot`'s `generated_at`, `discovery`, project `scanned_at`, and
project `git` are evidence, not a fresh scan. A project plaque says **As
surveyed** and shows its scan timestamp, Git head (when present), dirty-at-scan
state, and last commit timestamp. Discovery shows `complete`, `partial`, or
`error`, its timestamp, project/skipped/error counts, and non-secret warnings.
An unavailable snapshot says **Town data unavailable**; it preserves no
actionable old state. A partial/error/old survey says so with its exact time and
omissions; it never claims coverage, live workers, Git freshness, or a project
health score.

`dirty` means local changes at survey time. Commit age controls only the existing
placement band. File-count tiers remain extent-only, derived only from a complete
tracked-file measurement; unknown/partial/error size uses the neutral workshop.

## State projection

Derive one projection from the current accepted snapshot. Use icon/shape and
short accessible text; color is supplementary. An agent may have a working pose
only when the current task is `running`, assigned to that agent, and non-empty
task and agent session/run IDs match exactly. Any missing project/task/link,
contradictory state, transport loss, or stale replacement risk produces
**Unknown activity** / a still person, never a work loop.

| Current evidence | World/card presentation | Must not imply |
|---|---|---|
| Fully linked `running` task | Occupied tool station, named worker, work loop; Work now count | Progress, success, or project completion |
| `waiting_user` plus open durable user question | Question pennant, still raised-hand worker; exact question/action | That every past worker needs an answer |
| `ready`, `dispatching`, or `queued_*` | Waiting bench or queue sign; exact queue/preparing reason | Executing work; `dispatching` is preparation only |
| Current `blocked` task with an unresolved durable reason | Attention item with task, reason and timestamp | An acknowledgement, retry, or permission not recorded |
| `failed`, `interrupted`, `cancelled`, `completed`, and blocked tasks no longer current/actionable | History only: quiet archive shelf and dated count in the card | Current attention, active worker, project completion, testing, acceptance, or deployment |
| Agent `working` claim without the exact link | Still unknown person at safe home/Hall | Running work |
| No task/project/home link | Still unknown person at Hall; open card exposes missing evidence | A current project assignment |

Terminal history must never create the map's attention marker. Only an open user
question, a currently actionable blocked task, or a current answer receipt that
cannot resume can do so. Completed/cancelled/failed/interrupted rows stay
inspectable in History. Do not invent an acknowledgement field; use existing
durable message/read/answer data only.

The selected project card has three explicit sections: **Work now** (linked
running, queue, waiting, and current blockers), **Repository snapshot**
(survey/Git/size provenance), and **History** (terminal tasks and old receipts).
Counts identify their section. Existing task detail, retry/cancel, question,
quota, and dispatch controls retain their present authority and disabled/error
behavior.

## Assets and placement

Add original procedural, project-ID-seeded variants inside each existing lot:
workshop awnings, benches/tool racks, stacked materials, veranda/drying-rack
furnishings, hedges, and entrance signs. Add state-bearing frontage only from
the projection above: tool station, waiting bench, question pennant, queue sign,
or archive shelf. They are readable at an office close-up and do not add people.

Add deterministic reserved scenery: palmyra groves, crop plots, irrigation
channels/pond edges, and reduced-scale clouds. Keep every asset out of project
click/label/entrance targets, road and temple clearances, historical-reference
sites, person controls, and each other as required by the existing layout
contract. Roads remain location-only. No fictional workers, construction,
wealth/progress scale, generated images, or new historical claims.

For the same project IDs, complete size records, pinned IDs, active IDs, and
layout revision, lots, roads, scenery, asset variants, and frontage placement
are byte-for-byte deterministic regardless of input ordering. Ordinary task,
agent, quota, message, cursor, and mode updates do not relayout, move the
camera, change a saved view, or reset selection. Only existing successful survey
or pin relayout triggers apply.

## Motion, resources, and accessibility

`prefers-reduced-motion: reduce` freezes worker/preparation loops, cloud/bird
motion, and lamp flicker while retaining all state, controls, and labels. Keep
the existing bounded lights/clouds/birds and shared Three.js resource ownership;
new asset geometry/materials must be shared or finite, released on replacement,
and disposed once on scene unmount. Day/night, keyboard, touch, rails, card,
focus return, and narrow layout keep their existing behavior and readable labels.

## Acceptance gates

1. **PT-098 first:** delayed old-scope, old-generation success, and failure
   fixtures cannot overwrite the new scope; cursor/state reset and coalescing
   pass. No state test may rely on this implementation before it passes.
2. **Pure model tests:** cover every table row; specifically terminal history
   cannot yield attention, stale/missing linkage is unknown/still, one current
   blocked item is attention, and exact linked running is the only work loop.
   Cover surveyed Git/size wording and complete/partial/error/unavailable data.
3. **Asset/layout tests:** same fixture and reversed order produce identical
   frontage/scenery; 62 mixed-size projects retain required lot/road/temple,
   click-target, and scenery clearances; normal snapshot changes preserve layout
   stamp/camera inputs. Assert bounded shared geometry/material counts and
   replacement/unmount disposal.
4. **Web checks:** focused Town tests, full Web test suite, `pnpm --dir web
   typecheck`, and production build pass. Run the repository-required root suite
   before a commit.
5. **Browser acceptance:** desktop and narrow view exercise overview and office
   close-up; Day/Night; mouse/keyboard/touch select/close/Escape; linked running,
   queued, waiting-question, current blocker, terminal history, missing link,
   unavailable transport, partial/old survey, and reduced motion. Verify no
   console/page errors and no historical terminal marker. Use fixtures or an
   isolated runtime; this does not establish live provider, project, release, or
   user landscape acceptance.

PT-053 landscape acceptance remains open. No new ADR is required: ADR-85's
authoritative quota gate and all existing Town authority boundaries are unchanged.
