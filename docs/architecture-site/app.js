/* app.js — Agent Harness architecture site (Sprint 1)
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
   Sprint 2 — Interactive Component Map
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
    backdropEl.setAttribute("aria-hidden", "false");
    panelOpen = true;

    // focus close button
    if (closeBtn) closeBtn.focus();
  }

  function closePanel() {
    if (!panelEl) return;
    panelEl.classList.remove("is-open");
    panelEl.setAttribute("aria-hidden", "true");
    backdropEl.classList.remove("is-open");
    backdropEl.setAttribute("aria-hidden", "true");
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
})();
