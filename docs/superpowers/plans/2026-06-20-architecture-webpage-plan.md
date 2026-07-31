# Plan: Animated Interactive Architecture Webpage

**Generated**: 2026-06-20
**Estimated Complexity**: Medium-High

## Overview

Build a standalone, playful, highly-interactive webpage that explains the agent
harness architecture and system design. Pure vanilla **HTML/CSS/JS, multi-file**
(no build step, no framework). Two headline interactions:

1. **Animated request lifecycle** — a play/step control that animates a user
   message flowing client → WS/auth → session → agent loop → provider → LLM and
   back, then through the tool-call path (ACL → built-ins/MCP/agents) and state writes.
2. **Scroll-driven storytelling** — sections reveal as you scroll and the central
   architecture diagram morphs/highlights to match the narrative.

Plus secondary interactivity: a clickable component map (hover/click a node →
highlight connections + detail panel with responsibilities and key source files).

Visual direction: **playful & bold** — bright accent palette, springy easing, big
type, generous micro-interactions, animated connectors. Content grounded in the
real modules (`src/server`, `src/loop`, `src/tools`, `src/memory`, `src/mcp`,
`src/skills`, `src/agents`, `src/scheduler`, `src/improver`, etc.) and the diagram
already produced at `docs/diagrams/harness-architecture.svg`.

**Delivery location**: `docs/architecture-site/` with `index.html`, `styles.css`,
`app.js`, `data.js` (architecture content as a JS object), and `assets/`.

**No external dependencies** (works offline by opening `index.html`). Optional
progressive enhancement: GSAP + ScrollTrigger via CDN, feature-detected, behind a
graceful fallback to native IntersectionObserver + CSS animations.

## Prerequisites
- Modern browser (Chromium/Firefox/Safari). No server required; `file://` works.
- Optional local static server for testing (`python3 -m http.server`).
- Source-of-truth content: the component inventory and runtime flow from
  `CLAUDE.md`, the modules table, and `docs/diagrams/harness-architecture.drawio`.

## Architecture content model (single source of truth)

All copy/structure lives in `data.js` as a global object so views render from data.
**No ES modules** — `data.js` and `app.js` load as classic `<script>` tags and
attach to `window` (`window.ARCH = {...}`), so the page works by double-clicking
`index.html` over `file://` with no server and no CORS issues:

```js
window.ARCH = {
  layers: [
    { id, title, accent, blurb, nodes: [
      { id, name, files:[...], responsibility, detail } ] } ],
  flow: [ { step, fromId, toId, label, narrative } ],   // lifecycle ordering
  edges: [ { from, to, kind } ],                          // primary/data/optional/dependency
}
```

Layers: Clients · Server/Transport · Core Agent Loop · Tools & Execution ·
Extensibility · State & Persistence · Scheduling & Self-Improvement · External.

---

## Sprint 1: Scaffold, design system & hero
**Goal**: Runnable page shell with the playful theme, fonts, layout, and an
animated hero. Opening `index.html` shows a styled landing with smooth intro motion.
**Demo/Validation**:
- Open `docs/architecture-site/index.html` → hero renders, intro animation plays.
- Resize window → layout holds at desktop/tablet/mobile widths.

### Task 1.1: Create file scaffold
- **Location**: `docs/architecture-site/{index.html,styles.css,app.js,data.js}`, `assets/`
- **Description**: Semantic HTML skeleton (header, hero, main with `<section>` per
  layer, footer), linked CSS and **classic** `<script src="data.js">` then
  `<script src="app.js">` (no `type="module"` — works over `file://`). Add a no-JS fallback note.
- **Acceptance Criteria**: Page loads with no console errors; sections present in DOM.
- **Validation**: Open in browser; check DevTools console clean.

### Task 1.2: Design tokens & base styles
- **Location**: `styles.css`
- **Description**: CSS custom properties for the playful palette (bold accents per
  layer matching diagram tints), type scale (large display font + readable body),
  spacing, radius, shadow, motion vars (`--ease-spring`, durations). Dark-on-bright
  or vivid light background per "playful & bold". Respect `prefers-reduced-motion`.
- **Acceptance Criteria**: Tokens applied; one accent per layer; reduced-motion media query present.
- **Validation**: Toggle OS reduced-motion → non-essential animations disabled.

### Task 1.3: Animated hero
- **Location**: `index.html`, `styles.css`, `app.js`
- **Description**: Headline ("Agent Harness — How it works"), subhead, CTA buttons
  ("Play the request lifecycle", "Explore the map"). Springy entrance animation
  (staggered fade/slide via CSS keyframes or Web Animations API) and a subtle
  looping background motion (CSS or canvas particles).
- **Dependencies**: 1.1, 1.2
- **Acceptance Criteria**: Hero animates in on load; CTAs scroll to their sections.
- **Validation**: Reload → intro plays; click CTAs → smooth scroll to targets.

### Task 1.4: Populate `data.js` with full architecture model
- **Location**: `data.js`
- **Description**: Encode all 8 layers, ~28 components with real `files`,
  `responsibility`, and a longer `detail` string; the `edges` list; and the ordered
  `flow` steps for the lifecycle (with per-step narrative). Source from `src/` tree.
- **Dependencies**: 1.1
- **Acceptance Criteria**: `ARCH.layers` covers every component in the diagram; each node has ≥1 file path.
- **Validation**: `console.log(ARCH)` shows complete structure; counts match diagram.

---

## Sprint 2: Interactive component map
**Goal**: A central, responsive architecture diagram rendered from `data.js`.
Hover/click nodes to highlight connected edges and open a detail panel.
**Demo/Validation**:
- Hover a node → it + its edges + neighbors highlight; others dim.
- Click a node → detail panel shows name, responsibility, files, detail text.
- Click empty space / Esc → panel closes, highlight resets.

### Task 2.1: Render the layered map from data
- **Location**: `index.html` (map container), `app.js`, `styles.css`
- **Description**: Build the band layout (8 layers) and node cards from `ARCH`.
  Use CSS grid for bands + absolutely-positioned SVG/Canvas overlay for connectors,
  OR an inline SVG generated in JS. Connectors styled by `kind`
  (primary/data/optional/dependency) matching the diagram legend.
- **Dependencies**: 1.4
- **Acceptance Criteria**: All nodes/edges render; legend visible; layout responsive.
- **Validation**: Compare node/edge counts to `docs/diagrams/harness-architecture.drawio`.

### Task 2.2: Hover/focus highlighting
- **Location**: `app.js`, `styles.css`
- **Description**: On node hover/focus, compute connected edge+node set and apply
  `.is-active` / `.is-dim` classes; animate stroke/glow on active connectors.
  Keyboard accessible (Tab focus triggers same state).
- **Dependencies**: 2.1
- **Acceptance Criteria**: Highlight works on mouse AND keyboard; resets on blur.
- **Validation**: Tab through nodes → highlight follows focus.

### Task 2.3: Detail panel
- **Location**: `index.html` (panel markup), `app.js`, `styles.css`
- **Description**: Slide-in side panel populated from the clicked node's data
  (name, layer, responsibility, file list as `code`, detail prose). Close via button/Esc/backdrop.
- **Dependencies**: 2.1
- **Acceptance Criteria**: Panel opens with correct data; focus-trapped; Esc closes.
- **Validation**: Click several nodes → content matches `data.js`.

---

## Sprint 3: Scroll-driven storytelling
**Goal**: Narrative sections that reveal on scroll while the map highlights the
layer/components being discussed.
**Demo/Validation**:
- Scroll down → each section fades/slides in; the map auto-highlights the active layer.
- Scroll back up → states reverse cleanly; no jank.

### Task 3.1: Reveal-on-scroll for sections
- **Location**: `app.js`, `styles.css`
- **Description**: `IntersectionObserver` adds `.in-view` to sections; CSS handles
  staggered reveal. Disabled under reduced-motion (content shown immediately).
- **Dependencies**: 1.1
- **Acceptance Criteria**: Sections reveal once in viewport; reduced-motion shows all.
- **Validation**: Scroll slowly → reveals trigger near viewport center.

### Task 3.2: Scroll-synced map highlighting
- **Location**: `app.js`
- **Description**: As each layer's narrative section enters view, drive the same
  highlight system from Sprint 2 to spotlight that layer's nodes (sticky/pinned map
  beside the scrolling narrative on desktop; stacked on mobile).
- **Dependencies**: 2.2, 3.1
- **Acceptance Criteria**: Active section ↔ highlighted layer stay in sync both directions.
- **Validation**: Scroll through all layers → highlight tracks the active section.

### Task 3.3: Sticky map layout + progress indicator
- **Location**: `index.html`, `styles.css`, `app.js`
- **Description**: Two-column on desktop (sticky map left, narrative right); a thin
  scroll-progress bar and a layer mini-nav (dots) that scroll to sections.
- **Dependencies**: 3.2
- **Acceptance Criteria**: Map stays pinned while narrative scrolls; mini-nav jumps work.
- **Validation**: Desktop + mobile manual check; progress bar fills 0→100%.

---

## Sprint 4: Animated request lifecycle
**Goal**: A play/step control that animates a request traveling the system path
with synchronized narration.
**Demo/Validation**:
- Click "Play" → a token/particle travels along the flow edges step by step.
- Step controls (next/prev/restart) move through `ARCH.flow`; narration updates.

### Task 4.1: Lifecycle path + animation engine
- **Location**: `app.js`
- **Description**: From `ARCH.flow`, compute the ordered path of node centers; animate
  a glowing "request" token along each segment using `requestAnimationFrame`
  (or Web Animations API `motionPath`/offset-path fallback). Pulse source/target nodes on arrival.
- **Dependencies**: 2.1
- **Acceptance Criteria**: Token follows the exact edge path; timing smooth (~60fps).
- **Validation**: Play full sequence → token visits each step in order.

### Task 4.2: Play / step / restart controls + narration
- **Location**: `index.html`, `app.js`, `styles.css`
- **Description**: Transport bar (Play/Pause, Prev, Next, Restart, speed toggle).
  Each step shows its `narrative` in a caption and highlights the active component.
  Auto-advance on Play; manual on step buttons.
- **Dependencies**: 4.1
- **Acceptance Criteria**: All controls work; narration matches current step.
- **Validation**: Pause mid-flow, step manually, restart → state consistent.

### Task 4.3: Branch animations (tool-call + state writes)
- **Location**: `app.js`, `data.js`
- **Description**: Extend the flow to show the tool-call fan-out (loop → registry →
  ACL → allow/prompt/deny → built-ins/MCP/agents → hooks) and async state writes
  (telemetry/usage/memory) as parallel/secondary particle tracks.
- **Dependencies**: 4.1
- **Acceptance Criteria**: Tool branch + state writes animate distinctly (color/track).
- **Validation**: Visual check the branch fires after the LLM tool-call step.

---

## Sprint 5: Polish, accessibility, performance & ship
**Goal**: Production-quality finish: responsive, accessible, performant, documented.
**Demo/Validation**: Lighthouse pass; keyboard-only navigation works; mobile usable.

### Task 5.1: Responsive + mobile interactions
- **Location**: `styles.css`, `app.js`
- **Description**: Stack map/narrative on small screens; tap = hover for nodes;
  ensure lifecycle and panels are usable on touch. Test 360px → 1440px.
- **Acceptance Criteria**: No horizontal overflow; all features reachable on mobile.
- **Validation**: DevTools device emulation across breakpoints.

### Task 5.2: Accessibility pass
- **Location**: all files
- **Description**: Semantic landmarks, ARIA on panel/controls, focus management,
  visible focus rings, color-contrast AA, `prefers-reduced-motion` honored everywhere,
  alt/labels. Lifecycle has a text-equivalent step list.
- **Acceptance Criteria**: Keyboard-only completes every interaction; axe/Lighthouse a11y ≥ 95.
- **Validation**: Run Lighthouse a11y; manual keyboard sweep.

### Task 5.3: Performance + offline check
- **Location**: all files
- **Description**: Throttle scroll/observer work; use CSS transforms/opacity for
  animations (GPU-friendly); lazy-init lifecycle engine; verify it opens from
  `file://` with no network. Optional GSAP enhancement feature-detected.
- **Acceptance Criteria**: Smooth on mid-tier hardware; works fully offline.
- **Validation**: Open via `file://` with network disabled → all features work.

### Task 5.4: Content QA + README + deploy note
- **Location**: `docs/architecture-site/README.md`
- **Description**: Proofread copy against `src/`; verify every file path exists;
  document how to run/host (open file or GitHub Pages from `docs/`). Note optional
  hook into the docs CI workflow.
- **Acceptance Criteria**: All referenced file paths resolve; README explains run/deploy.
- **Validation**: `for f in $(grep -o paths); do test -e $f; done` style spot-check.

## Testing Strategy
- Per sprint: open in browser, verify the demo checklist, console clean.
- Cross-browser: Chromium + Firefox + Safari smoke test.
- Accessibility: Lighthouse + keyboard-only sweep (Sprint 5).
- Offline: load via `file://` with network off (Sprint 5).
- Content integrity: every `files:[...]` entry in `data.js` must exist under `src/`.

## Potential Risks & Gotchas
- **`file://` + ES modules**: RESOLVED — plan uses classic `<script>` tags with a
  `window.ARCH` global (no `import`/`export`), so double-clicking `index.html` works
  with no server. (A `python3 -m http.server` is still fine for dev but not required.)
- **SVG vs Canvas for connectors**: SVG is easier for hit-testing/highlighting and
  motion-path; Canvas is faster for many particles. Decision: SVG for the static map
  + highlighting; lightweight canvas/DOM token for the lifecycle particle. Lock in Sprint 2.
- **offset-path / motion-path support**: Safari quirks. Provide rAF linear-interp
  fallback (compute points manually) — already the primary approach in 4.1.
- **Scroll-jank**: heavy work in scroll handlers. Use IntersectionObserver, not
  scroll listeners; rAF-batch any measurement.
- **Sticky map + mobile**: sticky two-column doesn't fit narrow screens. Stack and
  switch the lifecycle to a tap-through (Sprint 5.1).
- **Reduced-motion**: must fully disable particle/looping motion and show static
  states + text equivalents, or the page is unusable for sensitive users.
- **Content drift**: file paths may change. README documents the integrity check.

## Rollback Plan
- Entirely additive under `docs/architecture-site/` — delete the folder to remove.
- No changes to app source, build, or CI unless 5.4's optional CI hook is adopted
  (separate, revertable commit).
