# Agent Harness — Architecture Explorer

Single-screen, framework-free interactive map of the harness architecture.

- **Canvas**: Konva (vendored at `assets/konva.min.js`, offline-safe).
- **Model**: `data.js` → `window.ARCH` (layers, edges, flow). Single source of truth.
- **App**: `app.js` — one orchestrator (canvas, camera, highlight, layer-key, lifecycle, panel, list-view).
- **Run**: open `index.html` directly, or serve the folder (e.g. `npx serve docs/architecture-site`).

## Interactions

- Ctrl/⌘ + wheel to zoom · drag background to pan · drag a node to reposition (persists per tab).
- Layer-key chips highlight a layer and show its blurb.
- **Play lifecycle** animates a request across the same nodes.
- ☰ toggles an accessible list view; ⤢ goes fullscreen.
