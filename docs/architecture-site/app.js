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

  // ===== CANVAS =====
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

  // ===== CAMERA =====
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
