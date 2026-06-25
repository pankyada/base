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
   Interactive Component Map
   Depends on window.ARCH (from data.js).
   ============================================================ */
(function () {
  "use strict";

  // ── helpers ─────────────────────────────────────────────────

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function svgEl(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  // ── build lookup tables from ARCH ────────────────────────────

  var nodeById   = {};   // nodeId -> node data
  var layerById  = {};   // nodeId -> layer data
  var btnById    = {};   // nodeId -> DOM <button>
  var lineById   = {};   // edgeIndex (string) -> SVG line el

  // adjacency: nodeId -> Set of neighbour nodeIds
  var neighbours = {};

  function buildLookups(arch) {
    arch.layers.forEach(function (layer) {
      layer.nodes.forEach(function (n) {
        nodeById[n.id]  = n;
        layerById[n.id] = layer;
        // neighbours already pre-seeded by initMap
      });
    });

    arch.edges.forEach(function (edge) {
      if (!neighbours[edge.from]) neighbours[edge.from] = makeSet();
      if (!neighbours[edge.to])   neighbours[edge.to]   = makeSet();
      neighbourAdd(edge.from, edge.to);
      neighbourAdd(edge.to, edge.from);
    });
  }

  // Simple Set polyfill shim (use native Set when available)
  function makeSet() { return typeof Set !== "undefined" ? new Set() : { _a: [], has: function(v){ return this._a.indexOf(v) !== -1; }, add: function(v){ if(!this.has(v)) this._a.push(v); } }; }

  function neighbourAdd(a, b) {
    if (!neighbours[a]) neighbours[a] = makeSet();
    neighbours[a].add(b);
  }

  function isNeighbour(a, b) {
    return neighbours[a] && neighbours[a].has(b);
  }

  // ── render bands ─────────────────────────────────────────────

  function renderBands(arch, canvas) {
    arch.layers.forEach(function (layer) {
      var band = el("div", "map-band");
      band.setAttribute("data-layer", layer.id);

      var label = el("div", "map-band-label");
      label.textContent = layer.title;
      label.style.color = layer.accent || "";
      band.appendChild(label);

      var row = el("div", "map-nodes-row");

      layer.nodes.forEach(function (n) {
        var btn = document.createElement("button");
        btn.className = "map-node-btn";
        btn.setAttribute("role", "button");
        btn.setAttribute("tabindex", "0");
        btn.setAttribute("data-node-id", n.id);
        btn.style.setProperty("--node-accent", layer.accent || "#4cc9f0");

        var dot = el("span", "dot");
        dot.style.background = layer.accent || "#4cc9f0";
        dot.style.color = layer.accent || "#4cc9f0";
        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(n.name));

        row.appendChild(btn);
        btnById[n.id] = btn;
      });

      band.appendChild(row);
      canvas.appendChild(band);
    });
  }

  // ── SVG edge overlay ─────────────────────────────────────────

  var EDGE_STYLES = {
    primary:    { stroke: "#ffd166", width: "2",   dasharray: "none",  diamond: false },
    data:       { stroke: "#06d6a0", width: "2",   dasharray: "5 4",   diamond: false },
    optional:   { stroke: "#4cc9f0", width: "1.5", dasharray: "2.5 3.5", diamond: false },
    dependency: { stroke: "#ff6b9d", width: "1",   dasharray: "none",  diamond: true }
  };

  function renderEdges(arch, canvas) {
    var svg = svgEl("svg");
    svg.setAttribute("class", "map-edges-svg");
    svg.setAttribute("aria-hidden", "true");

    // defs for diamond marker
    var defs = svgEl("defs");
    var marker = svgEl("marker");
    marker.setAttribute("id", "diamond-end");
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("refX", "4");
    marker.setAttribute("refY", "4");
    marker.setAttribute("orient", "auto");
    var poly = svgEl("polygon");
    poly.setAttribute("points", "0,2 4,4 0,6 8,4");
    poly.setAttribute("fill", "#ff6b9d");
    marker.appendChild(poly);
    defs.appendChild(marker);
    svg.appendChild(defs);

    arch.edges.forEach(function (edge, i) {
      var style = EDGE_STYLES[edge.kind] || EDGE_STYLES.primary;
      var line = svgEl("line");
      line.setAttribute("class", "map-edge");
      line.setAttribute("stroke", style.stroke);
      line.setAttribute("stroke-width", style.width);
      if (style.dasharray !== "none") {
        line.setAttribute("stroke-dasharray", style.dasharray);
      }
      if (style.diamond) {
        line.setAttribute("marker-end", "url(#diamond-end)");
      }
      line.setAttribute("data-from", edge.from);
      line.setAttribute("data-to", edge.to);
      // positions set by positionEdges()
      lineById[String(i)] = line;
      svg.appendChild(line);
    });

    canvas.appendChild(svg);
    return svg;
  }

  // ── position edges ───────────────────────────────────────────

  function getNodeCenter(nodeId, canvasRect) {
    var btn = btnById[nodeId];
    if (!btn) return null;
    var r = btn.getBoundingClientRect();
    return {
      x: r.left + r.width / 2  - canvasRect.left,
      y: r.top  + r.height / 2 - canvasRect.top
    };
  }

  function positionEdges(arch, canvas) {
    var canvasRect = canvas.getBoundingClientRect();
    arch.edges.forEach(function (edge, i) {
      var line = lineById[String(i)];
      if (!line) return;
      var from = getNodeCenter(edge.from, canvasRect);
      var to   = getNodeCenter(edge.to,   canvasRect);
      if (!from || !to) return;
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
    });
  }

  // ── highlight logic ──────────────────────────────────────────

  var allNodeIds = [];

  function highlight(activeId) {
    var nbrs = neighbours[activeId] || makeSet();
    allNodeIds.forEach(function (id) {
      var btn = btnById[id];
      if (!btn) return;
      btn.classList.remove("is-active", "is-dim");
      if (id === activeId) {
        btn.classList.add("is-active");
      } else if (nbrs.has(id)) {
        btn.classList.add("is-active");
      } else {
        btn.classList.add("is-dim");
      }
    });

    // edges
    Object.keys(lineById).forEach(function (i) {
      var line = lineById[i];
      var from = line.getAttribute("data-from");
      var to   = line.getAttribute("data-to");
      line.classList.remove("is-dim");
      // dim if neither endpoint is active
      if (from !== activeId && to !== activeId) {
        line.classList.add("is-dim");
      }
    });
  }

  function clearHighlight() {
    allNodeIds.forEach(function (id) {
      var btn = btnById[id];
      if (btn) btn.classList.remove("is-active", "is-dim");
    });
    Object.keys(lineById).forEach(function (i) {
      lineById[i].classList.remove("is-dim");
    });
  }

  // ── detail panel ─────────────────────────────────────────────

  var panelOpen = false;
  var panelTriggerNode = null;   // nodeId that opened the panel
  var panelEl, backdropEl, closeBtn;
  var PANEL_FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function openPanel(nodeId) {
    var n      = nodeById[nodeId];
    var layer  = layerById[nodeId];
    if (!n || !layer || !panelEl) return;

    panelTriggerNode = nodeId;

    document.getElementById("panel-layer-name").textContent = layer.title;
    document.getElementById("panel-node-name").textContent  = n.name;
    document.getElementById("panel-responsibility").textContent = n.responsibility || "";
    document.getElementById("panel-detail").textContent     = n.detail || "";

    var filesEl = document.getElementById("panel-files");
    filesEl.innerHTML = "";
    if (n.files && n.files.length) {
      n.files.forEach(function (f) {
        var code = document.createElement("code");
        code.textContent = f;
        filesEl.appendChild(code);
      });
    } else {
      var code = document.createElement("code");
      code.textContent = "external — no source file";
      filesEl.appendChild(code);
    }

    panelEl.classList.add("is-open");
    panelEl.setAttribute("aria-hidden", "false");
    backdropEl.classList.add("is-open");
    // backdrop is decorative — keep aria-hidden true at all times
    panelOpen = true;

    // focus close button
    if (closeBtn) closeBtn.focus();
  }

  function closePanel() {
    if (!panelEl) return;
    panelEl.classList.remove("is-open");
    panelEl.setAttribute("aria-hidden", "true");
    backdropEl.classList.remove("is-open");
    panelOpen = false;

    // return focus to trigger
    if (panelTriggerNode && btnById[panelTriggerNode]) {
      btnById[panelTriggerNode].focus();
    }
    panelTriggerNode = null;
  }

  // Focus trap inside panel
  function trapFocus(e) {
    if (!panelOpen || !panelEl) return;
    var focusable = Array.prototype.slice.call(panelEl.querySelectorAll(PANEL_FOCUSABLE));
    if (!focusable.length) return;
    var first = focusable[0];
    var last  = focusable[focusable.length - 1];
    if (e.key === "Tab") {
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closePanel();
    }
  }

  // ── wire events ──────────────────────────────────────────────

  function wireNodeEvents() {
    allNodeIds.forEach(function (id) {
      var btn = btnById[id];
      if (!btn) return;

      btn.addEventListener("mouseenter", function () {
        highlight(id);
      });
      btn.addEventListener("mouseleave", function () {
        clearHighlight();
      });
      btn.addEventListener("focus", function () {
        highlight(id);
      });
      btn.addEventListener("blur", function () {
        // defer clear so focus-move within panel doesn't flicker
        requestAnimationFrame(function () {
          if (!panelEl || !panelEl.contains(document.activeElement)) {
            clearHighlight();
          }
        });
      });
      btn.addEventListener("click", function () {
        openPanel(id);
      });
      btn.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPanel(id);
        }
      });
    });
  }

  // ── resize reposition ────────────────────────────────────────

  function scheduleReposition(arch, canvas) {
    var pending = false;
    function reposition() {
      pending = false;
      positionEdges(arch, canvas);
    }
    function onResize() {
      if (!pending) {
        pending = true;
        requestAnimationFrame(reposition);
      }
    }

    if (typeof ResizeObserver !== "undefined") {
      var ro = new ResizeObserver(onResize);
      ro.observe(canvas);
    } else {
      window.addEventListener("resize", onResize);
    }
  }

  // ── init ─────────────────────────────────────────────────────

  function initMap() {
    var arch = window.ARCH;
    if (!arch || !Array.isArray(arch.layers)) return;

    var canvas = document.getElementById("map-canvas");
    if (!canvas) return;

    panelEl    = document.getElementById("map-panel");
    backdropEl = document.getElementById("map-backdrop");
    closeBtn   = document.getElementById("panel-close");

    // Reset Set-like neighbour storage
    arch.layers.forEach(function (layer) {
      layer.nodes.forEach(function (n) {
        allNodeIds.push(n.id);
        neighbours[n.id] = makeSet();
      });
    });

    buildLookups(arch);
    renderBands(arch, canvas);
    renderEdges(arch, canvas);

    // Position after first paint
    requestAnimationFrame(function () {
      positionEdges(arch, canvas);
    });

    wireNodeEvents();
    scheduleReposition(arch, canvas);

    // Panel close button
    if (closeBtn) {
      closeBtn.addEventListener("click", closePanel);
    }
    // Backdrop click closes
    if (backdropEl) {
      backdropEl.addEventListener("click", closePanel);
    }
    // Global keyboard handler
    document.addEventListener("keydown", function (e) {
      if (panelOpen) {
        trapFocus(e);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMap);
  } else {
    initMap();
  }

  // ── expose mapAPI for scroll sync ────────────────────────────

  function highlightLayer(layerId) {
    // Highlight all nodes belonging to the given layer
    var arch = window.ARCH;
    if (!arch) return;
    var layer = null;
    arch.layers.forEach(function (l) { if (l.id === layerId) layer = l; });
    if (!layer) return;

    var layerNodeIds = layer.nodes.map(function (n) { return n.id; });
    var layerSet = makeSet();
    layerNodeIds.forEach(function (id) { layerSet.add(id); });

    allNodeIds.forEach(function (id) {
      var btn = btnById[id];
      if (!btn) return;
      btn.classList.remove("is-active", "is-dim");
      if (layerSet.has(id)) {
        btn.classList.add("is-active");
      } else {
        btn.classList.add("is-dim");
      }
    });

    // dim edges whose both endpoints are not in this layer
    Object.keys(lineById).forEach(function (i) {
      var line = lineById[i];
      var from = line.getAttribute("data-from");
      var to   = line.getAttribute("data-to");
      line.classList.remove("is-dim");
      if (!layerSet.has(from) && !layerSet.has(to)) {
        line.classList.add("is-dim");
      }
    });

    // highlight the band label
    var bands = document.querySelectorAll(".map-band");
    Array.prototype.forEach.call(bands, function (band) {
      band.classList.remove("is-layer-active");
      if (band.getAttribute("data-layer") === layerId) {
        band.classList.add("is-layer-active");
        band.style.setProperty("--band-accent", layer.accent || "var(--accent-4)");
      }
    });
  }

  function clearHighlightAPI() {
    clearHighlight();
    var bands = document.querySelectorAll(".map-band");
    Array.prototype.forEach.call(bands, function (band) {
      band.classList.remove("is-layer-active");
    });
  }

  window.mapAPI = {
    highlightLayer: highlightLayer,
    clearHighlight: clearHighlightAPI
  };
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
