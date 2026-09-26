# Town population and detailed avatars

Date: 2026-09-26. Task PT-127. Feature ORCH-06, Web Town only.

## Implemented

- Sixteen deterministic decorative residents beside safe road segments. Five are
  placed near the south temple approach in the empty-layout fixture; remaining
  slots prefer nearby roads. Existing campus, civic, project and discovery
  clearances govern placement. Residents have light idle/greeting gestures;
  reduced motion resets their limb/body movement.
- Residents have varied clothing, hair/headgear and carried belongings. They
  never enter agent rosters, runtime counts, task state or interaction targets.
- Named artisans and legacy agents share richer human faces, hair, draped cloth,
  pleats, embroidery, fingers, jewelry and sandals. Existing role props, status
  lamps, Ganesha/Nandi forms, animation joints and ghost state remain supported.
- A dedicated fictional user traveller has teal/ivory/gold layered shawls,
  geometric embroidery, a bound headwrap, garment folds, belt/clasp, articulated
  hands and sandals, plus a rear pack with straps, buckles, pocket, rolled bedding
  and water flask. Existing walk/follow-camera controls use this asset.
- Fixed detail is merged within each articulated part. `releaseAsset` frees
  avatar-owned merged geometry and instance buffers while preserving shared
  library geometry. Scene removal releases retired agent assets.

ADR-93 and the landscape-spec amendment record the user's explicit extension
of the former no-ambient-human scope. No Core/API/WS/SSE/schema/prompt/TUI change.

## Validation

- Full Web suite: **45 files, 258 tests pass**, including 10 asset and 2 population
  tests. Relevant contracts cover animation handles, agent/status separation,
  footprints, draw bounds, safe deterministic placement and disposal isolation.
- `pnpm --dir web typecheck` and `git diff --check` pass.
- Isolated Three.js gallery renders the actual asset builders: townspeople,
  Vishwakarma, Gargi and the user's front/back views. Day and night close-ups
  visually inspected; no external models or textures downloaded.
- Actual `http://localhost:3000/town` loads its existing partial 62-repository
  survey (dated 2026-09-13). Browser confirms 16 decorative residents, visible
  people near the temple approach, user walk mode, and a click-to-walk move to
  approximately `(-1.5, 74.5)` with attached limbs/gear and changed facing.
  Fresh final page error-log query is empty. No agent task was dispatched.

Sampled final geometry costs (meshes/draws before shadow passes and culling;
not a frame-rate measurement):

| Figure | Draws | Triangles |
|---|---:|---:|
| Townsperson | 38 | 7,594 |
| Legacy agent | 33 | 6,488 |
| Named human artisan | 36 | 6,668 |
| Ganesha | 32 | 5,032 |
| Nandi | 22 | 1,976 |
| User traveller | 47 | 8,745 |

Screenshots are saved outside the repository in
`/Users/pankajkumaryadav/.codex/visualizations/2026/09/26/01a0db3b-7a9d-71f0-a038-a839cf59d85e/town-avatars/`:
`characters-day.png`, `user-avatar-day.png`, `user-avatar-night.png`, `town-walk.png`.

## Limits

Working-tree changes only; no commit, release or deployment. Visual inspection
is local evidence, not user appearance approval or measured GPU performance.
Populated named-agent runtime acceptance and broader landscape acceptance remain
PT-120 and PT-053. The existing live snapshot contains no persistent artisan
roster; named-agent visual detail was checked in the isolated gallery.
