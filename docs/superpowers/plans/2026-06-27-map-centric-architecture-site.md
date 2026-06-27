# Map-Centric Architecture Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimagine `docs/architecture-site/` as a single-screen interactive explorer where the Konva component map is the full-bleed centerpiece, the static `#layers` section is gone, the lifecycle animates on the same canvas, and `app.js`'s four IIFEs collapse into one de-duplicated orchestrator.

**Architecture:** One Konva stage fills the viewport. All chrome (top bar, layer-key rail, edge legend, lifecycle transport, detail panel, list-view) overlays it. `app.js` becomes a single IIFE composed of focused modules sharing one data model (`buildLookups` run once). `data.js` is unchanged.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step, Konva 9 (vendored at `assets/konva.min.js`), verified via the Claude Preview server (`architecture-site`, port 8765).

---

## Spec

Design: `docs/superpowers/specs/2026-06-27-map-centric-architecture-site-design.md`

## Verification model

There is no unit-test runner for this site. Each task's verification uses the preview loop:
- `preview_start` name `architecture-site` (reuses if running).
- `preview_eval` with `location.reload()` then DOM/state assertions returning JSON.
- `preview_console_logs` level `error` → must be empty.
- `preview_screenshot` for visual confirmation.

Treat "Expected" blocks as the pass criteria. Commit only when they hold and console errors are empty.

## File structure

| File | Responsibility after this plan |
|------|--------------------------------|
| `docs/architecture-site/index.html` | Single-screen shell: top bar, canvas wrap, overlay containers (layer key, legend, transport), detail panel, list-view. No `#layers`, no separate lifecycle section. |
| `docs/architecture-site/data.js` | **Unchanged.** `window.ARCH` model. |
| `docs/architecture-site/app.js` | One orchestrator IIFE: shared lookups/accent/helpers + modules (canvas, camera, interaction, highlight, lifecycle, layerKey, panel, listView). |
| `docs/architecture-site/styles.css` | Shell + overlay-chrome layout. Layers/storytelling/old-lifecycle rules removed. |
| `docs/architecture-site/assets/konva.min.js` | **Unchanged.** Vendored Konva. |

---

## Sprint 1: Single-screen shell + consolidated orchestrator (canvas works, old sections gone)

**Goal:** The page is a full-bleed canvas with working zoom/pan/drag/hover/detail-panel/list-view, driven by a single IIFE. `#layers`, the separate lifecycle strip, and scroll-storytelling are deleted.

**Demo/Validation:** Load the page → the canvas fills the viewport under a slim top bar; all 29 nodes + 31 edges render; zoom/pan/drag/panel/list all work; no console errors; `app.js` has exactly one top-level IIFE.

### Task 1.1: Restructure `index.html` to the single-screen shell

**Files:**
- Modify: `docs/architecture-site/index.html`

- [ ] **Step 1: Replace the `<body>` content (hero + main + footer) with the single-screen shell.**

Keep `<head>` as-is except the `theme-color` and favicon (already light-themed). Replace everything from `<body>` to `</body>` with:

```html
<body>
  <noscript>
    <p class="noscript-note">
      This page renders an interactive canvas with JavaScript. Enable JS to explore the
      Agent Harness map, or read the model in <code>docs/architecture-site/data.js</code>.
    </p>
  </noscript>

  <!-- Top bar -->
  <header class="top-bar">
    <a class="brand" href="#top" aria-label="Agent Harness — home">
      <span class="glyph" aria-hidden="true">⚙</span>
      <span class="brand-text">Agent Harness</span>
      <span class="brand-sub">How it works</span>
    </a>
    <div class="top-stats" aria-label="At a glance">
      <span class="tstat"><b id="stat-layers">8</b> layers</span>
      <span class="tstat"><b id="stat-nodes">29</b> components</span>
      <span class="tstat"><b id="stat-flow">10</b> steps</span>
    </div>
    <div class="top-actions">
      <button class="btn-play" id="lc-play-main" aria-label="Play the request lifecycle">
        <span class="play-ico" aria-hidden="true">▶</span> Play lifecycle
      </button>
    </div>
  </header>

  <!-- Full-bleed explorer -->
  <main class="explorer" id="top">
    <!-- Canvas stage -->
    <div class="stage-wrap" id="map-stage-wrap">
      <div class="map-fs-bar" id="map-fs-bar">
        <span>Component Map — fullscreen</span>
        <button class="map-tb-btn" id="map-fs-close" aria-label="Exit fullscreen">×</button>
      </div>
      <div id="map-stage"></div>
    </div>

    <!-- Layer-key rail -->
    <nav class="layer-key" id="layer-key" aria-label="Layers"></nav>

    <!-- Zoom toolbar -->
    <div class="map-toolbar" role="toolbar" aria-label="Map controls">
      <button class="map-tb-btn" id="map-zoom-in"  aria-label="Zoom in"  title="Zoom in">+</button>
      <button class="map-tb-btn" id="map-zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
      <button class="map-tb-btn" id="map-fit"      aria-label="Fit to view" title="Fit to view">⊡</button>
      <span class="map-zoom-label" id="map-zoom-label" aria-live="polite">100%</span>
      <span class="map-tb-sep" aria-hidden="true"></span>
      <button class="map-tb-btn" id="map-reset-layout" aria-label="Reset node positions" title="Reset layout">↺</button>
      <button class="map-tb-btn" id="map-list-toggle"  aria-label="Show as list" aria-pressed="false" title="Toggle list view">☰</button>
      <button class="map-tb-btn map-tb-expand" id="map-expand" aria-label="Expand to fullscreen" title="Fullscreen">⤢</button>
    </div>

    <!-- Edge legend -->
    <div class="map-legend" role="list" aria-label="Edge legend">
      <span class="map-legend-item" role="listitem"><svg width="26" height="8" aria-hidden="true"><line x1="2" y1="4" x2="24" y2="4" stroke="#d97706" stroke-width="2"/></svg>Primary</span>
      <span class="map-legend-item" role="listitem"><svg width="26" height="8" aria-hidden="true"><line x1="2" y1="4" x2="24" y2="4" stroke="#059669" stroke-width="2" stroke-dasharray="4 3"/></svg>Data</span>
      <span class="map-legend-item" role="listitem"><svg width="26" height="8" aria-hidden="true"><line x1="2" y1="4" x2="24" y2="4" stroke="#0284c7" stroke-width="1.5" stroke-dasharray="2 3"/></svg>Optional</span>
      <span class="map-legend-item" role="listitem"><svg width="26" height="8" aria-hidden="true"><line x1="2" y1="4" x2="24" y2="4" stroke="#db2777" stroke-width="1.5"/><polygon points="22,1 26,4 22,7" fill="#db2777"/></svg>Dependency</span>
    </div>

    <!-- Lifecycle transport (hidden until Play) -->
    <div class="lc-transport" id="lc-transport" role="group" aria-label="Lifecycle controls" data-active="false">
      <div class="lc-progress" id="lc-progress" aria-hidden="true"><span></span></div>
      <div class="lc-narration">
        <span class="lc-step" id="lc-step-num">Step 1 / 10</span>
        <p class="lc-text" id="lc-text" aria-live="polite"></p>
      </div>
      <div class="lc-buttons">
        <button class="lc-btn" id="lc-restart" aria-label="Restart">⟳</button>
        <button class="lc-btn" id="lc-prev" aria-label="Previous step">‹</button>
        <button class="lc-btn lc-play" id="lc-play" aria-label="Play">▶</button>
        <button class="lc-btn" id="lc-next" aria-label="Next step">›</button>
        <button class="lc-btn lc-speed" id="lc-speed" aria-label="Speed">1×</button>
      </div>
    </div>

    <!-- Accessible list-view fallback -->
    <div class="map-list-view" id="map-list-view" aria-label="Component list" hidden></div>
  </main>

  <!-- Detail panel (dialog) -->
  <div class="map-backdrop" id="map-backdrop" aria-hidden="true"></div>
  <aside id="map-panel" class="map-panel" role="dialog" aria-modal="true" aria-labelledby="panel-node-name" aria-hidden="true">
    <button class="panel-close" id="panel-close" aria-label="Close panel">×</button>
    <div class="panel-body">
      <p class="panel-layer-name" id="panel-layer-name"></p>
      <h3 class="panel-node-name" id="panel-node-name"></h3>
      <p class="panel-responsibility" id="panel-responsibility"></p>
      <div class="panel-files" id="panel-files"></div>
      <p class="panel-detail" id="panel-detail"></p>
    </div>
  </aside>

  <!-- Layer blurb popover (positioned by JS near a layer-key chip) -->
  <div class="layer-pop" id="layer-pop" role="status" aria-live="polite" hidden></div>

  <!-- Scripts: konva, data, app -->
  <script src="assets/konva.min.js"></script>
  <script src="data.js"></script>
  <script src="app.js"></script>
</body>
```

- [ ] **Step 2: Verify the markup loads (canvas will be wired in 1.2–1.5; expect a blank stage for now).**

Run preview: `preview_start` `architecture-site`, then `preview_eval`: `location.reload(); document.querySelectorAll('#map-stage, #layer-key, #lc-transport, #map-panel').length`
Expected: `4`. No requirement on canvas content yet.

- [ ] **Step 3: Commit.**

```bash
git add docs/architecture-site/index.html
git commit -m "feat(architecture-site): single-screen shell markup"
```

### Task 1.2: Rewrite `app.js` head — single IIFE with shared lookups, accent, helpers

**Files:**
- Modify: `docs/architecture-site/app.js` (full replacement across the plan; this task writes the shared core + boot guard and leaves module stubs that 1.3–1.5 fill)

- [ ] **Step 1: Replace the entire contents of `app.js` with the shared core + boot scaffold.**

This deletes all four existing IIFEs. The canvas/camera/panel/interaction functions are filled in 1.3–1.5; this step establishes the single data model built once.

```javascript
/* app.js — Agent Harness architecture explorer (single orchestrator).
 * Classic script (no modules). Depends on window.ARCH (data.js) and Konva (assets/konva.min.js).
 * One IIFE, one data model, shared modules: canvas, camera, interaction,
 * highlight, lifecycle, layerKey, panel, listView.
 */
(function () {
  "use strict";

  var arch = window.ARCH;
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── shared helpers ────────────────────────────────────────────
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }
  function makeSet() {
    return typeof Set !== "undefined" ? new Set()
      : { _a: [], has: function (v) { return this._a.indexOf(v) !== -1; }, add: function (v) { if (!this.has(v)) this._a.push(v); } };
  }

  // ── layout constants ──────────────────────────────────────────
  var VIRT_W = 2400, BAND_H = 200, VPAD_TOP = 90, VPAD_BOT = 80, HPAD = 150;
  var NODE_W = 162, NODE_H = 56, NODE_R = 9, NODE_Y_BAND = 112;
  var VIRT_H = VPAD_TOP + (arch ? arch.layers.length : 0) * BAND_H + VPAD_BOT;
  var MIN_SCALE = 0.12, MAX_SCALE = 4;

  // ── shared edge styles ────────────────────────────────────────
  var ESTYLE = {
    primary:    { stroke: "#d97706", width: 2,   dash: [] },
    data:       { stroke: "#059669", width: 1.5, dash: [8, 5] },
    optional:   { stroke: "#0284c7", width: 1.5, dash: [3, 4] },
    dependency: { stroke: "#db2777", width: 1.5, dash: [] }
  };

  // ── shared lookups (built once) ───────────────────────────────
  var nodeById = {}, layerById = {}, initPos = {}, neighbours = {}, allNodeIds = [];

  function buildLookups() {
    arch.layers.forEach(function (layer, li) {
      var bandTop = VPAD_TOP + li * BAND_H, n = layer.nodes.length;
      layer.nodes.forEach(function (node, ni) {
        nodeById[node.id] = node;
        layerById[node.id] = layer;
        allNodeIds.push(node.id);
        neighbours[node.id] = makeSet();
        var avail = VIRT_W - 2 * HPAD;
        initPos[node.id] = {
          x: n > 1 ? HPAD + (ni / (n - 1)) * avail : VIRT_W / 2,
          y: bandTop + NODE_Y_BAND
        };
      });
    });
    arch.edges.forEach(function (e) {
      neighbours[e.from].add(e.to);
      neighbours[e.to].add(e.from);
    });
  }

  // ── module state (filled by canvas/camera/etc. in later tasks) ─
  var stage, bgLayer, edgeLayer, nodeLayer, tokenLayer;
  var nodeGroups = {};   // nodeId → Konva.Group
  var edgeShapes = [];   // [{ line, fromId, toId, kind }]
  var currentScale = 1;

  // ── stats ─────────────────────────────────────────────────────
  function setStats() {
    var map = { "stat-layers": arch.layers.length, "stat-nodes": allNodeIds.length, "stat-flow": arch.flow.length };
    Object.keys(map).forEach(function (id) { var e = document.getElementById(id); if (e) e.textContent = String(map[id]); });
  }

  // ===== CANVAS (Task 1.3) =====
  // createStage, renderBands, renderEdges, renderNodes, nodeCenter, updateEdgesForNode, updateAllEdges

  // ===== CAMERA (Task 1.3) =====
  // clampScale, zoomAround, fitToView, frameNodes, updateZoomLabel, wireZoom, wirePan, resizeStage, scheduleResize

  // ===== HIGHLIGHT (Task 1.4) =====
  // highlightNode, highlightLayer, clearHighlight

  // ===== INTERACTION (Task 1.4) =====
  // node events wired in renderNodes; wireToolbar, wireFullscreen, drag persistence

  // ===== PANEL (Task 1.4) =====
  // openPanel, closePanel, focus trap

  // ===== LIST VIEW (Task 1.4) =====
  // buildListView, wireListToggle

  // ===== LAYER KEY (Task 2.1) =====
  // buildLayerKey

  // ===== LIFECYCLE (Task 3.x) =====
  // buildToken, lifecycle player

  // ── sessionStorage drag persistence ───────────────────────────
  var STORE_KEY = "hm-pos";
  function saveDragPositions() {
    var out = {};
    Object.keys(nodeGroups).forEach(function (id) { var g = nodeGroups[id]; out[id] = { x: g.x(), y: g.y() }; });
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch (ex) {}
  }
  function loadDragPositions() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY); if (!raw) return;
      var pos = JSON.parse(raw);
      Object.keys(pos).forEach(function (id) { var g = nodeGroups[id]; if (g) { g.x(pos[id].x); g.y(pos[id].y); } });
      updateAllEdges(); nodeLayer.batchDraw(); edgeLayer.batchDraw();
    } catch (ex) {}
  }

  // ── public API for cross-module use (lifecycle/layerKey) ───────
  window.mapAPI = {
    highlightLayer: function (id) { if (stage) { highlightLayer(id); stage.batchDraw(); } },
    clearHighlight: function () { if (stage) { clearHighlight(); stage.batchDraw(); } }
  };

  // ── boot ──────────────────────────────────────────────────────
  function init() {
    if (!arch || !Array.isArray(arch.layers)) return;
    buildLookups();
    setStats();
    buildListView();        // works without Konva (accessible fallback)
    wireListToggle();
    wirePanel();
    if (typeof Konva === "undefined") return;  // canvas optional; list-view remains
    if (!createStage()) return;
    renderBands(); renderEdges(); renderNodes();
    bgLayer.batchDraw(); edgeLayer.batchDraw(); nodeLayer.batchDraw();
    loadDragPositions();
    fitToView();
    wireZoom(); wirePan(); wireToolbar(); wireFullscreen();
    buildLayerKey();        // Task 2.1
    initLifecycle();        // Task 3.x
    scheduleResize();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
```

- [ ] **Step 2: Do not reload yet — functions are stubs.** Proceed to 1.3. (This step is a checkpoint, no command.)

### Task 1.3: Port canvas + camera into the orchestrator

**Files:**
- Modify: `docs/architecture-site/app.js`

These functions already exist and work in the pre-redesign map IIFE (commit `66c524a`). Port them **verbatim** into the marked `===== CANVAS =====` and `===== CAMERA =====` regions, with the small deltas listed. They reference the shared `stage/bgLayer/edgeLayer/nodeLayer/nodeGroups/edgeShapes/initPos/ESTYLE/layerById` already declared in 1.2.

- [ ] **Step 1: Insert the CANVAS functions.**

Paste these implementations (identical to the working versions, plus a `tokenLayer` added in `createStage` for the lifecycle token, and node event handlers that call `highlightNode`/`openPanel` defined in 1.4):

```javascript
  function createStage() {
    var wrap = document.getElementById("map-stage-wrap");
    if (!wrap) return false;
    var fsBar = document.getElementById("map-fs-bar");
    var fsH = (fsBar && fsBar.offsetHeight > 0) ? fsBar.offsetHeight : 0;
    var w = wrap.offsetWidth || 900;
    var h = Math.max((wrap.offsetHeight || 600) - fsH, 320);
    stage = new Konva.Stage({ container: "map-stage", width: w, height: h });
    bgLayer = new Konva.Layer({ listening: false });
    edgeLayer = new Konva.Layer({ listening: false });
    nodeLayer = new Konva.Layer();
    tokenLayer = new Konva.Layer({ listening: false });
    stage.add(bgLayer, edgeLayer, nodeLayer, tokenLayer);
    return true;
  }

  function renderBands() {
    arch.layers.forEach(function (layer, li) {
      var bandTop = VPAD_TOP + li * BAND_H;
      if (li % 2 === 0) bgLayer.add(new Konva.Rect({ x: 0, y: bandTop, width: VIRT_W, height: BAND_H, fill: "rgba(0,0,0,0.016)", listening: false }));
      if (li > 0) bgLayer.add(new Konva.Line({ points: [0, bandTop, VIRT_W, bandTop], stroke: "rgba(0,0,0,0.055)", strokeWidth: 1, listening: false }));
      bgLayer.add(new Konva.Text({ x: 14, y: bandTop + BAND_H / 2 - 8, text: (li + 1) + ". " + layer.title, fontSize: 12, fontFamily: "Space Grotesk, system-ui, sans-serif", fill: layer.accent || "#888", opacity: 0.6, listening: false }));
    });
  }

  function renderEdges() {
    arch.edges.forEach(function (edge) {
      var s = ESTYLE[edge.kind] || ESTYLE.primary;
      var fp = initPos[edge.from], tp = initPos[edge.to];
      if (!fp || !tp) return;
      var line = new Konva.Line({ points: [fp.x, fp.y, tp.x, tp.y], stroke: s.stroke, strokeWidth: s.width, dash: s.dash, opacity: 0.48, lineCap: "round", listening: false });
      edgeLayer.add(line);
      edgeShapes.push({ line: line, fromId: edge.from, toId: edge.to, kind: edge.kind });
    });
  }

  function renderNodes() {
    arch.layers.forEach(function (layer) {
      var acc = layer.accent || "#4cc9f0";
      layer.nodes.forEach(function (node) {
        var cp = initPos[node.id];
        var grp = new Konva.Group({ x: cp.x - NODE_W / 2, y: cp.y - NODE_H / 2, draggable: true, id: "ng-" + node.id });
        grp.add(new Konva.Rect({ x: 2, y: 3, width: NODE_W, height: NODE_H, cornerRadius: NODE_R, fill: "rgba(0,0,0,0.09)", listening: false }));
        grp.add(new Konva.Rect({ name: "main-rect", x: 0, y: 0, width: NODE_W, height: NODE_H, cornerRadius: NODE_R, fill: "#ffffff", stroke: acc, strokeWidth: 1.5 }));
        grp.add(new Konva.Rect({ x: 0, y: 0, width: 5, height: NODE_H, cornerRadius: [NODE_R, 0, 0, NODE_R], fill: acc, listening: false }));
        grp.add(new Konva.Text({ x: 12, y: NODE_H / 2 - 8, width: NODE_W - 18, text: node.name, fontSize: 12, fontFamily: "Space Grotesk, system-ui, sans-serif", fontStyle: "bold", fill: "#0d0f22", ellipsis: true, listening: false }));
        nodeGroups[node.id] = grp;
        nodeLayer.add(grp);
        grp.on("dragmove", function () { updateEdgesForNode(node.id); });
        grp.on("dragend", function () { saveDragPositions(); });
        grp.on("mouseenter", function () { document.body.style.cursor = "pointer"; highlightNode(node.id); stage.batchDraw(); });
        grp.on("mouseleave", function () { document.body.style.cursor = ""; if (!panelOpen && !lcPlaying) { clearHighlight(); stage.batchDraw(); } });
        grp.on("click tap", function () { openPanel(node.id); });
      });
    });
  }

  function nodeCenter(id) {
    var g = nodeGroups[id];
    return g ? { x: g.x() + NODE_W / 2, y: g.y() + NODE_H / 2 } : (initPos[id] || { x: 0, y: 0 });
  }
  function updateEdgesForNode(id) {
    edgeShapes.forEach(function (e) {
      if (e.fromId !== id && e.toId !== id) return;
      var f = nodeCenter(e.fromId), t = nodeCenter(e.toId);
      e.line.points([f.x, f.y, t.x, t.y]);
    });
    edgeLayer.batchDraw();
  }
  function updateAllEdges() {
    edgeShapes.forEach(function (e) { var f = nodeCenter(e.fromId), t = nodeCenter(e.toId); e.line.points([f.x, f.y, t.x, t.y]); });
  }
```

- [ ] **Step 2: Insert the CAMERA functions** (adds `frameNodes`, used later by layer-key and lifecycle):

```javascript
  function clampScale(s) { return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)); }

  function zoomAround(factor, pivot) {
    var oldS = stage.scaleX(), newS = clampScale(oldS * factor), pos = stage.position();
    stage.scale({ x: newS, y: newS });
    stage.position({ x: pivot.x - (pivot.x - pos.x) * newS / oldS, y: pivot.y - (pivot.y - pos.y) * newS / oldS });
    currentScale = newS; updateZoomLabel(); stage.batchDraw();
  }

  function fitToView() {
    if (!stage) return;
    var w = stage.width(), h = stage.height();
    var s = clampScale(Math.min(w / VIRT_W, h / VIRT_H) * 0.92);
    stage.scale({ x: s, y: s });
    stage.position({ x: (w - VIRT_W * s) / 2, y: (h - VIRT_H * s) / 2 });
    currentScale = s; updateZoomLabel(); stage.batchDraw();
  }

  // Frame a set of node ids into view with padding; animates unless reduced motion.
  function frameNodes(ids, pad) {
    if (!stage || !ids.length) return;
    pad = pad == null ? 120 : pad;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach(function (id) {
      var c = nodeCenter(id);
      minX = Math.min(minX, c.x - NODE_W / 2); maxX = Math.max(maxX, c.x + NODE_W / 2);
      minY = Math.min(minY, c.y - NODE_H / 2); maxY = Math.max(maxY, c.y + NODE_H / 2);
    });
    var bw = (maxX - minX) + pad * 2, bh = (maxY - minY) + pad * 2;
    var w = stage.width(), h = stage.height();
    var s = clampScale(Math.min(w / bw, h / bh, MAX_SCALE));
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var tx = w / 2 - cx * s, ty = h / 2 - cy * s;
    currentScale = s; updateZoomLabel();
    if (REDUCED) { stage.scale({ x: s, y: s }); stage.position({ x: tx, y: ty }); stage.batchDraw(); return; }
    stage.to({ scaleX: s, scaleY: s, x: tx, y: ty, duration: 0.45, easing: Konva.Easings.EaseInOut });
  }

  function updateZoomLabel() { var e = document.getElementById("map-zoom-label"); if (e) e.textContent = Math.round(currentScale * 100) + "%"; }

  function wireZoom() {
    stage.on("wheel", function (e) {
      var ev = e.evt;
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      zoomAround(ev.deltaY < 0 ? 1.12 : (1 / 1.12), stage.getPointerPosition());
    });
  }

  function wirePan() {
    var panning = false, last = null;
    stage.on("mousedown touchstart", function (e) { if (e.target !== stage) return; panning = true; var p = stage.getPointerPosition(); last = { x: p.x, y: p.y }; document.body.style.cursor = "grabbing"; });
    stage.on("mousemove touchmove", function () { if (!panning || !last) return; var p = stage.getPointerPosition(); if (!p) return; stage.position({ x: stage.x() + p.x - last.x, y: stage.y() + p.y - last.y }); last = p; stage.batchDraw(); });
    stage.on("mouseup touchend mouseleave", function () { if (panning) { panning = false; last = null; if (document.body.style.cursor === "grabbing") document.body.style.cursor = ""; } });
  }

  function resizeStage() {
    var wrap = document.getElementById("map-stage-wrap"); if (!wrap || !stage) return;
    var fsBar = document.getElementById("map-fs-bar");
    var fsH = (fsBar && fsBar.offsetHeight > 0) ? fsBar.offsetHeight : 0;
    stage.width(wrap.offsetWidth); stage.height(Math.max(wrap.offsetHeight - fsH, 320)); stage.batchDraw();
  }
  function scheduleResize() {
    var wrap = document.getElementById("map-stage-wrap"); if (!wrap) return;
    var pending = false;
    function onResize() { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; resizeStage(); }); }
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(onResize).observe(wrap);
    else window.addEventListener("resize", onResize);
  }
```

- [ ] **Step 3: Checkpoint (no reload — `highlightNode`/`openPanel`/`wireToolbar` still pending in 1.4).**

### Task 1.4: Port highlight, interaction, panel, list-view

**Files:**
- Modify: `docs/architecture-site/app.js`

- [ ] **Step 1: Insert HIGHLIGHT functions** (single implementation reused by hover, layer-key, lifecycle):

```javascript
  function highlightNode(activeId) {
    var nbrs = {};
    arch.edges.forEach(function (e) { if (e.from === activeId) nbrs[e.to] = true; if (e.to === activeId) nbrs[e.from] = true; });
    Object.keys(nodeGroups).forEach(function (id) {
      var g = nodeGroups[id], r = g.findOne(".main-rect"), lyr = layerById[id];
      if (id === activeId) { r.shadowBlur(20); r.shadowColor(lyr ? lyr.accent : "#d97706"); r.shadowOpacity(0.55); g.opacity(1); }
      else if (nbrs[id]) { r.shadowBlur(10); r.shadowColor(lyr ? lyr.accent : "#888"); r.shadowOpacity(0.3); g.opacity(0.92); }
      else { r.shadowBlur(0); r.shadowOpacity(0); g.opacity(0.2); }
    });
    edgeShapes.forEach(function (e) {
      var s = ESTYLE[e.kind] || ESTYLE.primary;
      if (e.fromId === activeId || e.toId === activeId) { e.line.opacity(0.95); e.line.strokeWidth(s.width + 1); }
      else { e.line.opacity(0.06); e.line.strokeWidth(s.width); }
    });
  }

  function highlightLayer(layerId) {
    var lnodes = {};
    arch.layers.forEach(function (l) { if (l.id === layerId) l.nodes.forEach(function (n) { lnodes[n.id] = true; }); });
    Object.keys(nodeGroups).forEach(function (id) {
      var g = nodeGroups[id], r = g.findOne(".main-rect"), lyr = layerById[id];
      if (lnodes[id]) { r.shadowBlur(14); r.shadowColor(lyr ? lyr.accent : "#d97706"); r.shadowOpacity(0.45); g.opacity(1); }
      else { r.shadowBlur(0); r.shadowOpacity(0); g.opacity(0.18); }
    });
    edgeShapes.forEach(function (e) { e.line.opacity(lnodes[e.fromId] && lnodes[e.toId] ? 0.85 : 0.05); });
    nodeLayer.batchDraw(); edgeLayer.batchDraw();
  }

  function clearHighlight() {
    Object.keys(nodeGroups).forEach(function (id) { var g = nodeGroups[id], r = g.findOne(".main-rect"); r.shadowBlur(0); r.shadowOpacity(0); g.opacity(1); });
    edgeShapes.forEach(function (e) { e.line.opacity(0.48); e.line.strokeWidth((ESTYLE[e.kind] || ESTYLE.primary).width); });
    nodeLayer.batchDraw(); edgeLayer.batchDraw();
  }
```

- [ ] **Step 2: Insert INTERACTION — toolbar + fullscreen:**

```javascript
  function wireToolbar() {
    function center() { return { x: stage.width() / 2, y: stage.height() / 2 }; }
    function $(id) { return document.getElementById(id); }
    var zi = $("map-zoom-in"), zo = $("map-zoom-out"), fit = $("map-fit"), rl = $("map-reset-layout");
    if (zi) zi.addEventListener("click", function () { zoomAround(1.25, center()); });
    if (zo) zo.addEventListener("click", function () { zoomAround(1 / 1.25, center()); });
    if (fit) fit.addEventListener("click", fitToView);
    if (rl) rl.addEventListener("click", function () {
      Object.keys(nodeGroups).forEach(function (id) { var g = nodeGroups[id], p = initPos[id]; g.x(p.x - NODE_W / 2); g.y(p.y - NODE_H / 2); });
      updateAllEdges(); nodeLayer.batchDraw(); edgeLayer.batchDraw();
      try { sessionStorage.removeItem(STORE_KEY); } catch (ex) {}
    });
  }

  var isFullscreen = false;
  function wireFullscreen() {
    var wrap = document.getElementById("map-stage-wrap"), expBtn = document.getElementById("map-expand"), closeFs = document.getElementById("map-fs-close");
    function toggle(open) {
      isFullscreen = open;
      if (wrap) wrap.classList.toggle("is-fullscreen", open);
      document.body.classList.toggle("map-fs-active", open);
      if (expBtn) { expBtn.setAttribute("aria-label", open ? "Exit fullscreen" : "Expand to fullscreen"); expBtn.textContent = open ? "⊠" : "⤢"; }
      window.setTimeout(function () { resizeStage(); fitToView(); }, 60);
    }
    if (expBtn) expBtn.addEventListener("click", function () { toggle(!isFullscreen); });
    if (closeFs) closeFs.addEventListener("click", function () { toggle(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && isFullscreen) toggle(false); });
  }
```

- [ ] **Step 3: Insert PANEL functions** (focus-trapped dialog; `panelOpen` is read by `renderNodes` mouseleave):

```javascript
  var panelOpen = false;
  function openPanel(nodeId) {
    var node = nodeById[nodeId], layer = layerById[nodeId];
    if (!node || !layer) return;
    document.getElementById("panel-layer-name").textContent = layer.title;
    document.getElementById("panel-node-name").textContent = node.name;
    document.getElementById("panel-responsibility").textContent = node.responsibility || "";
    document.getElementById("panel-detail").textContent = node.detail || "";
    var filesEl = document.getElementById("panel-files"); filesEl.innerHTML = "";
    var files = (node.files && node.files.length) ? node.files : ["external — no source file"];
    files.forEach(function (f) { var c = document.createElement("code"); c.textContent = f; filesEl.appendChild(c); });
    var p = document.getElementById("map-panel"), bd = document.getElementById("map-backdrop");
    if (p) { p.classList.add("is-open"); p.setAttribute("aria-hidden", "false"); }
    if (bd) bd.classList.add("is-open");
    panelOpen = true;
    var cb = document.getElementById("panel-close"); if (cb) cb.focus();
  }
  function closePanel() {
    var p = document.getElementById("map-panel"), bd = document.getElementById("map-backdrop");
    if (p) { p.classList.remove("is-open"); p.setAttribute("aria-hidden", "true"); }
    if (bd) bd.classList.remove("is-open");
    panelOpen = false;
    if (stage && !lcPlaying) { clearHighlight(); stage.batchDraw(); }
  }
  function wirePanel() {
    var cb = document.getElementById("panel-close"), bd = document.getElementById("map-backdrop");
    if (cb) cb.addEventListener("click", closePanel);
    if (bd) bd.addEventListener("click", closePanel);
    document.addEventListener("keydown", function (e) {
      if (!panelOpen) return;
      var p = document.getElementById("map-panel"); if (!p) return;
      var items = Array.prototype.slice.call(p.querySelectorAll('button,[href],input,[tabindex]:not([tabindex="-1"])'));
      if (!items.length) return;
      if (e.key === "Escape") { e.preventDefault(); closePanel(); return; }
      if (e.key === "Tab") {
        var first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
```

- [ ] **Step 4: Insert LIST-VIEW functions:**

```javascript
  function buildListView() {
    var lv = document.getElementById("map-list-view"); if (!lv) return;
    arch.layers.forEach(function (layer) {
      var sec = el("div", "mlv-layer");
      var h = el("h4", "mlv-title", layer.title); h.style.color = layer.accent || "";
      sec.appendChild(h);
      var ul = el("ul", "mlv-nodes");
      layer.nodes.forEach(function (node) {
        var li = el("li", "mlv-node"); li.tabIndex = 0;
        li.innerHTML = "<strong>" + node.name + "</strong> — " + (node.responsibility || "");
        li.addEventListener("click", function () { openPanel(node.id); });
        li.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPanel(node.id); } });
        ul.appendChild(li);
      });
      sec.appendChild(ul); lv.appendChild(sec);
    });
  }
  function wireListToggle() {
    var btn = document.getElementById("map-list-toggle"), wrap = document.getElementById("map-stage-wrap"), lv = document.getElementById("map-list-view");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var showList = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(showList));
      if (wrap) wrap.style.visibility = showList ? "hidden" : "";
      if (lv) lv.hidden = !showList;
    });
  }
```

- [ ] **Step 5: Add temporary no-op stubs so `init()` runs before Tasks 2–3 land.**

Add near the other module regions (these are replaced in later tasks):

```javascript
  function buildLayerKey() {}
  function initLifecycle() {}
  var lcPlaying = false;
```

- [ ] **Step 6: Reload and verify the canvas + interactions.**

`preview_eval`: `location.reload()` then after ~400ms:
`(function(){var s=Konva.stages[0];return {canvases:document.querySelectorAll('#map-stage canvas').length, nodes:Object.keys(s? s.find('Group'):[]).length>0, zoom:document.getElementById('map-zoom-label').textContent};})()`
Expected: `canvases` ≥ 3, zoom label like `"NN%"`.
`preview_console_logs` level error → empty.
`preview_screenshot` → full-bleed canvas with 29 nodes under the top bar.

- [ ] **Step 7: Commit.**

```bash
git add docs/architecture-site/app.js
git commit -m "feat(architecture-site): consolidate app.js into single canvas orchestrator"
```

### Task 1.5: Rewrite `styles.css` — shell + overlay layout, remove dead rules

**Files:**
- Modify: `docs/architecture-site/styles.css`

- [ ] **Step 1: Delete the now-dead rule blocks.**

Remove these sections wholesale (selectors no longer in the DOM): `.hero*`, `.layers`, `.layer`, `.layer-*`, `.nodes`, `.node*` (the layer-card node styles — keep `.map-node-*` if any remain? there are none now), `.section-head`, `.map-section`, `.map-canvas`, `.map-band*`, `.map-edges-svg`, `.map-edge`, `.storytelling-layout`, `.layer-mini-nav`, `.mini-nav-dot`, `#scroll-progress`, `.lifecycle-section`, `.lc-node-dot`, `.lc-node-label`, `.lc-path-*`, `.lc-token` (old strip token), `.lifecycle-stage`, `.lifecycle-narration`, `.narration-*`, `.lifecycle-controls`, `.lifecycle-steps-list`, `#lifecycle-steps-ol`, `.placeholder*`.

Keep: design tokens (`:root`), reset/base, `body::before/::after`, `.map-toolbar`, `.map-tb-*`, `.map-zoom-label`, `.map-stage-wrap`, `.map-fs-bar`, `#map-stage`, `.map-legend*`, `.map-panel`, `.panel-*`, `.map-backdrop`, `.map-list-view`, `.mlv-*`, reduced-motion block.

- [ ] **Step 2: Add the shell + overlay layout at the end of the file.**

```css
/* ============================================================
   Single-screen explorer shell
   ============================================================ */
html, body { height: 100%; }
body { overflow: hidden; }              /* the explorer owns the viewport */

.top-bar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 60;
  display: flex; align-items: center; gap: var(--sp-5);
  height: 60px; padding: 0 var(--sp-5);
  background: rgba(246,247,255,0.9); backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}
.brand { display: inline-flex; align-items: baseline; gap: var(--sp-2); font-family: var(--font-display); font-weight: 700; }
.brand .glyph { align-self: center; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  background: conic-gradient(from 140deg, var(--accent-4), var(--accent-2), var(--accent-3), var(--accent), var(--accent-4));
  color: #06121f; box-shadow: var(--shadow-sm); animation: spin-slow 16s linear infinite; }
.brand-sub { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--ink-faint); letter-spacing: 0.08em; }
.top-stats { display: flex; gap: var(--sp-4); margin-left: var(--sp-3); }
.top-stats .tstat { font-size: var(--fs-sm); color: var(--ink-dim); }
.top-stats .tstat b { color: var(--accent-2); font-family: var(--font-display); }
.top-actions { margin-left: auto; }
.btn-play {
  display: inline-flex; align-items: center; gap: var(--sp-2);
  font-family: var(--font-display); font-weight: 600; font-size: 0.95rem;
  padding: 0.5rem 1.1rem; border-radius: var(--r-pill); border: none; cursor: pointer;
  background: var(--accent); color: #fff; box-shadow: 0 8px 22px rgba(217,119,6,0.28);
  transition: transform var(--dur-fast) var(--ease-spring), box-shadow var(--dur-mid);
}
.btn-play:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(217,119,6,0.42); }

.explorer { position: fixed; inset: 60px 0 0 0; }     /* below top bar */
.stage-wrap { position: absolute; inset: 0; background: var(--surface); display: flex; flex-direction: column; }
#map-stage { flex: 1; min-height: 0; position: relative; }
#map-stage canvas { position: absolute !important; top: 0 !important; left: 0 !important; }

/* Toolbar floats top-right of the stage */
.map-toolbar {
  position: absolute; top: var(--sp-4); right: var(--sp-4); z-index: 20;
  display: flex; align-items: center; gap: var(--sp-1);
  padding: var(--sp-2); background: rgba(255,255,255,0.92); backdrop-filter: blur(8px);
  border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--shadow-sm);
}

/* Edge legend floats bottom-left */
.map-legend {
  position: absolute; left: var(--sp-4); bottom: var(--sp-4); z-index: 20;
  display: flex; flex-wrap: wrap; gap: var(--sp-3); align-items: center;
  padding: var(--sp-2) var(--sp-3); background: rgba(255,255,255,0.92); backdrop-filter: blur(8px);
  border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--shadow-sm);
  font-size: var(--fs-sm); color: var(--ink-dim); margin: 0;
}
.map-legend-item { display: inline-flex; align-items: center; gap: var(--sp-2); }

/* Fullscreen: explorer covers the viewport including the top bar */
.stage-wrap.is-fullscreen { position: fixed; inset: 0; z-index: 200; }
.stage-wrap.is-fullscreen .map-fs-bar { display: flex; }
.map-fs-bar { display: none; align-items: center; justify-content: space-between; flex: none; height: 44px; padding: 0 var(--sp-4);
  background: rgba(246,247,255,0.95); border-bottom: 1px solid var(--line);
  font-family: var(--font-display); font-weight: 600; font-size: var(--fs-sm); color: var(--ink-dim); }
body.map-fs-active { overflow: hidden; }
```

- [ ] **Step 3: Reload and verify layout.**

`preview_screenshot` → top bar with brand/stats/Play; canvas fills the rest; toolbar top-right; legend bottom-left; no leftover hero/layers content.
`preview_console_logs` error → empty.

- [ ] **Step 4: Commit.**

```bash
git add docs/architecture-site/styles.css
git commit -m "feat(architecture-site): single-screen shell + overlay CSS, remove dead rules"
```

---

## Sprint 2: Layer-key rail

**Goal:** A floating layer key (8 chips) highlights a layer's nodes and shows its blurb; replaces the deleted `#layers` section's role.

**Demo/Validation:** Clicking a chip highlights that layer's nodes on the canvas, frames them, and shows the blurb popover; clicking again or the empty canvas clears.

### Task 2.1: Build and wire the layer key

**Files:**
- Modify: `docs/architecture-site/app.js` (replace the `buildLayerKey` stub)
- Modify: `docs/architecture-site/styles.css` (add `.layer-key`, `.lk-chip`, `.layer-pop`)

- [ ] **Step 1: Replace the `buildLayerKey() {}` stub with the implementation.**

```javascript
  var activeLayerId = null;

  function positionLayerPop(chip) {
    var pop = document.getElementById("layer-pop"); if (!pop) return;
    var r = chip.getBoundingClientRect();
    pop.style.top = (r.top) + "px";
    pop.style.left = (r.right + 10) + "px";
  }

  function showLayerPop(layer, chip) {
    var pop = document.getElementById("layer-pop"); if (!pop) return;
    pop.innerHTML = "<strong>" + layer.title + "</strong><span>" + (layer.blurb || "") + "</span>";
    pop.style.setProperty("--pop-accent", layer.accent || "var(--accent-4)");
    pop.hidden = false;
    positionLayerPop(chip);
  }
  function hideLayerPop() { var pop = document.getElementById("layer-pop"); if (pop) pop.hidden = true; }

  function selectLayer(layer, chip, chips) {
    if (activeLayerId === layer.id) { deselectLayer(chips); return; }
    activeLayerId = layer.id;
    chips.forEach(function (c) { c.classList.toggle("is-active", c.getAttribute("data-layer") === layer.id); c.setAttribute("aria-pressed", String(c.getAttribute("data-layer") === layer.id)); });
    highlightLayer(layer.id); stage.batchDraw();
    frameNodes(layer.nodes.map(function (n) { return n.id; }), 160);
    showLayerPop(layer, chip);
  }
  function deselectLayer(chips) {
    activeLayerId = null;
    chips.forEach(function (c) { c.classList.remove("is-active"); c.setAttribute("aria-pressed", "false"); });
    clearHighlight(); stage.batchDraw();
    hideLayerPop();
  }

  function buildLayerKey() {
    var rail = document.getElementById("layer-key"); if (!rail) return;
    var chips = [];
    arch.layers.forEach(function (layer) {
      var chip = document.createElement("button");
      chip.className = "lk-chip"; chip.setAttribute("data-layer", layer.id);
      chip.setAttribute("aria-pressed", "false"); chip.title = layer.title;
      chip.style.setProperty("--chip-accent", layer.accent || "var(--accent-4)");
      chip.innerHTML = '<span class="lk-dot" aria-hidden="true"></span><span class="lk-label">' + layer.title + '</span>';
      chip.addEventListener("click", function () { selectLayer(layer, chip, chips); });
      rail.appendChild(chip); chips.push(chip);
    });
    // clicking empty canvas clears layer selection
    stage.on("click tap", function (e) { if (e.target === stage && activeLayerId) deselectLayer(chips); });
    window.addEventListener("scroll", function () { if (activeLayerId) hideLayerPop(); }, { passive: true });
  }
```

- [ ] **Step 2: Add layer-key + popover CSS.**

```css
/* Layer-key rail (left, floating) */
.layer-key {
  position: absolute; left: var(--sp-4); top: var(--sp-4); z-index: 20;
  display: flex; flex-direction: column; gap: 6px; max-height: calc(100% - 110px); overflow: auto;
  padding: var(--sp-2); background: rgba(255,255,255,0.92); backdrop-filter: blur(8px);
  border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--shadow-sm);
}
.lk-chip {
  display: inline-flex; align-items: center; gap: var(--sp-2);
  appearance: none; -webkit-appearance: none; background: transparent; border: 1px solid transparent;
  border-radius: var(--r-sm); padding: 4px 8px; cursor: pointer; text-align: left;
  font-family: var(--font-display); font-size: var(--fs-sm); font-weight: 600; color: var(--ink-dim);
  transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
}
.lk-chip:hover { background: var(--bg-soft); color: var(--ink); }
.lk-chip.is-active { background: var(--surface-2); border-color: var(--chip-accent); color: var(--ink); }
.lk-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--chip-accent); box-shadow: 0 0 6px var(--chip-accent); }

/* Layer blurb popover */
.layer-pop {
  position: fixed; z-index: 80; max-width: 280px;
  padding: var(--sp-3) var(--sp-4); background: var(--surface);
  border: 1px solid var(--line-strong); border-left: 3px solid var(--pop-accent, var(--accent-4));
  border-radius: var(--r-md); box-shadow: var(--shadow-md);
  display: flex; flex-direction: column; gap: 4px;
}
.layer-pop strong { font-family: var(--font-display); font-size: var(--fs-sm); color: var(--ink); }
.layer-pop span { font-size: var(--fs-sm); color: var(--ink-dim); line-height: 1.5; }
```

- [ ] **Step 3: Reload and verify.**

`preview_eval`: `location.reload()`, then after ~400ms:
`(function(){var c=document.querySelectorAll('#layer-key .lk-chip');c[2].click();var pop=document.getElementById('layer-pop');return {chips:c.length, popShown:!pop.hidden, active:c[2].classList.contains('is-active')};})()`
Expected: `{ chips: 8, popShown: true, active: true }`.
`preview_screenshot` → third layer's nodes highlighted, others dimmed, blurb popover visible.
`preview_console_logs` error → empty.

- [ ] **Step 4: Commit.**

```bash
git add docs/architecture-site/app.js docs/architecture-site/styles.css
git commit -m "feat(architecture-site): layer-key rail with highlight + blurb popover"
```

---

## Sprint 3: Lifecycle folded into the canvas

**Goal:** Play animates the request token across the same canvas nodes, framing each step, pulsing the active node, and narrating — no separate strip.

**Demo/Validation:** Clicking Play (top bar or transport) runs all 10 steps; camera frames each edge; narration updates; prev/next/speed/restart work; reduced-motion jumps without tweening.

### Task 3.1: Token + step rendering on the canvas

**Files:**
- Modify: `docs/architecture-site/app.js` (replace `initLifecycle` stub and the `lcPlaying` var)

- [ ] **Step 1: Replace `function initLifecycle() {}` and `var lcPlaying = false;` with the player.**

```javascript
  // ── lifecycle player (animates on the main canvas) ────────────
  var lcPlaying = false;
  var lcStep = 0;
  var lcSpeedIdx = 0;
  var LC_SPEEDS = [1, 2, 0.5];
  var lcTimer = null, lcTween = null, lcToken = null;

  function lcDuration() { return Math.round(700 / LC_SPEEDS[lcSpeedIdx]); }

  function buildToken() {
    lcToken = new Konva.Circle({ radius: 11, fill: "#d97706", shadowColor: "#d97706", shadowBlur: 18, shadowOpacity: 0.9, listening: false, visible: false });
    tokenLayer.add(lcToken);
  }

  function pulseNode(id) {
    var g = nodeGroups[id]; if (!g || REDUCED) return;
    var r = g.findOne(".main-rect");
    r.shadowBlur(28); r.shadowOpacity(0.8); nodeLayer.batchDraw();
    r.to({ shadowBlur: 14, duration: 0.4 });
  }

  function lcNarrate() {
    var step = arch.flow[lcStep];
    var numEl = document.getElementById("lc-step-num"), txtEl = document.getElementById("lc-text"), prog = document.getElementById("lc-progress");
    if (numEl) numEl.textContent = "Step " + (lcStep + 1) + " / " + arch.flow.length;
    if (txtEl) txtEl.textContent = step ? step.narrative : "";
    if (prog && prog.firstElementChild) prog.firstElementChild.style.width = ((lcStep + 1) / arch.flow.length * 100) + "%";
  }

  function lcGoTo(idx, animate) {
    lcStep = Math.max(0, Math.min(idx, arch.flow.length - 1));
    var step = arch.flow[lcStep];
    lcNarrate();
    highlightLayer(layerById[step.toId] ? layerById[step.toId].id : null);
    stage.batchDraw();
    var fromC = nodeCenter(step.fromId), toC = nodeCenter(step.toId);
    frameNodes([step.fromId, step.toId], 200);
    if (lcTween) { lcTween.destroy(); lcTween = null; }
    lcToken.visible(true);
    if (REDUCED || !animate) {
      lcToken.position({ x: toC.x, y: toC.y }); tokenLayer.batchDraw(); pulseNode(step.toId);
      return;
    }
    lcToken.position({ x: fromC.x, y: fromC.y });
    lcTween = new Konva.Tween({
      node: lcToken, x: toC.x, y: toC.y, duration: lcDuration() / 1000, easing: Konva.Easings.EaseInOut,
      onFinish: function () { pulseNode(step.toId); }
    });
    lcTween.play();
  }

  function lcSetPlaying(on) {
    lcPlaying = on;
    var pm = document.getElementById("lc-play-main"), p = document.getElementById("lc-play"), tr = document.getElementById("lc-transport");
    if (p) { p.textContent = on ? "⏸" : "▶"; p.setAttribute("aria-label", on ? "Pause" : "Play"); }
    if (pm) pm.querySelector(".play-ico").textContent = on ? "⏸" : "▶";
    if (tr) tr.setAttribute("data-active", "true");
    if (!on) { if (lcTimer) { clearTimeout(lcTimer); lcTimer = null; } }
  }

  function lcAdvance() {
    if (lcStep >= arch.flow.length - 1) { lcSetPlaying(false); return; }
    lcGoTo(lcStep + 1, true);
    lcTimer = window.setTimeout(function () { if (lcPlaying) lcAdvance(); }, lcDuration() + 350);
  }

  function lcPlayPause() {
    if (lcPlaying) { lcSetPlaying(false); return; }
    if (lcStep >= arch.flow.length - 1) lcStep = -1;  // restart from beginning
    lcSetPlaying(true); lcAdvance();
  }

  function initLifecycle() {
    buildToken();
    var pm = document.getElementById("lc-play-main"), p = document.getElementById("lc-play");
    var prev = document.getElementById("lc-prev"), next = document.getElementById("lc-next");
    var restart = document.getElementById("lc-restart"), speed = document.getElementById("lc-speed");
    if (pm) pm.addEventListener("click", function () { document.getElementById("lc-transport").setAttribute("data-active", "true"); lcPlayPause(); });
    if (p) p.addEventListener("click", lcPlayPause);
    if (prev) prev.addEventListener("click", function () { lcSetPlaying(false); lcGoTo(lcStep - 1, false); });
    if (next) next.addEventListener("click", function () { lcSetPlaying(false); lcGoTo(lcStep + 1, false); });
    if (restart) restart.addEventListener("click", function () { lcSetPlaying(false); lcGoTo(0, false); });
    if (speed) speed.addEventListener("click", function () { lcSpeedIdx = (lcSpeedIdx + 1) % LC_SPEEDS.length; speed.textContent = ["1×", "2×", "0.5×"][lcSpeedIdx]; });
    lcNarrate();
  }
```

- [ ] **Step 2: Add transport CSS.**

```css
/* Lifecycle transport (bottom-center overlay) */
.lc-transport {
  position: absolute; left: 50%; bottom: var(--sp-4); transform: translateX(-50%); z-index: 25;
  width: min(680px, calc(100% - 2 * var(--sp-5)));
  background: rgba(255,255,255,0.95); backdrop-filter: blur(10px);
  border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow-md);
  padding: var(--sp-3) var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2);
  opacity: 0; pointer-events: none; transition: opacity var(--dur-mid), transform var(--dur-mid) var(--ease-out);
}
.lc-transport[data-active="true"] { opacity: 1; pointer-events: auto; }
.lc-progress { height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; }
.lc-progress span { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent-2), var(--accent)); transition: width var(--dur-mid) var(--ease-out); }
.lc-narration { text-align: center; min-height: 2.6rem; }
.lc-step { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--accent-4); letter-spacing: 0.08em; }
.lc-text { font-family: var(--font-display); font-size: 0.98rem; color: var(--ink); line-height: 1.4; margin-top: 2px; }
.lc-buttons { display: flex; align-items: center; justify-content: center; gap: var(--sp-3); }
.lc-btn { appearance: none; -webkit-appearance: none; background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-pill);
  color: var(--ink-dim); cursor: pointer; font-family: var(--font-display); font-weight: 600; width: 40px; height: 40px; display: grid; place-items: center;
  transition: transform var(--dur-fast) var(--ease-spring), background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast); }
.lc-btn:hover { transform: translateY(-2px); background: var(--surface-2); border-color: var(--accent-4); color: var(--ink); }
.lc-btn.lc-play { width: 48px; height: 48px; font-size: 1.2rem; background: var(--accent); border-color: var(--accent); color: #fff; }
.lc-btn.lc-speed { font-family: var(--font-mono); font-size: var(--fs-sm); width: auto; padding: 0 var(--sp-3); }
```

- [ ] **Step 3: Reload and verify the player.**

`preview_eval`: `location.reload()`, then after ~400ms:
`(function(){document.getElementById('lc-play-main').click();return {active:document.getElementById('lc-transport').getAttribute('data-active'), text:document.getElementById('lc-text').textContent.length>0};})()`
Expected: `{ active: "true", text: true }`.
Wait ~3s, `preview_screenshot` → token visible on canvas, transport showing a step narrative, a layer highlighted.
`preview_console_logs` error → empty.

- [ ] **Step 4: Verify prev/next/restart and reduced-motion.**

`preview_eval`: `(function(){document.getElementById('lc-next').click();var t1=document.getElementById('lc-step-num').textContent;document.getElementById('lc-restart').click();return {after_next:t1, after_restart:document.getElementById('lc-step-num').textContent};})()`
Expected: `after_restart` === `"Step 1 / 10"`.

- [ ] **Step 5: Commit.**

```bash
git add docs/architecture-site/app.js docs/architecture-site/styles.css
git commit -m "feat(architecture-site): lifecycle token animates on the main canvas"
```

---

## Sprint 4: Responsive, a11y, polish, ship

**Goal:** Works on mobile, respects reduced motion, no console errors, offline-safe; merged to main.

**Demo/Validation:** Resize to 380px → layer key becomes a top chip row, transport fits; reduced-motion jumps; `file://` open still renders; merged.

### Task 4.1: Responsive overlay layout

**Files:**
- Modify: `docs/architecture-site/styles.css`

- [ ] **Step 1: Add mobile rules.**

```css
@media (max-width: 720px) {
  .top-bar { gap: var(--sp-3); padding: 0 var(--sp-3); }
  .top-stats { display: none; }            /* keep brand + Play only */
  .brand-sub { display: none; }

  /* Layer key → horizontal scrolling chip row under the top bar */
  .layer-key { left: var(--sp-2); right: var(--sp-2); top: var(--sp-2); flex-direction: row; max-height: none; overflow-x: auto; overflow-y: hidden; }
  .lk-chip .lk-label { white-space: nowrap; }

  /* Toolbar slightly tighter, stays top-right but below chip row */
  .map-toolbar { top: 56px; right: var(--sp-2); }

  /* Legend wraps; transport spans width as a bottom sheet */
  .map-legend { left: var(--sp-2); bottom: 96px; font-size: var(--fs-xs); }
  .lc-transport { left: 0; right: 0; bottom: 0; width: 100%; transform: none; border-radius: var(--r-lg) var(--r-lg) 0 0; }
  .lc-btn { min-width: 44px; min-height: 44px; }
  .layer-pop { max-width: calc(100vw - 2 * var(--sp-3)); }
}
```

- [ ] **Step 2: Verify mobile via resize.**

Use `preview_resize` to 390×800, `preview_screenshot`.
Expected: chip row across the top, transport as a full-width bottom sheet, canvas fills the middle.
Restore with `preview_resize` to a desktop size.

- [ ] **Step 3: Commit.**

```bash
git add docs/architecture-site/styles.css
git commit -m "feat(architecture-site): responsive overlay layout for mobile"
```

### Task 4.2: Final checks + offline + README note

**Files:**
- Modify: `docs/architecture-site/README.md` (create if absent)

- [ ] **Step 1: Verify reduced motion.**

`preview_eval`: `(function(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches;})()` (informational). Then confirm code path: lifecycle `lcGoTo` jumps when `REDUCED` (already coded). No tween objects should accumulate — inspect: `Konva.stages[0].find('Circle').length` Expected: `1` (single token).

- [ ] **Step 2: Verify offline (`file://`).**

Run: `open "/Users/pankajkumaryadav/Desktop/development/base/.claude/worktrees/architecture-site/docs/architecture-site/index.html"` (macOS). Confirm by eye the canvas renders (Konva is vendored, no CDN). If headless, skip and note that all assets are local (`assets/konva.min.js`, `data.js`, `app.js`, `styles.css`) and the only network refs are Google Fonts with a system fallback in CSS.

- [ ] **Step 3: Write `README.md`.**

```markdown
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
```

- [ ] **Step 4: Commit.**

```bash
git add docs/architecture-site/README.md
git commit -m "docs(architecture-site): README for the map-centric explorer"
```

### Task 4.3: Merge to main

- [ ] **Step 1: Final full-page screenshot review.** `preview_screenshot` desktop + 390px. No console errors at either size.

- [ ] **Step 2: Merge the branch to main** (mirrors the established flow for this worktree):

```bash
git -C /Users/pankajkumaryadav/Desktop/development/base merge worktree-architecture-site --no-ff -m "feat(architecture-site): map-centric single-screen redesign"
git -C /Users/pankajkumaryadav/Desktop/development/base push origin main
```

- [ ] **Step 3: Confirm** `git -C /Users/pankajkumaryadav/Desktop/development/base log --oneline -3` shows the merge on `main`.

---

## Self-review notes

- **Spec coverage:** shell (1.1) · full-bleed canvas (1.2–1.5) · `#layers` removed (1.1, 1.5) · consolidation/de-dup (1.2–1.4) · layer-key rail + blurb (2.1) · lifecycle on canvas with camera framing + narration + reduced-motion (3.1) · detail panel reuse (1.4) · list-view fallback (1.4) · responsive (4.1) · offline + README (4.2) · merge (4.3). All spec sections mapped.
- **Naming consistency:** `highlightLayer`/`clearHighlight`/`highlightNode`/`frameNodes`/`nodeCenter`/`openPanel`/`closePanel`/`lcGoTo`/`lcPlayPause` are defined once and referenced consistently. `panelOpen` and `lcPlaying` are the only cross-module booleans, both declared before `init()` runs.
- **Stub ordering:** `buildLayerKey`/`initLifecycle`/`lcPlaying` are stubbed in 1.4 Step 5 so `init()` runs after Sprint 1, then replaced in 2.1 / 3.1. Verify each replacement removes the stub to avoid duplicate declarations.
- **Progress bar:** repurposed as `.lc-progress` inside the transport (not a separate page element).
