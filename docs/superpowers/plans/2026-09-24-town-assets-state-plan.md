# Town assets and project-state implementation plan

Date: 2026-09-24. PT-103 approved; PT-104 implemented and locally accepted. Evidence: [PRODUCT_STATE.md](../../PRODUCT_STATE.md#evidence-register), E-047. PT-053 landscape/user acceptance, release, and deployment remain separate.

Primary feature ORCH-06; affected client Web `/town`. Proposed first slice is presentation-only: no Core/API/WS/SSE/schema/prompt change, no required TUI changes. Existing procedural Three.js asset library, full-canvas rail/card design, Chola/Kaveri-inspired landscape and state contracts apply. No new UI framework, image generation, or historical factual claims needed.

## Observed problem

Source already provides houses, temple, palms/broadleaf trees, cattle/goats/chickens, pots, baskets, grain jars, wells, carts and low walls. Adding more copies alone will not fix visual repetition. Coordinator's 2026-09-24 live browser inspection found sparse flat green ground, tiny repeated houses, thin roads and oversized clouds around the detailed temple.

The displayed inventory says **Partial Survey**, 62 repositories, 6 skipped, entry limit reached, surveyed 13 September. Base's card contains 11 work orders, older terminal retries and waiting residents; its Git snapshot also dates from that survey. These observations are current UI evidence of stored data, not a fresh scan or proof of live workers. Repository size is extent, never maturity or completion.

## Proposed direction

Keep approved full-canvas navigation and Tamil settlement. Make the town richer through readable property silhouettes and purposeful grounds:

- Add workshop awnings, timber workbenches/tool racks, stacked materials, verandah furnishings, drying racks, boundary hedges and entrance signboards. Seed variation by project ID within existing lot bounds.
- Add clustered palmyra groves, small irrigation channels/pond edges and crop plots in reserved scenery areas. Preserve roads, temple approach and building clearances; reduce distracting cloud scale.
- Add state-bearing frontage objects: workbench/tool station, waiting bench, question pennant, queue sign and archived-work shelf. Keep all visible people mapped to real Town agents; scenery may contain animals, never fictional workers.
- Retain building size tiers from complete tracked-file measurements. Keep identity visible for inactive projects too; no bigger/wealthier building as an invented success score.

## Truthful state mapping

| Evidence | Proposed visual / wording | Limits |
|---|---|---|
| Running task plus matching agent/task/session/run | Occupied work station; existing working person/animation; Running count | Persisted running alone cannot animate work; connection loss clearly marks last-known state |
| Open durable question or waiting-user task | Question pennant and Waiting for you count | Exact task/question opens existing card; do not imply every old resident needs a new answer |
| Ready/dispatching or queued task | Waiting bench / queue sign, with quota, dependency, workspace or concurrency reason | Dispatching is preparation, not executing |
| Failed/interrupted/blocked tasks | Explicit attention item with task state and time | Historical terminal retries stay history; distinguish unresolved blocking state from old failures without inventing acknowledgment semantics |
| Completed/cancelled tasks | Quiet archived-work shelf and history counts in card | Completed task never means project finished, tested, accepted or deployed |
| Survey Git dirty/head/commit age | Small repository plaque labelled As surveyed, timestamp and Git details | Dirty means local changes at scan time; old commit does not imply abandonment |
| Partial/error/old survey or disconnected transport | Persistent compact freshness/completeness chip; stale/unknown state treatment | Show exact dates and omissions; no guessed scan coverage or live claim |
| Complete tracked-file measurement | Existing house/compound tier with explicit extent label | Unknown/partial size remains neutral; never infer progress |

Use symbol/shape plus short labels, not color alone. The selected card separates **Work now**, **Repository snapshot** and **History**, with real counts and provenance. No automatic layout movement on ordinary state updates. Keep task details, quota gate and dispatch behavior unchanged.

## Approval decision

Approved by user: richer regional assets plus **Town task/agent activity and surveyed Git state** above. “State of the project” means evidence-backed Town operations and surveyed repository facts, not roadmap progress, acceptance or deployment; those require separate evidence sources. Do not scrape arbitrary README/checklists or infer percentages.

## Sequence and acceptance

1. User approved visual direction and state meaning; PT-103 is complete.
2. Acceptance specification completed at [2026-09-24-town-assets-state-spec.md](../specs/2026-09-24-town-assets-state-spec.md); PT-098 snapshot fencing was implemented within the atomic Web change.
3. PT-104 implemented with deterministic state projection/assets, tests-first validation and preserved unrelated work.
4. E-047 records focused/full Web checks, typecheck, production build, all five isolated browser fixtures, resource/reduced-motion coverage, and coordinator CUA overview/close-up/day/night/card/freshness/narrow checks. Broader PT-053 landscape/user acceptance remains explicit; no release/deployment implied.

## Source pointers

- `src/town/types.ts`: actual project, task, agent, discovery and capacity fields.
- `web/app/town/town-model.ts`: size tiers, stable layout, project identity and district age.
- `web/app/town/town-world-model.ts`: linked worker presence and communication projection.
- `web/app/town/town-assets.ts`, `town-scene.tsx`: procedural asset ownership, placement and rendering.
- `docs/superpowers/specs/2026-09-13-town-landscape-spec.md`: size/agent truth, clearances and stable world.
- `docs/superpowers/specs/2026-09-13-town-canvas-temple-spec.md`: approved full-canvas controls and identity.
- `docs/ADR.md`, ADR-85: authoritative quota gate remains unchanged.
