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
