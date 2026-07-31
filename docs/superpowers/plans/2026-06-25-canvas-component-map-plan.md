# Plan: Zoomable Canvas Component Map

**Generated**: 2026-06-25
**Estimated Complexity**: High

## Overview

Replace the current DOM-bands + SVG-overlay component map (in
`docs/architecture-site/`) with a **true HTML5 `<canvas>`** interactive map
rendered with **Konva.js** (vendored locally for offline use). The new map is a
large, spacious, zoomable/pannable surface that keeps the **layered-band layout**
(8 layers spread out top-to-bottom) and adds rich interactivity:

- **Pan + zoom + fit** — drag to pan, wheel/pinch to zoom (pointer-relative,
  clamped), plus zoom-in / zoom-out / reset / fit-to-view controls.
- **Click-to-focus subgraph** — click a node to isolate it and its connections,
  reveal edge labels, dim the rest, and smoothly move the camera to frame it.
- **Drag to reposition** — drag nodes; edges follow; positions persist for the
  session (`sessionStorage`).

The rebuild must **preserve three existing integrations**:
1. `window.mapAPI = { highlightLayer, clearHighlight }` — driven by the Sprint-3
   scroll storytelling (`docs/architecture-site/app.js`, scroll-sync IIFE).
2. The slide-in **detail panel** (`#map-panel`, `openPanel`/`closePanel`).
3. **Accessibility + offline** guarantees from Sprint 5 — canvas has no DOM, so
   we keep an accessible **list-view fallback** and ship Konva **locally**.

Konva fits the chosen constraints (true canvas, draggable nodes, hit-testing,
full control of the layered layout and light-theme aesthetic). The **existing
SVG/DOM map becomes the no-Konva / list-view fallback** — it is not deleted, just
gated behind feature detection and a view toggle.

### Decisions locked (from clarification)
- Rendering: **true `<canvas>` 2D** (via Konva).
- Layout: **layered bands, spread out**.
- Interactions: **pan + zoom + fit**, **click-to-focus subgraph**, **drag to reposition**.
  (No minimap/search this round.)
- Dependencies: **a library is allowed** → Konva, **vendored into `assets/`** so
  `file://` / offline still works (no hard CDN dependency).
- **Zoom trigger**: **Ctrl/⌘ + wheel** zooms; plain wheel scrolls the page
  normally (never traps the user); pinch zooms on touch.
- **Placement**: inline **bounded** canvas in `#map` + an **"Expand" fullscreen
  overlay** for spacious exploration (avoids sticky/nested-scroll conflicts).
- **Drag persistence**: **`sessionStorage`** (survives reload in the same tab) +
  a "Reset layout" control.

## Prerequisites
- Existing site at `docs/architecture-site/` (`index.html`, `styles.css`,
  `app.js`, `data.js`, `assets/`).
- `window.ARCH` data model: `layers[].nodes[]`, `edges[] {from,to,kind}`,
  `flow[]` (unchanged — the canvas reads the same data).
- Konva.js (latest, ~150 KB min) downloaded to
  `docs/architecture-site/assets/konva.min.js`.
- Local static server for testing (`npx serve` already configured in
  `.claude/launch.json`); also test by opening `index.html` over `file://`.

## Architecture notes (grounding)
- **Stage / Layers**: one `Konva.Stage` with `draggable: true` (pan). Three
  `Konva.Layer`s, back-to-front: (1) **grid/background** (`listening:false`),
  (2) **edges**, (3) **nodes** (each node a `Konva.Group` = rounded `Rect` +
  accent dot + `Text`).
- **Pointer-relative zoom**: `stage.on('wheel', ...)` computing `mousePointTo`,
  `newScale = clamp(oldScale * scaleBy^±1, MIN, MAX)`, then reposition stage.
- **Fit-to-view**: compute content bounding box from node positions, set
  `stage.scale` and `stage.position` so the bbox fits with padding.
- **Node groups carry `id`** (`group.id(nodeId)` / `group.setAttr('nodeId', …)`)
  so click/hover handlers resolve back to `ARCH` data.
- **Edges** are `Konva.Line`/`Konva.Arrow`; on node drag, recompute endpoints
  from the two node group positions and `layer.batchDraw()`.
- **HiDPI** handled by Konva via `Konva.pixelRatio` / `devicePixelRatio`.

---

## Sprint 1: Foundation — vendor Konva, canvas stage, fallback gating

**Goal**: A spacious canvas renders all 8 layered bands with every node and edge
from `ARCH`, statically (no interaction yet). If Konva is unavailable, the old
SVG/DOM map shows instead. Nothing about scroll-sync or the detail panel breaks.

**Demo/Validation**:
- Load the page → `#map` shows a canvas with all nodes laid out in 8 bands +
  edges; counts match `ARCH` (29 nodes / 31 edges).
- Rename the Konva script temporarily → SVG fallback map renders; no console error.
- Console clean; works over `file://`.

### Task 1.1: Vendor Konva locally + load it
- **Location**: `docs/architecture-site/assets/konva.min.js`, `index.html`
- **Description**: Download Konva min build into `assets/`. Add
  `<script src="assets/konva.min.js"></script>` **after** `data.js` and
  **before** `app.js`. Do not rely on a CDN (offline requirement).
- **Acceptance Criteria**: `window.Konva` is defined at runtime; no network
  request needed; file committed under `assets/`.
- **Validation**: `console.log(window.Konva.version)`; load with network
  disabled / via `file://`.

### Task 1.2: Restructure `#map` markup for canvas + fallback + view toggle
- **Location**: `index.html`, `styles.css`
- **Description**: Inside `#map`, add:
  - `<div id="map-stage" class="map-stage"></div>` (Konva mounts here),
  - keep the existing band/SVG map markup but move it into
    `<div id="map-fallback" class="map-fallback">` (shown only when Konva is
    absent or "List view" is chosen),
  - a view toggle: `Canvas view ⇄ List view` (`<button>`s, `aria-pressed`).
  Give `.map-stage` a definite size (e.g. `height: clamp(440px, 72vh, 760px)`,
  full width of the section), rounded border, `--surface` background, and
  `overflow: hidden`.
- **Acceptance Criteria**: Canvas container has non-zero measured size before
  Konva init; fallback hidden by default when Konva present.
- **Validation**: Inspect computed height of `#map-stage` > 0; toggle swaps views.

### Task 1.3: Compute layered-band layout coordinates
- **Location**: `app.js` (new "canvas map" IIFE)
- **Description**: From `ARCH.layers`, compute a virtual-space layout: each layer
  is a horizontal band at `y = bandTop + i*bandHeight`; nodes spread evenly along
  the band's x with generous gaps (spacious). Store `pos[nodeId] = {x,y}` and the
  band rects/labels. Use a virtual coordinate space (e.g. 1600×1800) independent
  of the viewport; the camera (stage scale/pos) maps it to the container.
- **Acceptance Criteria**: Every node has a position; no two overlap; bands are
  clearly separated.
- **Validation**: `console.table(pos)`; visual check after 1.4.

### Task 1.4: Render stage, layers, nodes, edges (static)
- **Location**: `app.js`
- **Description**: Build `Konva.Stage` (sized to container) + grid layer
  (`listening:false`), edge layer, node layer. Render each node as a
  `Konva.Group` (rounded `Rect`, accent dot, label `Text`) tagged with its id;
  render each edge as a `Konva.Line` styled by `kind` (color/dash from the light
  theme). Add per-band label `Text`. Call `fit-to-view` once on init so the whole
  map is framed. `ResizeObserver` resizes the stage and re-fits (debounced).
- **Dependencies**: 1.1–1.3
- **Acceptance Criteria**: 29 nodes + 31 edges + 8 band labels visible and framed;
  resizing the window keeps it framed.
- **Validation**: Compare counts to `ARCH`; resize test; console clean.

---

## Sprint 2: Pan, zoom, fit controls

**Goal**: The map is navigable — drag to pan, wheel/pinch to zoom relative to the
pointer, with on-screen controls and keyboard support, without hijacking page
scroll.

**Demo/Validation**:
- Drag empty space → pans. Wheel over the map → zooms toward cursor, clamped.
- Buttons: zoom-in, zoom-out, reset (100%), fit-to-view all work.
- Page still scrolls normally when the pointer is not interacting with the map
  (per the scroll-capture decision — see Gotchas).

### Task 2.1: Drag-to-pan + pointer-relative wheel zoom
- **Location**: `app.js`, `styles.css`
- **Description**: `stage.draggable(true)` for pan (but ignore drags that start
  on a node — those are node drags, Sprint 3). Implement `stage.on('wheel')`
  pointer-relative zoom with `scaleBy ≈ 1.05`, clamp `MIN_SCALE`/`MAX_SCALE`.
  **Zoom only when `e.evt.ctrlKey || e.evt.metaKey`** (Ctrl/⌘ + wheel) — and only
  then `preventDefault()`; otherwise let the wheel scroll the page normally.
  Show a brief hint ("⌘/Ctrl + scroll to zoom") on plain-wheel over the map.
- **Acceptance Criteria**: Smooth pan/zoom ~60fps; scale clamped; cursor stays on
  the same world point while zooming.
- **Validation**: Manual; verify zoom focus point; check clamps at extremes.

### Task 2.2: Zoom / reset / fit controls
- **Location**: `index.html`, `app.js`, `styles.css`
- **Description**: Control cluster overlaid on the map (`+`, `−`, `⌂` reset to
  100% centered, `⤢` fit-to-view, and a live `NN%` readout). Fit computes the
  content bbox and scales to fit with padding. Reduced-motion → instant; else a
  short eased camera tween.
- **Dependencies**: 2.1
- **Acceptance Criteria**: All four controls behave correctly; readout tracks zoom.
- **Validation**: Click each; confirm fit frames all nodes with margin.

### Task 2.3: Keyboard + touch navigation
- **Location**: `app.js`
- **Description**: When the map region is focused: `+`/`−` zoom, arrow keys pan,
  `0` fit. Touch: one-finger pan, two-finger pinch-zoom (Konva multi-touch).
- **Dependencies**: 2.1
- **Acceptance Criteria**: Keyboard pan/zoom works when map focused; pinch works
  on touch.
- **Validation**: Keyboard sweep; device-emulation pinch.

---

## Sprint 3: Node interactivity — hover, focus subgraph, drag, panel

**Goal**: Nodes are richly interactive: hover highlights neighborhoods, click
isolates a subgraph + opens the detail panel + frames the node, and nodes can be
dragged with edges following.

**Demo/Validation**:
- Hover a node → it + neighbors + connecting edges highlight; others dim.
- Click a node → rest dims, its edges show labels, camera eases to frame it,
  detail panel slides in with correct data.
- Esc / click empty → focus clears, panel closes, camera unchanged.
- Drag a node → it moves, connected edges follow; position persists this session.

### Task 3.1: Hover/focus highlight neighborhood
- **Location**: `app.js`, `styles.css`
- **Description**: On node `mouseover`/`mouseout` (and keyboard focus surrogate),
  compute neighbor set from `ARCH.edges`; set `.is-active`/`.is-dim` equivalents
  by adjusting Konva node/edge `opacity` + stroke; `batchDraw`. Pointer cursor on
  hover.
- **Acceptance Criteria**: Highlight + dim correct; resets on out.
- **Validation**: Hover several nodes; verify neighbor math vs `ARCH`.

### Task 3.2: Click-to-focus subgraph + camera framing + detail panel
- **Location**: `app.js`
- **Description**: On node `click`/`tap`: enter "focus mode" — isolate node +
  neighbors + their edges, reveal edge labels (`Konva.Text` on edge midpoints),
  dim everything else, ease the camera to frame the focused subgraph (instant
  under reduced-motion), and call the existing `openPanel(nodeId)`. Track focus
  state; clicking empty space or `Esc` exits focus, hides edge labels, and calls
  `closePanel`.
- **Dependencies**: 3.1, existing `openPanel`/`closePanel`
- **Acceptance Criteria**: Focus isolates the right subgraph; panel data matches;
  exit fully restores normal view.
- **Validation**: Click 3–4 nodes incl. high-degree ones; Esc + backdrop exits.

### Task 3.3: Drag-to-reposition with edge follow + session persistence
- **Location**: `app.js`
- **Description**: Make node groups `draggable`; on `dragmove`, recompute
  connected edge endpoints (and any visible edge labels) and `batchDraw`. Prevent
  the stage pan from firing during a node drag. On `dragend`, save positions to
  `sessionStorage` (key e.g. `archMapPositions`); on init, restore if present. A
  "Reset layout" action clears overrides and re-runs the computed layout.
- **Dependencies**: 1.4, 2.1
- **Acceptance Criteria**: Dragging moves only the node; edges track live; reload
  in same tab restores positions; reset restores computed layout.
- **Validation**: Drag a node, reload tab → persisted; reset → back to default.

---

## Sprint 4: Integration — scroll-sync, legend, light-theme parity

**Goal**: The canvas map plugs back into the rest of the page: the scroll
storytelling highlights the active layer **on the canvas**, the legend matches
the new edge styles, and colors match the light theme.

**Demo/Validation**:
- Scroll through the layer narrative → the matching band/nodes highlight on the
  canvas; scrolling away clears it.
- Legend swatches match on-canvas edge styles.
- Colors read correctly on the light background (no leftover dark-theme hexes).

### Task 4.1: Reimplement `window.mapAPI` against the canvas
- **Location**: `app.js`
- **Description**: Re-expose `window.mapAPI = { highlightLayer, clearHighlight }`
  where `highlightLayer(layerId)` spotlights that layer's nodes/band on the
  canvas (others dim) and `clearHighlight()` restores. Keep the same call
  signature so the Sprint-3 scroll-sync IIFE needs no change. When in canvas
  view, drive the canvas; in list view, drive the DOM fallback (existing behavior).
- **Dependencies**: 3.1
- **Acceptance Criteria**: Scroll storytelling highlights layers on the canvas;
  no errors when the map is off-screen.
- **Validation**: Scroll all 8 layers; confirm canvas highlight tracks.

### Task 4.2: On-canvas legend + edge styling parity
- **Location**: `app.js`, `styles.css`, `index.html`
- **Description**: Keep the existing HTML legend (or render an on-canvas legend)
  and make edge colors/dash for `primary|data|optional|dependency` match it.
  Source colors from light-theme CSS variables (read via
  `getComputedStyle(document.documentElement)`) rather than hard-coded
  dark-theme hexes (`#ffd166` etc.).
- **Dependencies**: 1.4
- **Acceptance Criteria**: Legend ↔ canvas edges consistent; colors are the
  light-theme palette.
- **Validation**: Visual diff legend vs edges per kind.

### Task 4.3: Inline bounded canvas + fullscreen "Expand" overlay
- **Location**: `index.html`, `styles.css`, `app.js`
- **Description**: Keep the inline canvas at a **bounded height** in the `#map`
  section (no sticky-column nesting — avoids scroll conflicts). Add an **"Expand"**
  control that opens a **fullscreen overlay** (`role="dialog"`, `aria-modal`,
  Esc/✕ to close, focus-trapped) hosting the same Konva stage at full viewport
  size for spacious exploration. On open/close, **re-parent or resize** the stage
  to the active container and re-`fit`. Restore scroll position + focus on close.
  Ensure the inline map and overlay never both drive the stage simultaneously.
- **Dependencies**: 4.1, 2.2
- **Acceptance Criteria**: Inline map has stable bounded height; Expand opens a
  fullscreen map; Esc/✕ closes and restores focus; no layout jump at 360 / 768 /
  1280 / 1440px.
- **Validation**: Open/close overlay repeatedly; resize while open; keyboard
  close; mobile check.

---

## Sprint 5: Accessibility, responsive, performance, offline, polish

**Goal**: Production finish — keyboard/SR users have a real path, touch works,
it's smooth, it works offline, and it's documented.

**Demo/Validation**: keyboard-only can reach every component's details via list
view; pinch/tap work; smooth on mid hardware; loads over `file://` offline;
README updated.

### Task 5.1: Accessible list-view fallback + announcements
- **Location**: `index.html`, `app.js`, `styles.css`
- **Description**: Canvas is `aria-hidden`; the **List view** (existing DOM map +
  the per-layer sections that already enumerate nodes/files) is the accessible
  equivalent and is reachable via the toggle and by keyboard. Add an
  `aria-live="polite"` status (e.g. "Focused: Agent Loop"). Ensure the detail
  panel remains fully keyboard-operable from list view.
- **Acceptance Criteria**: Keyboard-only user can open any node's details; SR
  announces focus changes; canvas not a keyboard trap.
- **Validation**: Keyboard sweep; VoiceOver/NVDA spot check; axe pass.

### Task 5.2: Responsive + touch polish
- **Location**: `styles.css`, `app.js`
- **Description**: Controls reachable and 44px+ on touch; map height adapts on
  small screens; on very small screens default to list view; pinch/tap verified.
- **Acceptance Criteria**: No overflow 360→1440px; all features reachable on touch.
- **Validation**: Device emulation across breakpoints.

### Task 5.3: Performance pass
- **Location**: `app.js`
- **Description**: `listening:false` on grid; `layer.batchDraw()` batching;
  consider `FastLayer`/`perfectDrawEnabled:false`/`shadowForStrokeEnabled:false`
  on hot shapes; cap `Konva.pixelRatio` on hi-dpi if needed; lazy-init the stage
  when `#map` first enters view (IntersectionObserver) to avoid upfront cost.
- **Acceptance Criteria**: Smooth pan/zoom/drag on mid-tier hardware; no jank.
- **Validation**: DevTools performance trace during pan/zoom.

### Task 5.4: Offline verification + README
- **Location**: `docs/architecture-site/README.md`, all files
- **Description**: Confirm the page (incl. canvas) works opening `index.html`
  over `file://` with network off (Konva vendored). Document the canvas map,
  controls, the view toggle, and the offline/vendored-Konva note.
- **Acceptance Criteria**: Full offline load works; README explains run/deploy +
  the Konva dependency and how to update it.
- **Validation**: Network-off `file://` load; proofread.

## Testing Strategy
- Per sprint: run the demo checklist; console clean; compare node/edge counts to
  `ARCH`.
- Cross-browser smoke: Chromium + Firefox + Safari (canvas + pinch).
- A11y (Sprint 5): keyboard-only sweep + axe/Lighthouse; list view parity.
- Offline (Sprint 5): `file://` with network disabled, Konva vendored.
- Regression: scroll storytelling still highlights layers (now on canvas);
  detail panel still opens with correct data.

## Potential Risks & Gotchas
- **Canvas accessibility**: `<canvas>` exposes nothing to the a11y tree. Mitigated
  by the **list-view fallback** (existing DOM map + layer sections) being the
  accessible source of truth + `aria-live` status. This is mandatory, not optional.
- **Offline vs library**: a CDN would break `file://`/offline. Mitigated by
  **vendoring** `konva.min.js` into `assets/`. Note the version + update steps in
  the README.
- **Wheel-zoom hijacks page scroll**: RESOLVED — zoom requires **Ctrl/⌘ + wheel**;
  plain wheel scrolls the page; pinch zooms on touch (Task 2.1).
- **Placement / sticky conflicts**: RESOLVED — inline **bounded** canvas + a
  **fullscreen "Expand" overlay** (Task 4.3) instead of nesting a tall canvas in
  the sticky two-column layout. Re-fit the stage on overlay open/close/resize.
- **Drag vs pan conflict**: a drag starting on a node must move the node, not pan
  the stage. Handle by disabling stage drag during node drag (and vice-versa).
- **HiDPI blurriness / perf**: rely on Konva pixelRatio; cap if perf suffers.
- **Reduced motion**: camera tweens and focus animations must be instant under
  `prefers-reduced-motion`.
- **Edge label clutter**: only show edge labels in focus mode, not globally.

## Rollback Plan
- The old SVG/DOM map is **retained as the fallback**, so reverting is low-risk:
  flip the feature flag / default the view to "list", or revert the canvas IIFE
  commit. Deleting `assets/konva.min.js` + the canvas IIFE restores the prior map
  exactly. All changes remain confined to `docs/architecture-site/`.
