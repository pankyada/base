# Design: Map-Centric Architecture Site

**Date**: 2026-06-27
**Status**: Approved
**Topic**: Reimagine the Agent Harness architecture explainer so the component map is the central feature, and eliminate content + code duplication.

## Problem

The current site (`docs/architecture-site/`) is a long scroll-narrative page with four independent IIFEs in `app.js` (~1449 lines). It carries two kinds of duplication:

1. **Content duplication.** The `#layers` section statically renders all 29 nodes (name, responsibility, files). The canvas map's click-to-detail panel already shows the same data plus the `detail` paragraph. The layers section is redundant.
2. **Code duplication.** `ACCENT_VAR` is defined twice; `buildLookups` / `nodeById` / `layerById` / `neighbours` are rebuilt three times (layers, map, lifecycle); `el` / `makeSet` / `svgEl` helpers are repeated across IIFEs. The lifecycle animation maintains a *second* node layout (a percentage-based horizontal strip with its own SVG + dot DOM) that mirrors the map.

The map is currently just one section among several. The goal is to make it the page.

## Decisions (locked with user)

- **`#layers` section**: removed entirely. The canvas + detail panel is the single source of truth for node info.
- **Map placement**: full-bleed hero — the map IS the landing surface, filling the first viewport.
- **Lifecycle**: folded into the main canvas. The request token animates across the same nodes; no separate mini-map.
- **Layer context**: a floating **layer-key rail** replaces the deleted section's navigation/narrative role (recommended option, approved).

## Approach

Transform the page from a scrolling document into a **single-screen interactive explorer**. The Konva canvas fills the viewport; all chrome (toolbar, layer key, edge legend, lifecycle transport, detail panel) overlays it. `app.js` collapses from four IIFEs into one orchestrator built on shared modules.

## Layout

```
┌─ top bar: ⚙ Agent Harness · "How it works" · stats(8 layers · 29 components · 10 steps) · [▶ Play lifecycle] ─┐
│                                                                                                                │
│  ┌─ layer    ╔═══════════════ FULL-BLEED CANVAS (fills viewport) ═══════════════╗   [ + − ⊡ ⤢ ] zoom toolbar │
│  │  key rail ║  8 layered bands · 29 nodes · 31 edges                           ║                            │
│  │  (chips)  ║                                                                  ║   → detail panel (on click)│
│  └─          ╚════════════════════════════════════════════════════════════════╝                            │
│                                                                                                                │
│  edge legend ──────────────  lifecycle transport + narration (overlay; expands on Play) ───────────────────  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

One screen. Footer is minimal or omitted.

## Components

### Top bar
Slim, translucent, sticky. Brand glyph + title + one-line tagline + inline stat chips (8 / 29 / 10) + a primary **Play lifecycle** button that starts the token animation.

### Canvas (centerpiece)
Unchanged Konva core, given the full viewport height. Behaviors preserved:
- Fit-to-view on load.
- Ctrl/⌘ + wheel zoom (plain wheel never hijacked).
- Drag background to pan.
- Drag node to reposition; edges follow; positions persisted to `sessionStorage`; Reset restores layout.
- Hover highlights a node + its neighbours, dims the rest.
- Click/tap a node opens the detail panel.

### Layer-key rail
Floating rail: left column on desktop, horizontal chip row on top for mobile. One chip per layer (8), colored by layer accent, labeled with the layer title. Interactions:
- Click a chip → highlight that layer's nodes on the canvas (reuses `mapAPI.highlightLayer`), dim others, and show the layer `blurb` in a small popover/tooltip.
- Click again or click empty canvas → clear.

This carries the narrative the deleted `#layers` section held, with zero node duplication.

### Lifecycle player (folded into canvas)
No separate stage. The transport overlay (restart / prev / play-pause / next / speed) sits bottom-center. On Play:
- The request token (a Konva shape on a dedicated overlay layer) tweens between the centers of the same canvas nodes, following `ARCH.flow`.
- The camera auto-frames each step (pan/zoom so the active edge is comfortably visible).
- The active node pulses; the current layer is highlighted via the existing highlight path.
- A narration line shows `Step N/10 — <label>` plus the step narrative.
- `prefers-reduced-motion`: token jumps instantly between nodes, camera snaps, no tweens.
- The scroll progress bar is repurposed as a **lifecycle progress** indicator (fills 0→100% across the 10 steps) or removed if it adds noise.

### Detail panel
Reuse the current focus-trapped `role="dialog"` panel: layer name, node name, responsibility, file chips, detail paragraph. Backdrop click / Esc / close button dismiss; focus returns to trigger.

### List-view fallback (accessibility)
Keep the existing list-view toggle as the screen-reader / keyboard-first equivalent of the canvas: layers as headings, nodes as a focusable list, each opening the detail panel. This is also the closest thing to a no-JS fallback (the site has always been JS-built from `data.js`).

## Code consolidation

`app.js` becomes a single IIFE / orchestrator composed of focused functions sharing one data model:

**Built once (shared):**
- `ACCENT_VAR` accent lookup.
- `buildLookups()` → `nodeById`, `layerById`, `neighbours`, `initPos`.
- helpers `el`, `makeSet` (drop `svgEl` — no more SVG overlays).

**Modules:**
- `canvas` — stage creation, band/edge/node rendering.
- `camera` — zoom, pan, fit, `frameNodes(ids)` (used by both layer-key and lifecycle).
- `interaction` — hover, click, drag + sessionStorage persistence.
- `highlight` — node-neighbourhood and per-layer highlight (one implementation, used by hover, layer-key, lifecycle).
- `lifecycle` — token tween + camera framing + narration, driven by `ARCH.flow`.
- `layerKey` — render chips, wire highlight + blurb popover.
- `panel` — detail panel open/close/focus-trap.
- `listView` — accessible fallback.

**Deleted:**
- `renderLayers` and the entire `#layers` rendering IIFE.
- The lifecycle stage/SVG/dot DOM builder (second node layout).
- Scroll-storytelling IIFE: mini-nav dots, scroll-sync IntersectionObserver, injected two-column sticky `.storytelling-layout` — all were anchored to the removed layer sections.

`data.js` is unchanged (the model is correct and already single-source). `index.html` is restructured to the single-screen shell. `styles.css` loses the layers/storytelling/old-lifecycle rules and gains the overlay-chrome layout.

## Data flow

`data.js` → `window.ARCH` (layers, edges, flow) → `buildLookups()` (one pass) → canvas render. User input (hover/click/drag), layer-key clicks, and the lifecycle player all funnel through the shared `highlight` + `camera` modules and read the one lookup set. The detail panel and list-view read `nodeById` / `layerById` directly.

## Error handling / degradation

- Guard on missing `Konva` or `window.ARCH`: render the list-view only, log nothing to the user beyond the existing `<noscript>` note.
- sessionStorage access wrapped in try/catch (already done).
- ResizeObserver drives stage resize; fullscreen toggle re-fits.

## Testing / validation

Manual via the preview server (the established loop):
- Canvas renders all 29 nodes + 31 edges; fit-to-view centers them.
- Zoom (Ctrl+wheel + toolbar), pan, drag-reposition + persistence + reset.
- Layer-key chip highlights the right nodes and shows the blurb.
- Play runs all 10 steps with camera framing, pulse, narration; prev/next/speed/restart work; reduced-motion jumps.
- Detail panel opens from canvas and list-view; focus trap + Esc.
- Responsive: mobile chip row + bottom-sheet transport; fullscreen expand.
- No console errors; offline (`file://`) still works (Konva vendored).

## Out of scope (YAGNI)

- No search / filter box beyond the layer key.
- No deep-linking to a node via URL hash.
- No minimap-within-minimap.
- No edits to `data.js` content.

## Rollback

Single-branch work (`worktree-architecture-site`). Revert the redesign commit to restore the current multi-section page. `data.js` untouched, so the model is safe regardless.
