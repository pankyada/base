# Town full-canvas temple — implementation and acceptance specification

Date: 2026-09-13. Task: PT-057. Status: approved for implementation.

Primary feature: ORCH-06. Affected client: Web `/town`. This user-authorized
presentation change extends PT-053/055/056. It changes no Core, REST, SSE, WS,
quota, workspace, prompt, persistence, TUI, dispatch, or saved-view contract.
Provider capacity remains the authoritative fail-closed dispatch gate.

## Outcome

`/town` is a single full-viewport 3D canvas. A compact expandable control rail
and one contextual in-canvas card replace the fixed masthead, page columns and
footer. The central landmark becomes an original, detailed, Brihadeeswarar-
inspired Town Temple. Active projects have stable, visibly distinct landmark
forms; inactive project offices retain their size-aware treatment. Night becomes
neutral moonlit charcoal/olive with legible warm street-light pools.

All current project/task/agent truth, map navigation, live actions, directory,
discovery provenance, capacity state, saved views, Day/Night preference and
keyboard camera controls remain available.

## Full-canvas controls and card

- `/town` alone renders without the global Shell chrome. Its canvas frame fills
  `100dvh` with no page scroll. Existing routes remain in a rail Navigation group.
- The left rail has collapsed Navigation, View, Projects and Operations groups.
  Its 40–44px labelled icon triggers expand on hover and focus; click, Enter or
  Space pins a group for touch/editing. Moving between trigger and panel does not
  close it; Escape closes a pinned panel and returns focus; opening a group closes
  the prior one. Hover never executes an action. Panels scroll internally and fit
  the viewport. Do not rely on hover alone.
- View contains Day/Night, Labels, centre, temple focus, saved-view save/restore
  and interaction help. Projects retains search, full registry, Survey and
  provenance. Operations retains real instructions, task/resident/question
  controls, capacity evidence and refresh. Existing handlers and their disabled,
  error and loading states are reused.
- `labelsVisible` is route-local localStorage state, independent of Day/Night,
  defaulting on. Off hides project, temple, resident and discovery CSS2D labels
  only; it cannot relayout/rebuild, reset camera, deselect, or remove equivalent
  DOM controls.
- Clicking an office opens one right-side card (360px preferred, 400px max,
  16px inset, internally scrollable) showing its real project state, path, Git,
  size metadata, pin, work order, tasks/messages and residents. Click temple,
  resident or discovery uses this same card shell with its respective real
  contents. Close and Escape clear the card without resetting camera. At <=600px
  it becomes a bounded bottom card (max 55dvh); pointer events do not pass through
  it while the rest of the canvas remains navigable.

## Stable visual world

- Keep project footprint and lot tier derived only from `tracked_regular_files`.
  It remains neither importance, progress nor a dispatch input. The existing
  deterministic project-ID variation and fixed normal-update layout behavior
  remain intact.
- For a truly active project only (existing `dispatching`, `running`, or
  `waiting_user` task projection), layer a deterministic `TownBuildingAppearance`
  from project ID: `variant`, warm `wallColor`, `roofColor`, and `heightScale`.
  It must visibly vary silhouette, vertical proportion and palette, not merely a
  badge. Keep horizontal geometry inside the fixed footprint, vertical scale about
  0.9–1.35, and never create a second temple. Inactive/pinned/recent projects use
  ordinary offices. Changes of active state may change this visual overlay but
  never move lots, roads, selection or camera, and must not falsely imply linked
  worker activity.
- Preserve deterministic scattered placement, outer inactive zoning, property and
  Hall/temple/discovery/tree clearances, and exactly one connected road/entrance
  per property. Survey or pin success remains the only layout trigger.

## Temple and routing contract

Export `TEMPLE_SITE` from `town-model`: 26 wide × 32 deep × 25 maximum height,
front entrance `(0, 16)`, local +Z front, outer limits x ±13/z ±16 and 5-unit
clearance. Model placement, road routing, scene positioning and temple focus all
consume this single value. The approach is connected to the road graph; no road
crosses its courtyard/footprint. Preserve existing discovery exclusions or move a
conflicting discovery deterministically with coverage.

`createTemple(seed)` returns an original procedural Town Temple, selectable as
the existing Hall/command landmark. It must visibly include a stepped granite
plinth and stairs; square sanctuary; 11–13 articulated tapering vimana tiers
with cornices, inset mass, niche/pilaster rhythm and corner rooflets; neck,
rounded/octagonal crown and finial; lower axial mandapa with readable columns and
deep entry; courtyard wall/gateway, axial paved walk, aligned low Nandi pavilion
and stationary stone bull. The vimana must read as the dominant rear sanctuary,
not a giant front gate. It is Brihadeeswarar-inspired, not an exact reconstruction
or downloaded model; preserve Town command identity and internal Hall IDs.

## Night sky and street lighting

Day/Night remains manual and route-local. At night use neutral charcoal/olive
atmosphere, warm-neutral moon directional key and grey ambient fill so roofs,
soil and foliage retain form. Warm lamps make discernible pools at the temple
entrance, central roads and junctions. There are at most 24 non-shadow-casting
point/spot lights; prioritize central active routes and use bounded emissive
geometry for extra visible lamps. Lamps remain scenery and reduced motion freezes
flicker.

The moon is direction-only sky rendering: fixed celestial direction/angular size,
camera-translation invariant, occluded by world geometry, visible/moving through
the frame only on orbit/view direction, and never a nearby mesh/HUD or a light at
the visible disc. Its directional key follows that celestial direction. Day hides
the moon. Mode switch preserves camera, card/selection, saved views and data and
does not refetch, relayout or restart work.

## Frozen parallel interfaces

1. **Client/CSS:** `TownScene` gains `labelsVisible` and `onSelectHall` props;
   client owns full-canvas rail/card and route-local CSS/tests.
2. **World/model/scene:** export `TEMPLE_SITE`, `TownBuildingAppearance` and pure
   `projectBuildingAppearance(id)`; own label visibility, Hall hit target, sky,
   lights, active appearance integration, reserved bounds, roads and diagnostics.
3. **Assets:** `createHouse(form, seed, appearance?)`, `createTemple(seed)`, and
   shared geometry/material disposal. `createPavilion` may remain compatibly, but
   scene uses the temple.

## Acceptance

- Focused model tests prove deterministic appearance, size-tier independence,
  central/outer placement, temple clearance and road connection.
- Browser checks at desktop and narrow width prove one full-canvas viewport;
  rail hover/focus/click/touch behavior; card open/close/Escape; labels persistence;
  real operations still callable; active offices visibly differ in form/size/color;
  temple selection/focus and close detail; and no console errors.
- Day/night checks show neutral moonlit street pools, no blue wash, moon sky
  behavior during pan/orbit/dolly, <=24 real lights, bounded renderer resources
  and cleanup. Preserve existing PT-053 populated-survey, saved-view/relayout,
  Hall-road and user-acceptance gaps; no release/deployment claim follows local
  evidence.
