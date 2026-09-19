# Town canvas and temple refinement

Date: 2026-09-13. Primary feature: ORCH-06. Client: Web `/town` only.

User direction authorizes the major layout and art decisions below. This extends
PT-053 and supersedes the earlier modest pavilion / pre-1010 temple restriction
in the landscape plan: the user now explicitly requests a large detailed
Brihadeeswarar-inspired central temple. Existing Core/API/schema/prompt contracts
remain unchanged. Parent coordinator assigns the task tracker entry and evidence.

## Canvas and interaction

The canvas fills the viewport (`100dvh`, no page scrolling), including where the
route navigation, masthead, fixed board column and footer formerly lived. Remove
the Shell wrapper from this route only; retain route links in a compact Navigation
group inside the canvas. No global Shell behavior change is necessary.

Place a small vertical control rail at top left, inset 16px desktop / 10px mobile.
Use one consistent line-icon family, 40–44px targets, terse accessible names and
small badges. Groups: Navigation; View; Projects; Operations. The collapsed rail
is the resting state. View contains Day/Night, Labels, return to centre, temple
focus, named view save/restore, and interaction help. Projects contains search,
all registry offices (including distant inactive ones), survey and its provenance.
Operations contains orchestrator instructions, all work orders/residents, open
questions, capacity evidence and refresh. Preserve every existing real handler.

Each group expands beside its trigger on hover or keyboard focus; click/Enter/
Space pins it open for touch and editing. Pointer travel between trigger and
panel must not collapse it. Leave closes only transient hover; Escape closes
pinned expansion and restores trigger focus. Opening one closes the other.
Hover never executes an action. Popovers scroll internally and fit the viewport.
Small status/error/attention badges remain visible while groups are collapsed;
a meaningful error may use a compact dismissible live-status toast.

Clicking an office opens a single floating right-side card over the canvas,
width 360px (max 400px), 16px inset, max height calc(100dvh - 32px), with internal
scroll. Header: project name, real state, close button. Body retains path, Git,
tracked-file size metadata, pin action, draft work order, task actions/messages
and relevant residents. Clicking the temple opens the same card shell with Town
operations. A discovery/resident selection uses that shell rather than a second
column. Empty selection means no card. Close and Escape dismiss the card; do not
reset camera. At <=600px use a bounded bottom card with max-height 55dvh, leaving
world visible and the control rail reachable. Overlay pointer events must not
orbit/select through the panel; canvas remains interactive elsewhere.

Labels switch defaults on and persists locally independently of Day/Night. Off
hides all world labels (office, temple, resident, discovery), leaving DOM controls,
selected outlines and side-card names intact. Labels are cosmetic: no relayout,
scene rebuild, camera reset or project deselection.

## Memorable active buildings

Active means the existing live task states: dispatching, running, waiting_user.
Pinned/recent without active work remain ordinary offices. Keep size-derived
footprint and lot classes as measured today. Add a deterministic project identity
appearance separate from the tracked-file measurement: strongly different warm
wall/roof accent, bounded vertical scale and actual geometric roof/upper-volume
silhouette. Suggested families: long ridge workshop, stepped upper hall, hipped
courtyard roof, twin gable atelier, raised lantern roof, compact corner tower.
These are stylized office landmarks, not claimed historical reconstructions.

Generate stable identity from project ID, independent of sorted active membership;
use a broad deterministic palette plus continuous height/proportion variation so
fixture active projects are visibly different in all three dimensions. Do not
merely add colored badges to identical houses. Keep all horizontal geometry within
the existing footprint, vertical scaling roughly 0.9–1.35 of its size class, and
avoid a tall landmark becoming a second temple. Identity remains stable across
snapshots and unrelated activity changes; becoming inactive restores existing
house treatment without moving the lot. Board says measured size class/file count;
any style descriptor is explicitly an identity, not another size metric.

## Moonlight, streets, sky

Night palette becomes charcoal/olive-grey atmosphere, warm neutral moon key and
soft grey ambient fill. Starting palette: sky #24272A, hemisphere #D1D0C6,
ground fill #77796B, directional #E7E3D4, ground #8C9279; tune intensity visually.
Preserve visible roof relief, soil and vegetation instead of washing everything
blue. Warm amber lamps produce discernible pools along central streets, junctions
and temple entrance. Prioritize central active district roads for the existing
24 real-light budget; inactive farthest-point sampling must not consume all
useful central lamps. Decorative emissive lamps/pool meshes may fill longer routes
within bounded geometry, but never replace all actual local illumination.

Replace the camera-child moon disc. Use sky shader/background rendering based
only on world view direction (or a world-oriented sky dome that follows camera
translation but never camera rotation). Fixed celestial direction, stable angular
size, no parallax under pan/dolly, occluded by world buildings. Moon moves through
the frame when orbit/view direction changes and can leave the frame; it is not a
HUD token. Render a subdued lunar disc/halo on that sky surface and hide in day.
No near-world moon mesh or lights positioned at the visible lunar disc. Match the
directional key to its celestial direction. Camera zoom may change framing, never
make it appear physically close. Existing fog/sky continuum must remain seamless.

## Detailed temple landmark

Use an original procedural architectural interpretation, not a downloaded model
or an exact replica. UNESCO identifies the Thanjavur Brihadisvara as a major Chola
monument and describes its towering vimana; this provides the monumental grammar,
not authority for every stylized detail below. Reference:
[UNESCO Great Living Chola Temples](https://whc.unesco.org/en/list/250).

Declare shared `TEMPLE_SITE` in town-model: outer courtyard width 26, depth 32,
maximum built height 25, front entrance at (0, 16), clearance 5. Local +Z is front.
The courtyard/asset stays within x +/-13 and z +/-16. Main sanctuary sits behind
centre, vimana rises above it; the approach continues along +Z to road network.
Model clearance and road routing consume these same bounds. Existing discovery
sites must remain separate; adjust their positions only if geometry makes an
existing reserved site overlap, with deterministic tests. The central district
may grow to clear the temple, while inactive zoning still starts outside it.

Visible architecture must include:

- Broad granite plinth with 3–4 receding base courses and front stair flight.
- Square sanctuary and dominant tapering vimana: roughly 11–13 articulated tiers,
  each with projecting cornice bands, inset wall mass, repeated niche/pilaster
  rhythm and small corner rooflet forms. A stack of undecorated boxes is insufficient.
- Rounded/octagonal crown volume and small finial atop a narrow neck; warm granite
  palette with lighter edges and recessed darker relief for legible night depth.
- Lower axial mandapa leading toward the entry: columns with base/shaft/capital,
  visible aisle rhythm, roof courses and deep entrance opening.
- Lower courtyard wall with gateway, modest tiered entry feature clearly shorter
  than the vimana, and a columned Nandi pavilion aligned on the entrance axis.
  Nandi is a small stylized stationary stone bull, not an agent or ambient animal.
- Paved axial walk and courtyard, with lamps placed outside the walking line.

Keep the recognizable distinction: towering sanctuary vimana behind a lower
entry, rather than an enormous front gate with no sanctuary. Aim for layered
silhouette visible at overview and repeated relief visible on focus. Merge static
geometry by material / share geometries as existing assets do. No textures,
packages, external models or thousands of independently rendered detail objects.
Temple is a selectable orchestrator landmark; UI calls it Town Temple and explains
its command function. Preserve internal Hall identifiers if tests/contracts need
compatibility. Adjust temple focus framing to show its full height and courtyard.

## Ownership and exact seams

1. Client/CSS coder owns `town-client.tsx`, `town.css`, `page.tsx` and UI tests.
   Add `labelsVisible: boolean` and `onSelectHall: () => void` props when mounting
   TownScene. Use closeable card state independent of project selection where
   necessary. All existing action functions and provider truth stay wired.
2. Scene/world/model coder owns `town-scene.tsx`, `town-world-model.ts`,
   `town-model.ts` and model tests. Export `TEMPLE_SITE` and
   `TownBuildingAppearance` = `{ variant: number; wallColor: number; roofColor:
   number; heightScale: number }`; expose pure `projectBuildingAppearance(id)`.
   Own label visibility, Hall hit target, world sky, lights, active appearance
   integration, reserved bounds, roads, temple focus and resource diagnostics.
3. Asset coder owns `town-assets.ts` and asset-focused verification. Extend
   `createHouse(form, seed, appearance?: TownBuildingAppearance)` and add
   `createTemple(seed): THREE.Group`. Read `TEMPLE_SITE` from town-model. Existing
   `createPavilion` may remain for compatibility but scene uses createTemple.
   All meshes of returned temple group must be raycastable via scene ancestor
   selection; share resource ownership through library disposal as today.

Freeze these seams with acceptance spec before parallel edits. Implement with
failing behavioral tests first where meaningful; do not test only CSS strings.
Verify desktop and mobile full-canvas bounds, hover/focus/touch groups, card open/
close, labels persistence, real controls, distinctly active fixture buildings,
neutral lit street views, sky pan/orbit/dolly, temple close-up, collision/roads,
selection, save/restore and mode persistence through relayout. Measure resource
counts and compare pre-change baseline. Local browser fixtures do not establish
populated live/user acceptance or deployment. Preserve previously open PT-053/
PT-054 gaps; do not silently close them with this visual work.
