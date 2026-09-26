# Town artisans — local evidence (PT-116 / PT-117 / PT-118)

Date: 2026-09-25. Delivery state: working tree (not committed, released or deployed).
Spec: [2026-09-25-town-artisans-spec.md](../specs/2026-09-25-town-artisans-spec.md). ADR-91.

## Automated

| Gate | Result |
|---|---|
| Root `pnpm typecheck` | pass |
| Root `pnpm test` | 210 files passed / 1 skipped; 1387 tests passed / 3 skipped (includes the new `tests/town-artisans.test.ts`, 8 tests) |
| Web `vitest run` | 42 files / 232 tests passed (includes the new `web/tests/town-artisans.test.ts`, 14 tests) |
| Web `tsc --noEmit` | pass, apart from a stale, pre-existing `.next/types/app/temple-check` reference that is unrelated to this change |
| `git diff --check` | pass |

Core tests cover:
- idempotent seeding that never overwrites an existing record;
- hiring an apprentice, with duplicate and unknown rejection;
- assign-and-dispatch returning started, queued for quota, and queued as `agent_busy`;
- the default read-only mode for reviewers, and refusal of retired or unknown artisans;
- the town charge routed to Chanakya;
- the busy gate ignoring legacy task-bound agents;
- the persona prompt carrying only the five most recent finished orders, truncated;
- `TownAssign` by `agent_id` through the real runtime, with throttled `agent.activity` recorded.

Web tests cover:
- every row of the place/pose/lamp table, including run-linkage truth, open-question
  truth, the queued count and the disconnected ghost state;
- roster ordering;
- the civic sites staying clear of all lots;
- slot placement;
- a road-graph walk from the Guild Hall past the staging approach to a project
  workbench;
- figure assets for all 13 catalog artisans (Ganesha and Nandi forms), each with its
  lamp, order leaf and limbs;
- the Guild Hall and mandapam fitting their reserved footprints.

## Local runtime and browser

Isolated setup:
- **Core:** source Core on port 7351 with `HARNESS_STATE_DIR` in the session scratchpad,
  a copy of the Town `web-user` store (62 projects), and a dummy API key. The profile's
  quota is `unsupported`, so no provider request could be made.
- **Web:** an isolated `next dev` on port 3011 with its own `NEXT_DIST_DIR`.
- Neither the installed 7341 listener nor the user's port 3000 was touched.

Observed in headless Chromium (swiftshader) screenshots:

1. The Core seeded nine masters beside seven legacy task-bound agents.
2. The roster shows all nine as idle; the overview renders the town. The Guild Hall
   sits west of the south approach road and the staging mandapam east of it, with
   the artisans on the Guild Hall verandah.
3. Portrait click: the camera flies to the artisan and the assign card opens with
   project suggestions, **Pick on map** (banner plus crosshair; Esc cancels) and the
   craft-default "May change files" setting.
4. Assigning Vishwakarma, then Gargi, to `base`:
   - REST returned queued for quota.
   - The notice read "… waits at the staging mandapam · Waiting for provider capacity".
   - The card closed, and the figure walked the road from the Guild Hall to the
     mandapam with a "Queued" badge.
   - The roster reordered queued artisans first.
5. At 390 px width the roster scrolls horizontally, the card fits, and the document
   does not scroll sideways.
6. No page errors.

Found and fixed during this check:
- A first-frame negative rAF delta produced NaN positions.
- The label toggle hid artisan badges.
- The card stayed open over the walk.

## Not verified

- A started run: the artisan at the house workbench, tool-activity animation,
  question-at-gate, completed and failed states in a live runtime (dummy key and no
  quota by design). These are covered only by unit projection tests.
- Drag-and-drop of a portrait onto a house was not exercised in the browser.
- Reduced motion and night mode with artisans were not captured.
- User look-and-feel acceptance: PT-120.
