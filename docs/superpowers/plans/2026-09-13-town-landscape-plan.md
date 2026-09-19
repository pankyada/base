# Town landscape upgrade

Date: 2026-09-13. Task: PT-053. Status: revised design and tracked-file size proxy approved by the user; implementation in progress.

**Supersession note — 2026-09-13:** The later approved [PT-057 canvas/temple plan](2026-09-13-town-canvas-temple-plan.md) supersedes this plan's modest Bell Hall pavilion/no-completed-temple-replica direction and its earlier assumption of the existing shell and board-column framing. The user approved a large, detailed, original Brihadeeswarar-inspired Town Temple and a route-local full-viewport canvas with an expandable rail; global Shell behavior stays unchanged. The remainder of the PT-053 landscape requirements remains relevant and PT-053 remains open for broader user acceptance. The earlier direction below is preserved as historical evidence.

Primary feature ORCH-06; affected client Web `/town`. Extends the approved
[Town v1 spec](../specs/2026-09-13-orchestrator-town-spec.md). Navigation, central
orchestrator landmark, project boards, commands, pins and saved viewpoints remain.
Latest user direction supersedes European medieval architecture and light-only
presentation: old Tamil/Indian houses and landscape, India around 1000 CE,
historical Easter eggs, day/night, night lights, clouds and birds.

## Approved design

The user approved this revised Chola-era Tamil landscape direction and the
bounded Git-tracked-regular-file size proxy on 2026-09-13. This approves the
implementation scope below; final populated Town landscape acceptance remains
a separate PT-053 completion gate.

Use a coherent **Chola-era Tamil settlement, inspired by the Kaveri region around
1000 CE**. This is an inspired reconstruction, not a claim to recover exact
10th-century domestic architecture. Surviving monumental evidence supports the
regional vocabulary; it does not prove every house detail. Avoid mixing Mughal
palaces, modern India, or 19th-century Chettinad mansions into this era.

Project offices become detached courtyard homes and workshops: warm earth/lime
plaster, brick and stone plinths, timber roof supports, terracotta roof tiles,
thatched roofs on smaller outbuildings, shaded raised verandas and deep doorways.
Four forms grow from compact veranda house to workshop, courtyard house and
larger multi-wing courtyard compound. Detailed eaves, roof courses, carved door
frames, pots, woven baskets, grain jars, low walls, well and wooden cart give
close views depth. Seed variation from project ID. Each property remains one
project, one selectable building group and one board.

Rework Bell Hall's European silhouette into a modest Tamil assembly pavilion:
stone base, shaded pillared hall, tiled roof and retained bell/command identity.
A small distant stone sacred structure may establish regional silhouette, but no
completed replica of the 1010 Thanjavur temple is presented as standing in 1000.
Monumental forms stay secondary; project offices remain the readable world.

Increase typical office centres from roughly 6.5 units to 14–22 units, adjusted
for actual property bounds. Leave at least 5 units between property boundaries;
large offices receive larger lots. Preserve activity/pin/commit-age ordering in
broad districts, but use staggered positions and gentle offsets instead of
visually rigid concentric necklaces. Compute global collisions across districts.
Existing buildings stay fixed during ordinary task/snapshot updates. Survey or
pin changes remain the deliberate relayout points.

Replace the finite green disk with countryside continuing around the camera:
low Kaveri-delta relief, paddy plots, bunds, irrigation channels and a small tank
with stone/earth banks. Add palmyra palms, banyan-like shade trees, mixed broadleaf
clusters, grasses and rocks; species/layout are regional art direction, not a
verified map of a particular village in 1000. Keep distant land flat or gently
raised, not Alpine. Regional irrigation has historical grounding [S3]; palmyra
has present-day regional grounding [S4], which alone does not date an individual
planting practice to 1000.

Deterministic terrain tiles extend beyond visible range as the camera pans;
recycle distant tiles with bounded memory. Atmospheric haze conceals turnover,
not a visible edge. Low drifting clouds and occasional small bird flocks create
sky depth. Clouds and birds are explicitly ambient animation, never work or
message evidence; reduced motion stops drift/flapping. No weather simulation.

A connected packed-earth road network joins the assembly plaza to district lanes
and every courtyard entrance. Use gravel/stone at busy junctions, small crossings
over irrigation channels, and collision-free routes around property boundaries.
Roads, water and fields share one planned layout; no road ends inside a wall.

## Day and night

Add a clear manual **Day / Night** scene control; Day is the first-visit default,
preserving the user's preference for light. Retain the choice locally between
visits. No automatic clock, cycle or system-theme dependency in this slice.
Day uses warm sun, pale blue sky, soft shadows and warm-white readable panels.
Night uses moonlit blue-grey terrain, stars/cloud silhouettes and warm oil lamps
at doors, courtyard lamps and sparse torches near the central pavilion and main
junctions. Lit entrances remain scenery, not false project activity.

Night panels use quiet charcoal surfaces with high-contrast text; labels, fields,
buttons, focus rings and status colours remain readable in both modes. Theme is
scoped to `/town`, including route shell, CSS2D labels, renderer background/fog,
materials and lighting. Mode switch preserves camera, selection and boards.
Use emissive lamp geometry with a bounded small number of real lights; avoid one
shadow-casting light per project. Reduced motion removes flame flicker.

## Historical discoveries

Scatter a small curated set of optional discoveries using a stable seed so they
feel unexpectedly found but do not jump on every snapshot. Choose 3–5 safe sites
near a tank, shade tree, courtyard edge or road; never obstruct project labels or
paths. They are props, reliefs or manuscript tableaux, not live citizens.
Selecting one opens a short accessible caption explicitly labelled **Historical
reference**, with a source link; no agent badge, task state or dispatch control.

- A stone relief/inscribed dedication referencing **Rajaraja Chola I**, a period
  anchor [S1]. Do not invent an authentic quotation or exact royal portrait.
- A palm-leaf manuscript and astronomical diagram referencing **Aryabhata
  (476–550)** [S5]. Caption says commemorative reference to an earlier scholar,
  not a person alive here in 1000.
- A counting board/manuscript reference to **Brahmagupta (598–670)** [S6], likewise
  commemorative. Any actual equation or written excerpt needs its own verified
  source; abstract geometric markings are clearly decorative.

No post-1000 figures, literal hidden eggs, fabricated Tamil inscriptions presented
as authentic, or costumed NPCs mistaken for working agents. Prefer these three
well-grounded references for the first slice over an unbounded random catalog.

## Project size proposal

Use the count of Git-tracked regular files as an explicit, bounded size proxy.
It measures repository extent, not importance, quality, complexity or progress.
Exclude dependency/build/cache directory segments using discovery policy and
exclude nested repositories/gitlinks. Never read file contents or follow links.
Report source, count, status and scan time in the project board.

| Eligible tracked files | Building form | Approximate main footprint |
|---|---|---|
| 0–99 | Veranda house | 4 × 4 units |
| 100–499 | Tamil workshop | 6 × 5 units |
| 500–1,999 | Courtyard house | 8 × 7 units |
| 2,000+ | Multi-wing courtyard compound | 11 × 9 units |
| Unknown / partial | Neutral workshop | 6 × 5 units, board says size unavailable |

Fixed tiers keep a project's size stable when unrelated repositories are added.
Detailed scale values may be tuned within these proportions after browser
inspection. Bound Git enumeration by timeout and output/entry cap. A capped or
failed measurement must not masquerade as an exact count or shrink a previously
known project silently. Record stale evidence separately if retained.

Core needs an optional additive project-size field in discovery, persistence and
HTTP/SSE DTOs. Old records and clients remain valid; Web uses the neutral fallback
until a complete size measurement exists. No WS, prompt, quota or runtime
dispatch change; TUI needs no consumer change. Terra specification stage must
freeze field names, error semantics and caps before coding.

## People and animals

Render one human per actual Town agent; no fabricated worker population. Humans
have recognizable head, torso, limbs, regionally restrained clothing and tool/pose silhouettes.
Current task lifecycle overrides stale stored agent state after restart. An
idle agent waits at its home office or Bell Hall if no home exists. A worker with
a real running task and session/run linkage works at that task's project through
a restrained desk/tool animation. This represents working presence, not a claim
that a particular physical action maps to a particular tool call.

Dispatching and queued agents wait; waiting-user agents stop and show the existing
attention state; failed/interrupted agents stop. Stale/unavailable runtime state
freezes work animation and exposes unknown status. No walking, hammering or
construction for an idle project. Current task ownership takes priority over home
project; selection opens the existing project/task/worker controls. A named DOM
control provides equivalent access when a person is too small to click.

Add a few cattle, goats and chickens around fields/courtyards as
ambient scenery. They carry no agent identity or task meaning. Keep animals idle in this slice; reduced-motion disables worker loops.
Avoid ambient human villagers so every live person has a truthful agent link.
Historical carvings/manuscript props remain visibly inanimate discoveries.

## Execution sequence after direction approval

1. **Freeze acceptance specification (Terra Medium).** Resolve size DTO/caps,
   occupancy spacing, camera terrain continuity, lifecycle projection and browser
   fixtures. Inputs: this proposal, existing Town spec and source inspection.
   Output: bounded PT-053 acceptance spec. Review this revised regional/era treatment, manual day/night and size proxy as
   one concrete design. Requested wider spacing and continuous scenery remain authorized.
2. **Size evidence and deterministic world model (Luna High).** Test first in
   `tests/` and `web/tests/town-model.test.ts`; add bounded discovery metadata in
   `src/town/types.ts` and `src/town/discovery.ts`, backward-compatible persistence
   coverage, size tiers, global lot collision and connected-road model in
   `web/app/town/town-model.ts` or focused adjacent modules. Demo: known/unknown
   metrics and 1/62/dense mixed-size projects without overlapping properties.
3. **Terrain and architecture (Luna High).** Extract focused scene helpers from
   `web/app/town/town-client.tsx`; build shared geometry/material libraries,
   continuous terrain, road junctions, detailed buildings and deterministic
   environment dressing. Apply route-scoped day/night palettes in `web/app/town/town.css`; add bounded
   clouds/birds/lamps and the sourced discovery props; keep existing DOM
   panels/control layout. Bound object
   counts, use shared resources/instancing where useful and dispose all resources.
   Demo: overview plus near-building views at desktop and narrow widths, with no
   terrain edge while panning to town outskirts and back, in both day and night.
4. **Truthful inhabitants (Luna High).** Pass complete existing agent/task
   projection into scene; implement one-person identity, state-driven presence,
   selection and reduced motion. Add ambient animals separately. Demo idle,
   running, waiting, queued, terminal and unavailable fixtures; activity updates
   must not reset camera or move project lots.
5. **Integrated acceptance (Luna High).** Run relevant Core/Web tests, typechecks,
   Web build and boundary checks; full root suite before any commit. Verify real
   populated landscape, existing boards and camera controls, saved viewpoints,
   resize, selection, no console errors and bounded renderer resources during
   sustained pan/zoom. Capture day/night overview and close screenshots. Verify historical captions,
   mode persistence, reduced-motion behavior, illumination and accessible contrast. Record exact
   results and performance limitations; obtain user landscape acceptance before
   closing PT-053. No release/deployment implied.

## Boundaries and rollback

No new game mechanics, automatic weather/time cycle, building interiors, task simulation, random
citizens, dispatch policy changes or unrelated panel redesign. Procedural detail
and local shared textures first; no asset download/package required by this plan.
Unknown size and unknown activity remain explicit. Dense towns may need label
decluttering, but selected/hovered labels and accessible registry stay available.

Existing worktree contains extensive Town and unrelated changes. Capture a scoped
pre-edit backup/diff before implementation, preserve unrelated work, and revert
only the landscape task's edits if required. Parent coordinates tracker changes;
do not create a tracking-only commit.

## Sources and historical limits

- **S1:** [Tamil Nadu Department of Archaeology, Rajarajan Site Museum](https://www.tnarch.gov.in/node/293)
  and [Metropolitan Museum, Chola bronze dated 1000–1020](https://www.metmuseum.org/art/collection/search/768115)
  ground the Rajaraja/Chola regional era and material tradition. These do not
  establish ordinary house plans or justify turning every office into a temple.
- **S2:** [UNESCO, Great Living Chola Temples](https://whc.unesco.org/en/list/250)
  identifies the surviving 11th/12th-century temple group. Use it as adjacent-era
  monumental reference, not exact 1000 CE domestic evidence.
- **S3:** [Government of India, historical water-management account](https://www.pib.gov.in/newsite/erelcontent.aspx?lang=2&reg=48&relid=45440)
  describes longstanding southern lake/well irrigation and Cauvery works. Tank,
  channels and cultivated land are inspired environmental design, not a copied
  historical village plan.
- **S4:** [Tamil Nadu Agricultural University, palmyra introduction](https://www.agritech.tnau.ac.in/postharvest/pht_palmintro.html)
  supports regional palmyra identity today. It is not evidence of exact medieval
  distribution; do not label all regional plants botanically native without proof.
- **S5:** [University of St Andrews MacTutor, Aryabhata](https://mathshistory.st-andrews.ac.uk/Biographies/Aryabhata_I/)
  dates Aryabhata to 476–550 and discusses mathematical astronomy.
- **S6:** [University of St Andrews MacTutor, Brahmagupta](https://mathshistory.st-andrews.ac.uk/Biographies/Brahmagupta/)
  dates Brahmagupta to 598–670 and discusses his mathematical work.

Sources checked 2026-09-13. No source art has been downloaded or licensed as a
product asset. Use original geometry and factual reference captions.

## Dated direction history

- 2026-09-13, initial proposal: European medieval buildings, greater realism,
  wider spacing and continuous terrain. User then requested light Town theme.
- 2026-09-13, subsequent user steering: old Tamil/Indian architecture and landscape,
  India around 1000 CE, historical discoveries, day/night with lamps/torches,
  clouds and birds. This current proposal supersedes European architecture and
  light-only presentation. Day default retains the earlier light preference.
