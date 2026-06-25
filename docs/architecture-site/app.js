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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
