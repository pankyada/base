/* app.js — Agent Harness architecture site.
 * Classic script (no modules). Depends on window.ARCH from data.js.
 * Responsibilities:
 *   - render the 8 layer sections from ARCH.layers
 *   - staggered hero + layer entrance animation (reduced-motion aware)
 *   - smooth-scroll CTA buttons
 *   - guard everything if ARCH is missing
 */
(function () {
  "use strict";

  var REDUCED = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Map layer id -> CSS accent var name (declared in styles.css :root)
  var ACCENT_VAR = {
    clients: "--layer-clients",
    transport: "--layer-transport",
    core: "--layer-core",
    tools: "--layer-tools",
    ext: "--layer-ext",
    state: "--layer-state",
    ops: "--layer-ops",
    external: "--layer-external"
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ---------------------------------------------------------------
  // Render layer sections
  // ---------------------------------------------------------------
  function renderLayers(layers) {
    var container = document.getElementById("layers");
    if (!container) return 0;

    var totalNodes = 0;

    layers.forEach(function (layer, i) {
      var section = el("section", "layer");
      section.id = "layer-" + layer.id;
      section.setAttribute("aria-labelledby", "layer-" + layer.id + "-title");
      // Prefer the accent var (keeps palette consistent); fall back to data hex.
      var accent = layer.accent || "var(--accent-4)";
      var varName = ACCENT_VAR[layer.id];
      section.style.setProperty("--accent-layer", varName ? "var(" + varName + ", " + accent + ")" : accent);
      section.setAttribute("data-rise", "");

      // top: index + titles + chip
      var top = el("div", "layer-top");
      top.appendChild(el("span", "layer-index", String(i + 1)));

      var titles = el("div", "layer-titles");
      var h3 = el("h3", null, layer.title);
      h3.id = "layer-" + layer.id + "-title";
      titles.appendChild(h3);
      titles.appendChild(el("p", "blurb", layer.blurb || ""));
      top.appendChild(titles);

      top.appendChild(el("span", "layer-chip", layer.id));
      section.appendChild(top);

      // nodes
      var nodes = layer.nodes || [];
      totalNodes += nodes.length;

      var list = el("ul", "nodes");
      nodes.forEach(function (n) {
        var item = el("li", "node");

        var name = el("div", "node-name");
        name.appendChild(el("span", "dot"));
        name.appendChild(document.createTextNode(n.name));
        item.appendChild(name);

        item.appendChild(el("p", "node-resp", n.responsibility || ""));

        var files = el("ul", "node-files");
        if (n.files && n.files.length) {
          n.files.forEach(function (f) {
            var li = el("li", null, f);
            files.appendChild(li);
          });
        } else {
          files.appendChild(el("li", "empty", "external — no source path"));
        }
        item.appendChild(files);

        list.appendChild(item);
      });
      section.appendChild(list);

      container.appendChild(section);
    });

    return totalNodes;
  }

  // ---------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------
  function setStats(arch, nodeCount) {
    var byId = {
      "stat-layers": arch.layers ? arch.layers.length : 0,
      "stat-nodes": nodeCount,
      "stat-flow": arch.flow ? arch.flow.length : 0
    };
    Object.keys(byId).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.textContent = String(byId[id]);
    });
  }

  // ---------------------------------------------------------------
  // Entrance animation (staggered reveal)
  // ---------------------------------------------------------------
  function reveal(nodes, baseDelay, step) {
    nodes.forEach(function (node, i) {
      if (REDUCED) {
        node.classList.add("reveal");
        return;
      }
      window.setTimeout(function () {
        node.classList.add("reveal");
      }, baseDelay + i * step);
    });
  }

  function animateHero() {
    var staged = Array.prototype.slice.call(document.querySelectorAll("[data-stagger]"));
    reveal(staged, 80, 110);
  }

  function animateLayersOnScroll() {
    var layerEls = Array.prototype.slice.call(document.querySelectorAll(".layer[data-rise]"));

    if (REDUCED || !("IntersectionObserver" in window)) {
      layerEls.forEach(function (n) { n.classList.add("reveal"); });
      return;
    }

    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal");
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

    layerEls.forEach(function (n) { io.observe(n); });
  }

  // ---------------------------------------------------------------
  // Smooth-scroll CTAs (works even if scroll-behavior unsupported)
  // ---------------------------------------------------------------
  function wireScroll() {
    var links = Array.prototype.slice.call(document.querySelectorAll('[data-scroll]'));
    links.forEach(function (link) {
      link.addEventListener("click", function (e) {
        var href = link.getAttribute("href") || "";
        if (href.charAt(0) !== "#") return;
        var target = document.querySelector(href);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({
          behavior: REDUCED ? "auto" : "smooth",
          block: "start"
        });
        // update hash without an extra jump
        if (history && history.replaceState) {
          history.replaceState(null, "", href);
        }
      });
    });
  }

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  function init() {
    // Gate hidden-start animations behind this class so content is
    // visible by default and only hides once JS is active.
    document.documentElement.classList.add("js-reveal");

    var arch = window.ARCH;
    if (!arch || !Array.isArray(arch.layers)) {
      // Graceful degradation: leave the static skeleton + show a note in the layers area.
      var container = document.getElementById("layers");
      if (container) {
        var warn = el("p", "blurb",
          "Architecture data failed to load (window.ARCH missing). Check that data.js is loaded before app.js.");
        container.appendChild(warn);
      }
      wireScroll();
      return;
    }

    var nodeCount = renderLayers(arch.layers);
    setStats(arch, nodeCount);
    wireScroll();
    animateHero();
    animateLayersOnScroll();

    // Fallback: force-reveal any sections still hidden after 1.2s
    // (e.g. IntersectionObserver never fired for off-screen elements that
    //  end up above the fold after a fast scroll or programmatic jump)
    if (!REDUCED) {
      window.setTimeout(function () {
        var hidden = document.querySelectorAll(".layer[data-rise]:not(.reveal)");
        Array.prototype.forEach.call(hidden, function (n) {
          n.classList.add("reveal");
        });
      }, 1200);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* ============================================================
   Interactive Component Map — Konva canvas
   Depends on window.ARCH (from data.js) and Konva (assets/konva.min.js).
   ============================================================ */
(function () {
  "use strict";

  var arch = window.ARCH;
  if (typeof Konva === "undefined" || !arch || !Array.isArray(arch.layers)) return;

  // ── Layout constants ──────────────────────────────────────────
  var VIRT_W       = 2400;
  var BAND_H       = 200;
  var VPAD_TOP     = 90;
  var VPAD_BOT     = 80;
  var HPAD         = 150;
  var NODE_W       = 162;
  var NODE_H       = 56;
  var NODE_R       = 9;
  var NODE_Y_BAND  = 112;  // node-center y from band top
  var VIRT_H       = VPAD_TOP + arch.layers.length * BAND_H + VPAD_BOT;
  var MIN_SCALE    = 0.12;
  var MAX_SCALE    = 4;

  // ── Edge styles ───────────────────────────────────────────────
  var ESTYLE = {
    primary:    { stroke: "#d97706", width: 2,   dash: [] },
    data:       { stroke: "#059669", width: 1.5, dash: [8, 5] },
    optional:   { stroke: "#0284c7", width: 1.5, dash: [3, 4] },
    dependency: { stroke: "#db2777", width: 1.5, dash: [] }
  };

  // ── Lookups ───────────────────────────────────────────────────
  var nodeById  = {};
  var layerById = {};   // nodeId → layer obj
  var initPos   = {};   // nodeId → { x, y } center in virtual space

  function buildLookups() {
    arch.layers.forEach(function (layer, li) {
      var bandTop = VPAD_TOP + li * BAND_H;
      var nodes   = layer.nodes;
      var n       = nodes.length;
      nodes.forEach(function (node, ni) {
        nodeById[node.id]  = node;
        layerById[node.id] = layer;
        var avail = VIRT_W - 2 * HPAD;
        initPos[node.id] = {
          x: n > 1 ? HPAD + (ni / (n - 1)) * avail : VIRT_W / 2,
          y: bandTop + NODE_Y_BAND
        };
      });
    });
  }

  // ── Konva stage state ─────────────────────────────────────────
  var stage, bgLayer, edgeLayer, nodeLayer;
  var nodeGroups = {};   // nodeId → Konva.Group
  var edgeShapes = [];   // [{ line, fromId, toId, kind }]
  var currentScale = 1;

  // ── Create stage ──────────────────────────────────────────────
  function createStage() {
    var wrap = document.getElementById("map-stage-wrap");
    if (!wrap) return false;
    var fsBar = document.getElementById("map-fs-bar");
    var hint  = document.querySelector(".map-hint");
    var fsH   = (fsBar && fsBar.offsetHeight > 0) ? fsBar.offsetHeight : 0;
    var hiH   = hint ? (hint.offsetHeight || 30) : 30;
    var w = wrap.offsetWidth  || 820;
    var h = Math.max((wrap.offsetHeight || 560) - fsH - hiH, 280);
    stage = new Konva.Stage({ container: "map-stage", width: w, height: h });
    bgLayer   = new Konva.Layer({ listening: false });
    edgeLayer = new Konva.Layer({ listening: false });
    nodeLayer = new Konva.Layer();
    stage.add(bgLayer, edgeLayer, nodeLayer);
    return true;
  }

  // ── Band backgrounds + labels ─────────────────────────────────
  function renderBands() {
    arch.layers.forEach(function (layer, li) {
      var bandTop = VPAD_TOP + li * BAND_H;
      if (li % 2 === 0) {
        bgLayer.add(new Konva.Rect({
          x: 0, y: bandTop, width: VIRT_W, height: BAND_H,
          fill: "rgba(0,0,0,0.016)", listening: false
        }));
      }
      if (li > 0) {
        bgLayer.add(new Konva.Line({
          points: [0, bandTop, VIRT_W, bandTop],
          stroke: "rgba(0,0,0,0.055)", strokeWidth: 1, listening: false
        }));
      }
      bgLayer.add(new Konva.Text({
        x: 14, y: bandTop + BAND_H / 2 - 8,
        text: (li + 1) + ". " + layer.title,
        fontSize: 12,
        fontFamily: "Space Grotesk, system-ui, sans-serif",
        fill: layer.accent || "#888",
        opacity: 0.6,
        listening: false
      }));
    });
  }

  // ── Edges ─────────────────────────────────────────────────────
  function renderEdges() {
    arch.edges.forEach(function (edge) {
      var s  = ESTYLE[edge.kind] || ESTYLE.primary;
      var fp = initPos[edge.from], tp = initPos[edge.to];
      if (!fp || !tp) return;
      var line = new Konva.Line({
        points: [fp.x, fp.y, tp.x, tp.y],
        stroke: s.stroke, strokeWidth: s.width,
        dash: s.dash, opacity: 0.48,
        lineCap: "round", listening: false
      });
      edgeLayer.add(line);
      edgeShapes.push({ line: line, fromId: edge.from, toId: edge.to, kind: edge.kind });
    });
  }

  // ── Nodes ─────────────────────────────────────────────────────
  function renderNodes() {
    arch.layers.forEach(function (layer) {
      var acc = layer.accent || "#4cc9f0";
      layer.nodes.forEach(function (node) {
        var cp  = initPos[node.id];
        var grp = new Konva.Group({
          x: cp.x - NODE_W / 2, y: cp.y - NODE_H / 2,
          draggable: true, id: "ng-" + node.id
        });
        grp.add(new Konva.Rect({   // drop shadow
          x: 2, y: 3, width: NODE_W, height: NODE_H,
          cornerRadius: NODE_R, fill: "rgba(0,0,0,0.09)", listening: false
        }));
        grp.add(new Konva.Rect({   // body
          name: "main-rect",
          x: 0, y: 0, width: NODE_W, height: NODE_H,
          cornerRadius: NODE_R,
          fill: "#ffffff", stroke: acc, strokeWidth: 1.5
        }));
        grp.add(new Konva.Rect({   // accent bar
          x: 0, y: 0, width: 5, height: NODE_H,
          cornerRadius: [NODE_R, 0, 0, NODE_R],
          fill: acc, listening: false
        }));
        grp.add(new Konva.Text({   // name label
          x: 12, y: NODE_H / 2 - 8,
          width: NODE_W - 18,
          text: node.name,
          fontSize: 12,
          fontFamily: "Space Grotesk, system-ui, sans-serif",
          fontStyle: "bold",
          fill: "#0d0f22",
          ellipsis: true, listening: false
        }));

        nodeGroups[node.id] = grp;
        nodeLayer.add(grp);

        grp.on("dragmove", function () { updateEdgesForNode(node.id); });
        grp.on("dragend",  function () { saveDragPositions(); });
        grp.on("mouseenter", function () {
          document.body.style.cursor = "pointer";
          highlightNode(node.id);
          stage.batchDraw();
        });
        grp.on("mouseleave", function () {
          document.body.style.cursor = "";
          if (!panelOpen) { clearHighlight(); stage.batchDraw(); }
        });
        grp.on("click tap", function () { openPanel(node.id); });
      });
    });
  }

  // ── Edge position helpers ─────────────────────────────────────
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
    edgeShapes.forEach(function (e) {
      var f = nodeCenter(e.fromId), t = nodeCenter(e.toId);
      e.line.points([f.x, f.y, t.x, t.y]);
    });
  }

  // ── Highlight ─────────────────────────────────────────────────
  function highlightNode(activeId) {
    var nbrs = {};
    arch.edges.forEach(function (e) {
      if (e.from === activeId) nbrs[e.to]   = true;
      if (e.to   === activeId) nbrs[e.from] = true;
    });
    Object.keys(nodeGroups).forEach(function (id) {
      var g = nodeGroups[id];
      var r = g.findOne(".main-rect");
      var lyr = layerById[id];
      if (id === activeId) {
        r.shadowBlur(20); r.shadowColor(lyr ? lyr.accent : "#d97706"); r.shadowOpacity(0.55);
        g.opacity(1);
      } else if (nbrs[id]) {
        r.shadowBlur(10); r.shadowColor(lyr ? lyr.accent : "#888"); r.shadowOpacity(0.3);
        g.opacity(0.92);
      } else {
        r.shadowBlur(0); r.shadowOpacity(0);
        g.opacity(0.2);
      }
    });
    edgeShapes.forEach(function (e) {
      var s = ESTYLE[e.kind] || ESTYLE.primary;
      if (e.fromId === activeId || e.toId === activeId) {
        e.line.opacity(0.95); e.line.strokeWidth(s.width + 1);
      } else {
        e.line.opacity(0.06); e.line.strokeWidth(s.width);
      }
    });
  }

  function highlightLayer(layerId) {
    var lnodes = {};
    arch.layers.forEach(function (l) {
      if (l.id === layerId) l.nodes.forEach(function (n) { lnodes[n.id] = true; });
    });
    Object.keys(nodeGroups).forEach(function (id) {
      var g = nodeGroups[id];
      var r = g.findOne(".main-rect");
      var lyr = layerById[id];
      if (lnodes[id]) {
        r.shadowBlur(14); r.shadowColor(lyr ? lyr.accent : "#d97706"); r.shadowOpacity(0.45);
        g.opacity(1);
      } else {
        r.shadowBlur(0); r.shadowOpacity(0);
        g.opacity(0.18);
      }
    });
    edgeShapes.forEach(function (e) {
      e.line.opacity(lnodes[e.fromId] && lnodes[e.toId] ? 0.85 : 0.05);
    });
    nodeLayer.batchDraw();
    edgeLayer.batchDraw();
  }

  function clearHighlight() {
    Object.keys(nodeGroups).forEach(function (id) {
      var g = nodeGroups[id];
      var r = g.findOne(".main-rect");
      r.shadowBlur(0); r.shadowOpacity(0);
      g.opacity(1);
    });
    edgeShapes.forEach(function (e) {
      e.line.opacity(0.48);
      e.line.strokeWidth((ESTYLE[e.kind] || ESTYLE.primary).width);
    });
    nodeLayer.batchDraw();
    edgeLayer.batchDraw();
  }

  // ── Zoom & pan ────────────────────────────────────────────────
  function clampScale(s) { return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)); }

  function zoomAround(factor, pivot) {
    var oldS = stage.scaleX();
    var newS = clampScale(oldS * factor);
    var pos  = stage.position();
    stage.scale({ x: newS, y: newS });
    stage.position({
      x: pivot.x - (pivot.x - pos.x) * newS / oldS,
      y: pivot.y - (pivot.y - pos.y) * newS / oldS
    });
    currentScale = newS;
    updateZoomLabel();
    stage.batchDraw();
  }

  function fitToView() {
    if (!stage) return;
    var w = stage.width(), h = stage.height();
    var s = clampScale(Math.min(w / VIRT_W, h / VIRT_H) * 0.90);
    stage.scale({ x: s, y: s });
    stage.position({ x: (w - VIRT_W * s) / 2, y: (h - VIRT_H * s) / 2 });
    currentScale = s;
    updateZoomLabel();
    stage.batchDraw();
  }

  function updateZoomLabel() {
    var el = document.getElementById("map-zoom-label");
    if (el) el.textContent = Math.round(currentScale * 100) + "%";
  }

  function wireZoom() {
    stage.on("wheel", function (e) {
      var evt = e.evt;
      if (!evt.ctrlKey && !evt.metaKey) return;
      evt.preventDefault();
      zoomAround(evt.deltaY < 0 ? 1.12 : (1 / 1.12), stage.getPointerPosition());
    });
  }

  function wirePan() {
    var panning = false, lastPt = null;
    stage.on("mousedown touchstart", function (e) {
      if (e.target !== stage) return;
      panning = true;
      var p = stage.getPointerPosition();
      lastPt = { x: p.x, y: p.y };
      document.body.style.cursor = "grabbing";
    });
    stage.on("mousemove touchmove", function () {
      if (!panning || !lastPt) return;
      var p = stage.getPointerPosition();
      if (!p) return;
      stage.position({ x: stage.x() + p.x - lastPt.x, y: stage.y() + p.y - lastPt.y });
      lastPt = p;
      stage.batchDraw();
    });
    stage.on("mouseup touchend mouseleave", function () {
      if (panning) {
        panning = false; lastPt = null;
        if (document.body.style.cursor === "grabbing") document.body.style.cursor = "";
      }
    });
  }

  // ── Toolbar ───────────────────────────────────────────────────
  function wireToolbar() {
    function center() { return { x: stage.width() / 2, y: stage.height() / 2 }; }
    function $id(id)  { return document.getElementById(id); }
    var zi = $id("map-zoom-in"), zo = $id("map-zoom-out"), fit = $id("map-fit");
    var rl = $id("map-reset-layout");
    if (zi)  zi.addEventListener("click",  function () { zoomAround(1.25, center()); });
    if (zo)  zo.addEventListener("click",  function () { zoomAround(1 / 1.25, center()); });
    if (fit) fit.addEventListener("click", fitToView);
    if (rl)  rl.addEventListener("click",  function () {
      Object.keys(nodeGroups).forEach(function (id) {
        var g = nodeGroups[id], p = initPos[id];
        g.x(p.x - NODE_W / 2); g.y(p.y - NODE_H / 2);
      });
      updateAllEdges();
      nodeLayer.batchDraw(); edgeLayer.batchDraw();
      try { sessionStorage.removeItem("hm-pos"); } catch (ex) {}
    });
  }

  // ── Fullscreen ────────────────────────────────────────────────
  var isFullscreen = false;

  function wireFullscreen() {
    var wrap    = document.getElementById("map-stage-wrap");
    var expBtn  = document.getElementById("map-expand");
    var closeFs = document.getElementById("map-fs-close");

    function toggle(open) {
      isFullscreen = open;
      if (wrap) wrap.classList.toggle("is-fullscreen", open);
      document.body.classList.toggle("map-fs-active", open);
      if (expBtn) {
        expBtn.setAttribute("aria-label", open ? "Exit fullscreen" : "Expand to fullscreen");
        expBtn.textContent = open ? "⊠" : "⤢";
      }
      window.setTimeout(function () { resizeStage(); fitToView(); }, 60);
    }

    if (expBtn)  expBtn.addEventListener("click",  function () { toggle(!isFullscreen); });
    if (closeFs) closeFs.addEventListener("click", function () { toggle(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isFullscreen) toggle(false);
    });
  }

  function resizeStage() {
    var wrap = document.getElementById("map-stage-wrap");
    if (!wrap || !stage) return;
    var fsBar = document.getElementById("map-fs-bar");
    var hint  = document.querySelector(".map-hint");
    var fsH   = (fsBar && fsBar.offsetHeight > 0) ? fsBar.offsetHeight : 0;
    var hiH   = hint ? (hint.offsetHeight || 30) : 30;
    stage.width(wrap.offsetWidth);
    stage.height(Math.max(wrap.offsetHeight - fsH - hiH, 280));
    stage.batchDraw();
  }

  // ── List-view toggle ──────────────────────────────────────────
  function wireListToggle() {
    var btn  = document.getElementById("map-list-toggle");
    var wrap = document.getElementById("map-stage-wrap");
    var lv   = document.getElementById("map-list-view");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var showList = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(showList));
      if (wrap) wrap.hidden = showList;
      if (lv)  lv.hidden   = !showList;
    });
  }

  function buildListView() {
    var lv = document.getElementById("map-list-view");
    if (!lv) return;
    arch.layers.forEach(function (layer) {
      var sec = document.createElement("div");
      sec.className = "mlv-layer";
      var h = document.createElement("h4");
      h.className = "mlv-title";
      h.textContent = layer.title;
      h.style.color = layer.accent;
      sec.appendChild(h);
      var ul = document.createElement("ul");
      ul.className = "mlv-nodes";
      layer.nodes.forEach(function (node) {
        var li = document.createElement("li");
        li.className = "mlv-node";
        li.tabIndex = 0;
        li.innerHTML = "<strong>" + node.name + "</strong> — " + (node.responsibility || "");
        li.addEventListener("click", function () { openPanel(node.id); });
        li.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPanel(node.id); }
        });
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      lv.appendChild(sec);
    });
  }

  // ── Detail panel ─────────────────────────────────────────────
  var panelOpen = false;

  function openPanel(nodeId) {
    var node  = nodeById[nodeId];
    var layer = layerById[nodeId];
    if (!node || !layer) return;

    document.getElementById("panel-layer-name").textContent      = layer.title;
    document.getElementById("panel-node-name").textContent       = node.name;
    document.getElementById("panel-responsibility").textContent  = node.responsibility || "";
    document.getElementById("panel-detail").textContent          = node.detail || "";

    var filesEl = document.getElementById("panel-files");
    filesEl.innerHTML = "";
    var files = (node.files && node.files.length) ? node.files : ["external — no source file"];
    files.forEach(function (f) {
      var code = document.createElement("code");
      code.textContent = f;
      filesEl.appendChild(code);
    });

    var panelEl = document.getElementById("map-panel");
    var bdEl    = document.getElementById("map-backdrop");
    if (panelEl) { panelEl.classList.add("is-open"); panelEl.setAttribute("aria-hidden", "false"); }
    if (bdEl)    bdEl.classList.add("is-open");
    panelOpen = true;

    var cb = document.getElementById("panel-close");
    if (cb) cb.focus();
  }

  function closePanel() {
    var panelEl = document.getElementById("map-panel");
    var bdEl    = document.getElementById("map-backdrop");
    if (panelEl) { panelEl.classList.remove("is-open"); panelEl.setAttribute("aria-hidden", "true"); }
    if (bdEl)    bdEl.classList.remove("is-open");
    panelOpen = false;
    clearHighlight();
    if (stage) stage.batchDraw();
  }

  document.addEventListener("keydown", function (e) {
    if (!panelOpen) return;
    var panelEl = document.getElementById("map-panel");
    if (!panelEl) return;
    var items = Array.prototype.slice.call(
      panelEl.querySelectorAll('button,[href],input,[tabindex]:not([tabindex="-1"])')
    );
    if (!items.length) return;
    if (e.key === "Escape") { e.preventDefault(); closePanel(); return; }
    if (e.key === "Tab") {
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });

  function wirePanel() {
    var cb = document.getElementById("panel-close");
    var bd = document.getElementById("map-backdrop");
    if (cb) cb.addEventListener("click", closePanel);
    if (bd) bd.addEventListener("click", closePanel);
  }

  // ── Session storage drag persistence ─────────────────────────
  var STORE_KEY = "hm-pos";

  function saveDragPositions() {
    var out = {};
    Object.keys(nodeGroups).forEach(function (id) {
      var g = nodeGroups[id];
      out[id] = { x: g.x(), y: g.y() };
    });
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch (ex) {}
  }

  function loadDragPositions() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var pos = JSON.parse(raw);
      Object.keys(pos).forEach(function (id) {
        var g = nodeGroups[id];
        if (g) { g.x(pos[id].x); g.y(pos[id].y); }
      });
      updateAllEdges();
      nodeLayer.batchDraw(); edgeLayer.batchDraw();
      return true;
    } catch (ex) { return false; }
  }

  // ── Resize ────────────────────────────────────────────────────
  function scheduleResize() {
    var wrap = document.getElementById("map-stage-wrap");
    if (!wrap) return;
    var pending = false;
    function onResize() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; resizeStage(); });
    }
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(onResize).observe(wrap);
    } else {
      window.addEventListener("resize", onResize);
    }
  }

  // ── mapAPI — scroll-sync + lifecycle integration ──────────────
  window.mapAPI = {
    highlightLayer: function (layerId) { if (stage) highlightLayer(layerId); },
    clearHighlight: function () {
      if (!stage) return;
      clearHighlight();
      stage.batchDraw();
    }
  };

  // ── Init ──────────────────────────────────────────────────────
  function initMap() {
    buildLookups();
    if (!createStage()) return;
    renderBands();
    renderEdges();
    renderNodes();
    bgLayer.batchDraw(); edgeLayer.batchDraw(); nodeLayer.batchDraw();
    loadDragPositions();
    fitToView();
    wireZoom();
    wirePan();
    wireToolbar();
    wireFullscreen();
    wireListToggle();
    buildListView();
    wirePanel();
    scheduleResize();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMap);
  } else {
    initMap();
  }
})();

/* ============================================================
   Lifecycle animation
   Depends on window.ARCH (from data.js) and window.mapAPI.
   ============================================================ */
(function () {
  "use strict";

  var REDUCED = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── layer accent lookup ────────────────────────────────────
  var ACCENT_VAR = {
    clients:   "--layer-clients",
    transport: "--layer-transport",
    core:      "--layer-core",
    tools:     "--layer-tools",
    ext:       "--layer-ext",
    state:     "--layer-state",
    ops:       "--layer-ops",
    external:  "--layer-external"
  };

  function getLayerAccent(layerId) {
    var v = ACCENT_VAR[layerId];
    if (!v) return "var(--accent-4)";
    return "var(" + v + ", var(--accent-4))";
  }

  // ── build lookups from ARCH ────────────────────────────────
  var nodeById  = {};   // nodeId -> node data
  var layerById = {};   // nodeId -> layer data

  function buildLookups(arch) {
    arch.layers.forEach(function (layer) {
      layer.nodes.forEach(function (n) {
        nodeById[n.id]  = n;
        layerById[n.id] = layer;
      });
    });
  }

  // ── collect unique ordered nodes from flow ─────────────────
  function getFlowNodes(flow) {
    var seen = {};
    var list = [];
    flow.forEach(function (step) {
      if (!seen[step.fromId]) { seen[step.fromId] = true; list.push(step.fromId); }
      if (!seen[step.toId])   { seen[step.toId]   = true; list.push(step.toId); }
    });
    return list;
  }

  // ── build stage ────────────────────────────────────────────

  var nodeDotById = {};   // nodeId -> DOM element
  var nodePos     = {};   // nodeId -> { x, y } (percentage-based centre)

  function buildStage(flow, stageEl) {
    var nodeIds = getFlowNodes(flow);
    var count   = nodeIds.length;
    var PAD_X   = 7;  // % from left/right edge
    var MID_Y   = 50; // % from top for the single horizontal row

    // Compute positions (horizontal spread)
    nodeIds.forEach(function (id, i) {
      var x = count > 1
        ? PAD_X + (i / (count - 1)) * (100 - 2 * PAD_X)
        : 50;
      nodePos[id] = { x: x, y: MID_Y };
    });

    // SVG for path lines
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "lc-path-svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("preserveAspectRatio", "none");
    stageEl.appendChild(svg);

    // Draw connecting lines between consecutive flow steps
    flow.forEach(function (step, i) {
      var fromPos = nodePos[step.fromId];
      var toPos   = nodePos[step.toId];
      if (!fromPos || !toPos) return;
      var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "lc-path-line");
      line.setAttribute("data-step", String(i));
      // We use % via viewBox. Set viewBox on svg later when we know stage size.
      // Store percentage values; position() will convert to px.
      line.setAttribute("data-x1", fromPos.x);
      line.setAttribute("data-y1", fromPos.y);
      line.setAttribute("data-x2", toPos.x);
      line.setAttribute("data-y2", toPos.y);
      svg.appendChild(line);
    });

    // Draw node dots
    nodeIds.forEach(function (id) {
      var node  = nodeById[id];
      var layer = layerById[id];
      var pos   = nodePos[id];
      var accent = layer ? getLayerAccent(layer.id) : "var(--accent-4)";

      var dot = document.createElement("div");
      dot.className = "lc-node-dot";
      dot.id = "lc-dot-" + id;
      dot.style.setProperty("--lc-node-accent", accent);
      dot.style.left = pos.x + "%";
      dot.style.top  = pos.y + "%";
      dot.setAttribute("aria-hidden", "true");

      // Short label inside dot: up to 3 chars
      var shortName = (node ? node.name : id).slice(0, 4);
      dot.textContent = shortName;

      // Label below dot
      var label = document.createElement("span");
      label.className = "lc-node-label";
      label.textContent = node ? node.name : id;
      dot.appendChild(label);

      stageEl.appendChild(dot);
      nodeDotById[id] = dot;
    });

    // Position SVG lines based on stage dimensions
    positionLines(stageEl, svg);

    // Token
    var token = document.createElement("div");
    token.className = "lc-token";
    token.id = "lc-token";
    token.setAttribute("aria-hidden", "true");
    stageEl.appendChild(token);

    return { svg: svg, token: token };
  }

  function positionLines(stageEl, svg) {
    var w = stageEl.offsetWidth  || 600;
    var h = stageEl.offsetHeight || 200;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("width",  w);
    svg.setAttribute("height", h);

    var lines = svg.querySelectorAll(".lc-path-line");
    Array.prototype.forEach.call(lines, function (line) {
      line.setAttribute("x1", (parseFloat(line.getAttribute("data-x1")) / 100) * w);
      line.setAttribute("y1", (parseFloat(line.getAttribute("data-y1")) / 100) * h);
      line.setAttribute("x2", (parseFloat(line.getAttribute("data-x2")) / 100) * w);
      line.setAttribute("y2", (parseFloat(line.getAttribute("data-y2")) / 100) * h);
    });
  }

  // ── token animation ────────────────────────────────────────

  var SPEEDS = [1, 2, 0.5];
  var speedIdx = 0;
  var stepIndex = 0;        // 0-based index into flow array
  var playing   = false;
  var animRaf   = null;
  var playTimer = null;

  function getTokenDuration() {
    return SPEEDS[speedIdx] === 0 ? 600 : Math.round(600 / SPEEDS[speedIdx]);
  }

  function pxPos(id, stageEl) {
    var pos = nodePos[id];
    if (!pos) return { x: 0, y: 0 };
    return {
      x: (pos.x / 100) * stageEl.offsetWidth,
      y: (pos.y / 100) * stageEl.offsetHeight
    };
  }

  function moveTokenTo(toId, stageEl, token, onDone) {
    if (REDUCED) {
      // Jump instantly
      var p = pxPos(toId, stageEl);
      token.style.left = p.x + "px";
      token.style.top  = p.y + "px";
      pulseNode(toId);
      if (onDone) onDone();
      return;
    }

    var fromLeft = parseFloat(token.style.left) || 0;
    var fromTop  = parseFloat(token.style.top)  || 0;
    var toP = pxPos(toId, stageEl);
    var dur  = getTokenDuration();
    var start = null;

    if (animRaf) { cancelAnimationFrame(animRaf); animRaf = null; }

    function step(ts) {
      if (!start) start = ts;
      var t = Math.min((ts - start) / dur, 1);
      // ease-out cubic
      var e = 1 - Math.pow(1 - t, 3);
      token.style.left = (fromLeft + (toP.x - fromLeft) * e) + "px";
      token.style.top  = (fromTop  + (toP.y - fromTop)  * e) + "px";
      if (t < 1) {
        animRaf = requestAnimationFrame(step);
      } else {
        animRaf = null;
        pulseNode(toId);
        if (onDone) onDone();
      }
    }
    animRaf = requestAnimationFrame(step);
  }

  function pulseNode(nodeId) {
    var dot = nodeDotById[nodeId];
    if (!dot || REDUCED) return;
    dot.classList.remove("is-pulse");
    // force reflow to restart animation
    void dot.offsetWidth;
    dot.classList.add("is-pulse");
    window.setTimeout(function () { dot.classList.remove("is-pulse"); }, 420);
  }

  // ── narration + line state ─────────────────────────────────

  function updateActiveDotAria(flow, idx) {
    // Remove aria-current from all dots, set on active toId dot
    Object.keys(nodeDotById).forEach(function (id) {
      var dot = nodeDotById[id];
      if (dot) dot.removeAttribute("aria-current");
    });
    var step = flow[idx];
    if (step && nodeDotById[step.toId]) {
      nodeDotById[step.toId].setAttribute("aria-current", "step");
    }
  }

  function updateNarration(flow, idx) {
    var step = flow[idx];
    var numEl  = document.getElementById("narration-step-num");
    var textEl = document.getElementById("narration-text");
    var lblEl  = document.getElementById("narration-label");
    if (numEl)  numEl.textContent  = String(idx + 1);
    if (textEl) textEl.textContent = step ? step.narrative : "";
    if (lblEl)  lblEl.textContent  = step ? step.label     : "";
    updateActiveDotAria(flow, idx);
  }

  function updatePathLines(flow, idx) {
    var lines = document.querySelectorAll(".lc-path-line");
    Array.prototype.forEach.call(lines, function (line) {
      var lineStep = parseInt(line.getAttribute("data-step"), 10);
      line.classList.toggle("is-active", lineStep < idx);
    });
  }

  function updateMapHighlight(flow, idx) {
    if (!window.mapAPI) return;
    var step = flow[idx];
    if (!step) return;
    var layer = layerById[step.toId];
    if (layer) {
      window.mapAPI.highlightLayer(layer.id);
    }
  }

  // ── step logic ─────────────────────────────────────────────

  function goToStep(idx, flow, stageEl, token) {
    stepIndex = Math.max(0, Math.min(idx, flow.length - 1));
    var step = flow[stepIndex];
    updateNarration(flow, stepIndex);
    updatePathLines(flow, stepIndex);
    updateMapHighlight(flow, stepIndex);

    // Position token at toId of current step
    moveTokenTo(step.toId, stageEl, token, null);
  }

  // ── play/pause ─────────────────────────────────────────────

  var playBtn;

  function advancePlay(flow, stageEl, token) {
    if (stepIndex >= flow.length - 1) {
      // Reached end
      setPlaying(false);
      return;
    }
    var nextIdx = stepIndex + 1;
    goToStep(nextIdx, flow, stageEl, token);

    // Schedule next advance after animation duration + small gap
    playTimer = window.setTimeout(function () {
      if (playing) advancePlay(flow, stageEl, token);
    }, getTokenDuration() + 200);
  }

  function setPlaying(val) {
    playing = val;
    if (playBtn) {
      playBtn.textContent = playing ? "⏸" : "▶";
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    }
    if (!playing) {
      if (playTimer) { clearTimeout(playTimer); playTimer = null; }
      if (animRaf)   { cancelAnimationFrame(animRaf); animRaf = null; }
    }
  }

  // ── controls ──────────────────────────────────────────────

  function wireControls(flow, stageEl, token) {
    playBtn = document.getElementById("lc-play");
    var prevBtn    = document.getElementById("lc-prev");
    var nextBtn    = document.getElementById("lc-next");
    var restartBtn = document.getElementById("lc-restart");
    var speedBtn   = document.getElementById("lc-speed");

    if (playBtn) {
      playBtn.addEventListener("click", function () {
        if (playing) {
          setPlaying(false);
        } else {
          // If at last step, restart first
          if (stepIndex >= flow.length - 1) {
            resetToStart(flow, stageEl, token);
          }
          setPlaying(true);
          advancePlay(flow, stageEl, token);
        }
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        setPlaying(false);
        if (stepIndex > 0) goToStep(stepIndex - 1, flow, stageEl, token);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        setPlaying(false);
        if (stepIndex < flow.length - 1) goToStep(stepIndex + 1, flow, stageEl, token);
      });
    }

    if (restartBtn) {
      restartBtn.addEventListener("click", function () {
        setPlaying(false);
        resetToStart(flow, stageEl, token);
      });
    }

    if (speedBtn) {
      speedBtn.addEventListener("click", function () {
        speedIdx = (speedIdx + 1) % SPEEDS.length;
        var labels = ["1×", "2×", "0.5×"];
        speedBtn.textContent = labels[speedIdx];
      });
    }
  }

  function resetToStart(flow, stageEl, token) {
    stepIndex = 0;
    updateNarration(flow, 0);
    updatePathLines(flow, 0);
    // Place token at fromId of first step
    var startPos = pxPos(flow[0].fromId, stageEl);
    token.style.left = startPos.x + "px";
    token.style.top  = startPos.y + "px";
    if (window.mapAPI) window.mapAPI.clearHighlight();
  }

  // ── populate text list (a11y) ──────────────────────────────

  function buildTextList(flow) {
    var ol = document.getElementById("lifecycle-steps-ol");
    if (!ol) return;
    flow.forEach(function (step) {
      var li = document.createElement("li");
      li.setAttribute("aria-label", "Step " + step.step + ": " + step.label);
      li.innerHTML = "<strong>Step " + step.step + " — " + step.label + ":</strong> " + step.narrative;
      ol.appendChild(li);
    });
  }

  // ── resize handler ─────────────────────────────────────────

  function scheduleResize(stageEl, svg, token, flow) {
    var pending = false;
    function onResize() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        positionLines(stageEl, svg);
        // Reposition token without animation
        var step = flow[stepIndex];
        if (step) {
          var p = pxPos(step.toId, stageEl);
          token.style.left = p.x + "px";
          token.style.top  = p.y + "px";
        }
      });
    }
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(onResize).observe(stageEl);
    } else {
      window.addEventListener("resize", onResize);
    }
  }

  // ── init ──────────────────────────────────────────────────

  function initLifecycle() {
    var arch = window.ARCH;
    if (!arch || !Array.isArray(arch.flow) || !arch.flow.length) return;

    var stageEl = document.getElementById("lifecycle-stage");
    if (!stageEl) return;

    buildLookups(arch);

    var result = buildStage(arch.flow, stageEl);
    var svg    = result.svg;
    var token  = result.token;

    // Initial narration (step 0 state, not yet moved)
    updateNarration(arch.flow, 0);
    document.getElementById("narration-text").textContent = "Click Play to begin.";
    document.getElementById("narration-label").textContent = "";

    // Place token at start node
    requestAnimationFrame(function () {
      positionLines(stageEl, svg);
      var startPos = pxPos(arch.flow[0].fromId, stageEl);
      token.style.left = startPos.x + "px";
      token.style.top  = startPos.y + "px";
      wireControls(arch.flow, stageEl, token);
      scheduleResize(stageEl, svg, token, arch.flow);
    });

    buildTextList(arch.flow);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLifecycle);
  } else {
    initLifecycle();
  }
})();

/* ============================================================
   Scroll-driven storytelling
   - Scroll progress bar
   - Layer mini-nav (dot navigation)
   - Storytelling two-column layout (desktop ≥ 900px)
   - Scroll-synced map highlighting
   ============================================================ */
(function () {
  "use strict";

  var REDUCED = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── scroll progress bar ──────────────────────────────────────

  function initProgressBar() {
    var bar = document.getElementById("scroll-progress");
    if (!bar) return;

    var rafPending = false;

    function updateBar() {
      rafPending = false;
      var docH = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      if (docH <= 0) { bar.style.transform = "scaleX(1)"; return; }
      var pct = window.scrollY / docH;
      bar.style.transform = "scaleX(" + pct + ")";
    }

    window.addEventListener("scroll", function () {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(updateBar);
      }
    }, { passive: true });

    updateBar(); // set initial state
  }

  // ── storytelling layout (inject wrapper div) ─────────────────

  function initStorytellingLayout() {
    var layersSection = document.getElementById("layers");
    var mapSection    = document.getElementById("map");
    if (!layersSection || !mapSection) return;

    // Only restructure if they are adjacent siblings
    if (layersSection.nextElementSibling !== mapSection) return;

    var wrapper = document.createElement("div");
    wrapper.className = "storytelling-layout";

    var parent = layersSection.parentNode;
    parent.insertBefore(wrapper, layersSection);
    wrapper.appendChild(layersSection);
    wrapper.appendChild(mapSection);
  }

  // ── mini-nav dots ────────────────────────────────────────────

  function initMiniNav(layers) {
    var nav = document.createElement("nav");
    nav.className = "layer-mini-nav";
    nav.setAttribute("aria-label", "Layer navigation");

    var dots = [];

    layers.forEach(function (layer) {
      var dot = document.createElement("button");
      dot.className = "mini-nav-dot";
      dot.setAttribute("data-layer-id", layer.id);
      dot.setAttribute("aria-label", "Jump to " + layer.title);
      dot.title = layer.title;
      dot.style.setProperty("--dot-accent", layer.accent || "var(--accent-4)");

      dot.addEventListener("click", function () {
        var target = document.getElementById("layer-" + layer.id);
        if (!target) return;
        target.scrollIntoView({
          behavior: REDUCED ? "auto" : "smooth",
          block: "start"
        });
      });

      dots.push(dot);
      nav.appendChild(dot);
    });

    document.body.appendChild(nav);
    return dots;
  }

  // ── active layer tracking ────────────────────────────────────

  function initScrollSync(layers, dots) {
    var layerEls = layers.map(function (layer) {
      return document.getElementById("layer-" + layer.id);
    }).filter(Boolean);

    var activeDotIndex = -1;

    function setActiveDot(index) {
      if (index === activeDotIndex) return;
      activeDotIndex = index;
      dots.forEach(function (dot, i) {
        dot.classList.toggle("is-active", i === index);
      });
    }

    function setActiveMapLayer(layerId) {
      if (!window.mapAPI) return;
      if (REDUCED) {
        // instant, no transition
        if (layerId) {
          window.mapAPI.highlightLayer(layerId);
        } else {
          window.mapAPI.clearHighlight();
        }
      } else {
        if (layerId) {
          window.mapAPI.highlightLayer(layerId);
        } else {
          window.mapAPI.clearHighlight();
        }
      }
    }

    if (!("IntersectionObserver" in window)) {
      // Fallback: no sync
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var id = entry.target.id; // "layer-clients" etc.
        var layerId = id.replace("layer-", "");
        var idx = layers.findIndex
          ? layers.findIndex(function (l) { return l.id === layerId; })
          : (function () {
              var found = -1;
              layers.forEach(function (l, i) { if (l.id === layerId) found = i; });
              return found;
            })();

        if (entry.isIntersecting) {
          setActiveDot(idx);
          setActiveMapLayer(layerId);
        } else {
          // When the active layer leaves, check if no other is intersecting
          // We clear only if this was the active one
          if (activeDotIndex === idx) {
            setActiveDot(-1);
            setActiveMapLayer(null);
          }
        }
      });
    }, { threshold: 0.35 });

    layerEls.forEach(function (el) { io.observe(el); });
  }

  // ── boot ─────────────────────────────────────────────────────

  function init3() {
    initProgressBar();
    initStorytellingLayout();

    var arch = window.ARCH;
    if (!arch || !Array.isArray(arch.layers)) return;

    var dots = initMiniNav(arch.layers);
    initScrollSync(arch.layers, dots);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init3);
  } else {
    init3();
  }
})();
