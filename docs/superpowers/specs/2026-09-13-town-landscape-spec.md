# Town landscape improvements — implementation and acceptance specification

Date: 2026-09-13. Task: PT-053. Status: approved for implementation by the user
on 2026-09-13, including the tracked-file size proxy; implementation in progress.

**Supersession note — 2026-09-13:** The later approved [PT-057 canvas/temple specification](2026-09-13-town-canvas-temple-spec.md) supersedes this specification's modest Bell Hall pavilion/no-completed-temple-replica restriction and former shell/board-column framing. The user approved a large, detailed, original Brihadeeswarar-inspired Town Temple and a route-local full-viewport canvas with an expandable rail; global Shell behavior stays unchanged. Remaining PT-053 landscape and acceptance requirements remain in force. This dated specification is preserved as historical evidence; PT-053 is still open.

Primary feature: ORCH-06. Affected client: Web `/town`. Core compatibility
surface: additive Town discovery/project DTO only. This specification extends
[Town v1](2026-09-13-orchestrator-town-spec.md) and freezes the bounded parts of
the [landscape proposal](../plans/2026-09-13-town-landscape-plan.md). It does not
alter dispatch, quota, workspace, prompt, WebSocket, TUI, board, or saved-view
contracts.

## Outcome

`/town` becomes a Chola-era Tamil settlement inspired by the Kaveri region around
1000 CE. It is an original, regional reconstruction, not a claim to recover one
historical village. Day is the default, with a manually selected Night view.
Project offices occupy separated, size-aware properties linked by roads. Land
continues to the camera horizon. Each visible human maps to one actual
`TownAgent`; only a real running task with a matching agent and session/run may
animate work. Animals and historical discoveries are idle scenery.

Bell Hall, project/task boards, command actions, quota display, pins, saved
viewpoints, keyboard/mouse camera controls, label accessibility and ordinary
snapshot updates retain their existing behaviour.

## Approved project-size contract

### Meaning and source

`tracked_regular_files` is a bounded repository-extent proxy. It is neither
importance, quality, progress, nor a dispatch input. Discovery obtains it with
Git's tracked-file index only; it must not read file contents, follow symlinks,
walk untracked directories, include gitlinks, or count files belonging to a
nested Town project.

Use the same ignored directory policy as Town discovery. A tracked path under
an ignored segment, a path that cannot be safely classified as a regular file,
or a nested-repository/gitlink path is excluded. The code must not silently
fall back to a filesystem traversal.

### Additive DTO and persistence shape

Add this optional field to `TownProject`; it is persisted and is included
unchanged in discovery responses, snapshots and SSE snapshot/event payloads.

```ts
size?: {
  source: 'git_tracked_regular_files'
  status: 'complete' | 'partial' | 'unknown' | 'error'
  tracked_regular_files?: number
  measured_at: string
  max_entries: number
  error?: string
}
```

`complete` requires a finite non-negative count and no cap/error. `partial`
means enumeration started but reached a cap or deadline; it must not carry an
exact count. `unknown` means no measurement was possible; `error` means a
measurement attempt failed. `partial`, `unknown`, and `error` may include a
short non-secret reason but omit `tracked_regular_files`. `measured_at` is the
attempt time. `max_entries` is the configured file-entry ceiling used by that
attempt.

The first implementation uses a hard cap of **10,000** eligible tracked entries
and **1,200 ms** for the Git enumeration, within the existing discovery
deadline. The effective Git command timeout cannot exceed the remaining global
discovery deadline. Exact counts at or below 10,000 are complete; an attempt
that would exceed the ceiling is partial. These values are named constants and
covered by tests, not user-configurable settings.

Old persisted projects without `size` remain valid. A complete earlier size may
remain visible only while its `measured_at` is retained as stale evidence; a new
partial/error/unknown result must not be represented as a new complete count or
quietly replace the known tier. For this slice, render the neutral tier whenever
the current size is not complete and label it `Size unavailable`; do not show a
stale number as current.

No protocol version change is required: Town HTTP/SSE objects are additive, and
there is no WebSocket payload change. Existing Web builds ignore an unknown
field; current persisted records deserialize without migration. TUI has no Town
consumer. Runtime, provider-capacity, dispatch, prompts and task transition
contracts have no changes.

### Building tiers after approval

The Web model maps only `size.status === 'complete'` to a deterministic form:

| Eligible tracked regular files | Form | Main footprint | Lot minimum |
|---|---|---:|---:|
| 0–99 | veranda house | 4 × 4 | 10 × 10 |
| 100–499 | Tamil workshop | 6 × 5 | 13 × 12 |
| 500–1,999 | courtyard house | 8 × 7 | 16 × 15 |
| 2,000+ | multi-wing courtyard compound | 11 × 9 | 20 × 18 |
| unavailable | neutral workshop | 6 × 5 | 13 × 12 |

The tier is derived solely from the project ID and current complete metric.
Visual variation is seeded solely by project ID. Parent/child repository status,
task activity, commit age and refresh ordering must not change a building's
form or variation.

## Deterministic town model

### Properties and placement

Each project gets a rectangular property boundary from its tier. Boundaries,
not mesh origins, are collision targets. Every pair of project boundaries has a
minimum **5 world-unit** edge-to-edge separation, including projects in different
activity/commit-age districts. Bell Hall plaza has a **7 unit** clear perimeter
from any property boundary.

Keep the existing activity, pin and commit-age ordering as district preference:
active, pinned, recent, established, quiet and unknown. Start their nominal
centres at 14, 22, 31, 41, 52 and 64 units, respectively. The placement solver
may expand a district or use deterministic staggered offsets/sub-rings to meet
property separation. It must not use a hard global radial limit.

For identical projects, active IDs, pin IDs, size metadata and layout revision,
the resulting positions, property extents, form variants and road graph are
byte-for-byte deterministic. Input ordering does not matter. Normal task,
agent, quota, message or snapshot updates do not relayout projects or reset the
camera. A successful Survey/discovery completion and a successful pin change
are the only relayout triggers. Layout revision is explicit and retains the
current saved-camera behaviour.

### Roads and dressing

The world model produces a connected graph from the Bell Hall plaza to exactly
one entrance point for every project property. Main roads are continuous
worn-earth routes with stone edges; each property has one short gravel path to
its entrance. A route may curve, but no segment crosses a property interior,
Bell Hall clearance zone, or tree exclusion circle. Junctions share endpoints;
there are no visually disconnected road stubs. Roads encode location only, not
agent communication or progress.

Add deterministic property dressing selected by project ID and form: a fence or
low stone wall, garden/field, woodpile, barrels, cart and project sign. Keep
dressing outside the entrance path and property collision padding. Trees, rocks,
shrubs and fields are deterministic environment dressing; they cannot obscure a
project click target, label, entrance, road, animal or human.

## Scene, regional vocabulary, and Day/Night requirements

The Town route alone owns a clear manual `Day` / `Night` control. Day is the
first-visit default; store the user selection locally for `/town` only. There is
no clock, automatic cycle or system-theme dependency. Switching modes changes
only route-scoped CSS and Three.js presentation: it must retain the camera pose,
selection, open board, saved viewpoints, layout revision and all runtime data.
It must not refetch, relayout, recreate dispatch state, or restart person work
animation.

Day panels, labels, fields, buttons, focus rings, status dots, selections and
footer use warm-white/light-stone surfaces, dark text, stone-grey borders and
restrained brass/green accents. Day scene uses a pale-blue sky, warm sun and
soft shadows. Night uses quiet charcoal panels, high-contrast text, moonlit
blue-grey terrain, stars/cloud silhouettes and warm lamp light. Every control,
label and status remains readable at WCAG AA normal-text contrast in both modes;
loading, unavailable and partial/error remain distinct. Do not change the global
shell or other routes.

Buildings use regional, original geometry: warm earth/lime plaster, brick and
stone plinths, timber roof supports, terracotta roof tiles, smaller thatched
outbuildings, shaded raised verandas and deep doorways. Add roof courses,
carved-door-frame-like geometric detail, pots, baskets, grain jars, low walls,
wells and wooden carts without presenting an invented inscription as authentic.
Bell Hall becomes a modest Tamil assembly pavilion with stone base, shaded
pillars and tiled roof while retaining its bell/command identity. A secondary
distant sacred silhouette may establish place, but no finished 1010 Thanjavur
temple replica, Mughal palace, modern structure or 19th-century Chettinad mansion
is allowed.

Terrain is a bounded, deterministic tile field around the camera with level
assembly-plaza/road/building pads, low delta relief, paddy plots, bunds,
irrigation channels, a small tank with earth/stone banks, palmyra palms,
banyan-like shade trees, mixed broadleaf clusters, grasses and rocks. It must
not become Alpine terrain or claim an exact historical planting/map. Tiles recycle
outside the visible range; reuse must not make a seam, disk edge, void,
discontinuous ground or sudden object pop visible in any supported camera pose.
Atmospheric haze may hide turnover but cannot hide an edge at ordinary view
distance. The scene retains a bounded number of terrain tiles and renderer
resources; shared geometry/materials are disposed once when the scene unmounts.

Night lamps are scenery, never project activity. Use emissive lamps at entrances,
courtyards, the pavilion and main junctions, with at most **24** non-shadow-casting
point/spot lights for the whole scene; do not allocate one real light per project.
The primary sun/moon directional light is separate. Reduced motion freezes lamp
flicker. Render at most 12 deterministic low cloud forms and three deterministic
bird flocks of at most seven birds each; their drift/flapping is ambient only and
`prefers-reduced-motion: reduce` freezes it.

At the default overview, focus on an outer project, saved viewpoint restore,
maximum supported pan and a return to Bell Hall, ground must be visible from the
near camera plane to the fog horizon. No feature requires a weather/time cycle,
interiors, construction, gameplay or simulated town population.

## Historical discoveries

Place exactly three optional, inanimate historical-reference props at stable,
project-ID-independent seeded sites near a tank, shade tree, courtyard edge or
road. Their sites cannot obstruct a project label, person control, entrance,
road or path. A selected discovery opens an accessible caption headed
`Historical reference` and one source link. It has no agent badge, task state,
dispatch control, reward or implication of project work.

The initial set is: a stone relief/inscribed dedication referring to Rajaraja
Chola I; an abstract palm-leaf manuscript/astronomical-diagram tableau referring
to Aryabhata (476–550); and a counting-board/manuscript tableau referring to
Brahmagupta (598–670). The latter two captions state that they commemorate an
earlier scholar, not someone alive in 1000. Do not invent quotations, equations,
authentic-looking Tamil inscriptions, exact royal portraits, post-1000 figures,
or literal hidden eggs. The props must remain visually distinct from Town agents
and the regionally dressed but runtime-grounded agent figures.

Captions link respectively to the Tamil Nadu Department of Archaeology Rajarajan
Site Museum (or the Metropolitan Museum's dated Chola object), University of St
Andrews MacTutor's Aryabhata page, and MacTutor's Brahmagupta page, as recorded
in the revised landscape proposal. The source establishes a reference, not a
claim that the tableau is a faithful period artifact.

## Truthful people and animals

Pass the complete existing Town agent/task projection to the scene: agent ID,
display name, home project, persisted state, task ID, session ID and run ID.
Render at most one human per Town agent and no ambient human villager. A person exposes
their name and current state through an accessible DOM button/control; activating
it opens the existing project/task/worker controls. The visible human remains
selectable even when its 3D target is too small.

| Evidence from current snapshot | Location and pose | Animation |
|---|---|---|
| current task is `running`, is assigned to that agent, and non-empty task and agent session/run IDs both match | assigned task project's work point | restrained desk/tool loop |
| agent idle, queued, or dispatching | home property; Bell Hall when no home | still/waiting pose |
| task/agent waiting_user | task project when known | stopped attention pose and existing attention state |
| failed, interrupted, cancelled, completed, blocked, or stale/unavailable projection | last safe home/Bell Hall point | stopped terminal/unknown pose; no work loop |
| no matching project, task or runtime linkage | Bell Hall | unknown/stopped pose |

Current task ownership wins over a home project only when the working evidence
above is complete. Persisted `TownAgent.state` is display context only: restart
recovery can interrupt a task while leaving an old agent `working`, so it cannot
authorize animation. An agent marked `working` without a matching current
task/session/run is unknown/stopped, never working. Idle buildings never gain construction,
walking, hammering or worker animation. `prefers-reduced-motion: reduce` freezes
all worker loops; animals are still in every mode.

Animals are a small bounded set of cattle, goats and chickens placed in
fields/courtyards. They have no identity, task, status, tooltip or animation
meaning in this slice. They must not be rendered as people or imply agent work.

## Test-first delivery

Before production changes, add failing focused tests. Implement in these slices:

1. **Core discovery and persistence.** Extend `tests/town-discovery.test.ts`,
   `tests/town-store.test.ts` and HTTP/SSE coverage for exact 0/99/100/499/
   500/1,999/2,000 tiers; ignored paths; nested repo/gitlink exclusion; deadline,
   cap, Git failure and old project JSON without `size`; full snapshot and event
   compatibility. Assert no content reads and no symlink following through the
   existing discovery seams.
2. **World model.** Extend `web/tests/town-model.test.ts` before changing the
   renderer. Cover stable size form/variant, neutral unavailable fallback,
   order-independent dense mixed-size placement, all-pairs property clearance,
   Bell Hall clearance, connected roads, road/property/tree nonintersection,
   layout-trigger rules and overview distance for 390 px and 1440 px widths.
3. **Scene, mode, discoveries and inhabited-state projection.** Extract testable helpers from
   `web/app/town/town-client.tsx` if needed. Add fixtures for idle, dispatching,
   queued, running with valid linkage, running with invalid linkage, waiting,
   terminal and unknown agents; assert one person per real agent, zero fabricated
   people, working pose only with valid linkage and reduced-motion freeze. Add
   deterministic tests for Day default/local persistence, no model/camera/layout
   reset on a mode switch, global lamp-light cap, cloud/bird caps and freezes,
   three stable discovery sites, source-caption accessibility and the absence of
   task/agent semantics on a discovery.
4. **Visual/browser acceptance.** Start an isolated fixture-backed Town source
   and Web server on unused ports; do not use, modify, restart or stop existing
   `:7337`, `:3000`, or `:3001` processes, because they can serve older source or
   another active development session. Run browser checks at 1440 × 900 and 390 ×
   844 using the mixed-size fixture. Verify Day and Night panels, labels,
   controls and contrast; mode persistence and no camera/selection/board/runtime
   reset on switch; overview, outer focus, pan/return and saved view; a close
   building showing 3D regional detail; roads to every office; no terrain edge;
   bounded night lights; cloud/bird reduced-motion freeze; discovery captions;
   board and person-control selection; resize; and no console errors. Capture
   Day and Night overview plus close-property screenshots. Use a populated live
   survey separately for the final user acceptance gate.

Required automated commands after integration are the focused Town Core/Web
tests, Core typecheck, Web typecheck and production build, `scripts/check-boundary.sh`
from repository root, then the full root `pnpm test` suite before a commit.
Record actual counts/results; passing tests do not close user landscape
acceptance or imply release/deployment.

## Performance and regression acceptance

Use a 62-project mixed-size fixture and a dense 120-project fixture. On the
supported browser test host, report—not guess—the median and worst animation
frame interval over a 30-second pan/zoom/return trace, renderer object/resource
counts before and after ten scene remounts in both Day and Night, and console
errors. The hard release
conditions are bounded tile/resource counts after remount and zero Town-caused
console errors, leaks or WebGL-context-loss events. If the trace cannot sustain
smooth interaction, reduce procedural density/quality or record the measured
limitation; do not conceal it with an unbounded cache or disabled controls.

Existing Town regression conditions remain required: project board and Bell Hall
commands work; quota/unavailable/partial truth stays visible; pins and named
viewpoints persist; keyboard/mouse camera controls work; selected and pinned
labels survive decluttering; ordinary updates retain camera and property
positions; screen-reader DOM access remains available.

## Safe implementation and rollback

The current worktree has untracked Town v1 files, so `git checkout` cannot
restore them. Before implementation, record `git status --short`, the current
Town-file hashes, and a scoped unified pre-edit patch/backup outside the worktree
for every untracked Town file:

- `src/town/`
- `tests/town-discovery.test.ts`, `tests/town-http.test.ts`,
  `tests/town-quota-codex.test.ts`, `tests/town-runtime.test.ts`,
  `tests/town-store.test.ts`
- `web/app/town/` and `web/tests/town-model.test.ts`
- `docs/superpowers/plans/2026-09-13-orchestrator-town-plan.md`,
  `docs/superpowers/plans/2026-09-13-town-landscape-plan.md`,
  `docs/superpowers/specs/2026-09-13-orchestrator-town-discovery.md`,
  `docs/superpowers/specs/2026-09-13-orchestrator-town-spec.md`, and this spec

Preserve all unrelated dirty changes. Keep landscape edits in an isolated,
reviewable patch or commit. Roll back only that patch after re-checking the
target paths against the recorded hashes; restore untracked Town files from the
backup rather than deleting them. If a Core DTO change proves incompatible,
remove only the optional `size` producer/consumer and retain the neutral visual
fallback. No destructive cleanup, release, deployment or tracker-only commit is
authorized by this specification.

## Completion boundary

PT-053 can be marked done only after the automated and browser evidence above,
captured measured performance/resource results, a populated live Town survey,
and explicit user landscape acceptance. It remains separate from PT-052's
broader operational acceptance and PT-054's headless queue/model-catalog work.
