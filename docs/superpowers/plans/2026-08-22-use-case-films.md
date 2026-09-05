# Plan: animated use-case films for the docs site

**Generated**: 2026-08-22
**Estimated Complexity**: Medium (5 sprints; S1 sets a schema the other four depend on)
**Status**: implemented 2026-08-22 — all 5 sprints complete. `motion` chosen
(no fallback needed, see design §1 note). Schema survived the ops film
unchanged (Sprint 2 needed no reconciliation). Citation test passes
(26/26) and was demonstrated failing on an injected bad path, then reverted.
Visual/interaction verification done via DOM/computed-style/console
inspection rather than screenshots — the browser preview tool's screenshot
capture was stuck on a stale frame for this session; `pnpm --filter
harness-docs build` succeeded and `get_page_text` confirmed all four films'
full correct content and beat ordering.

## Overview

Four animated narrative walkthroughs — one per use case in
`docs-site/use-cases.md` — on a new "How it works" page, built as Vue
components in the VitePress theme, driven by a declarative scene model.

Full rationale is in
`docs/superpowers/specs/2026-08-22-use-case-films-design.md` — **read it in
full before starting**, especially §"What already exists", which lists two
animation surfaces that already ship and must not be rebuilt or forked.

**Tech stack:** VitePress 1.5 + Vue 3 SFCs in `docs-site/.vitepress/theme/`,
SVG + DOM (not canvas), animated with `motion` (motion.dev) — see design §1
for why not framer-motion and why not Remotion, and for the fallback order if
the package's API has drifted. **No React in `docs-site` under any branch.**

### Sprint dependency graph

```
S0 groundwork: fix stale preview target, verify animation lib ── do first, ~30 min
  ↓
S1 scene model + player + FIRST film (coding) ─── freezes the schema
  ↓
S2 ops film ─────── the hardest one; build it SECOND to stress the schema early
  ↓
S3 assistant + data films ── parallel-safe once the schema survives S2
  ↓
S4 page, nav, cross-links, ADR, citation test
```

S1 and S2 are deliberately ordered so the most demanding film (ops: cron +
watch + free no-change path + conditional ACL + budget halt) lands before two
more films are authored against a schema that may not fit it.

## Prerequisites

- Read `docs/superpowers/specs/2026-08-22-use-case-films-design.md` in full.
- Read `docs-site/use-cases.md` in full — it is the script source for all four
  films, including the "Why these choices" rationale that the captions draw on.
- Skim `docs/architecture-site/data.js` (the `flow` array, lines ~546-637) for
  the beat/narrative shape this model is modelled on, and `app.js`'s lifecycle
  transport for the interaction vocabulary to match.
- Skim `docs-site/.vitepress/theme/` — `reveal.ts` (IntersectionObserver +
  reduced-motion convention), `HeroSignal.vue` (existing SVG animation SFC),
  `style.css` (CSS custom properties and the 3 reduced-motion blocks).
- Baseline: `pnpm --filter harness-docs build` succeeds; `pnpm test` is
  673/673 green.

---

## Sprint 0: groundwork

**Goal**: a working preview loop and a confirmed animation dependency, before
any film work starts.

### Task 0.1: fix the stale preview target

- **Location**: `.claude/launch.json`
- **Description**: the `architecture-site` entry points at
  `.claude/worktrees/architecture-site/docs/architecture-site`, which does not
  exist (verified 2026-08-22). Either repoint it at the real
  `docs/architecture-site/` or remove the entry. The `docs-site` entry (port
  4174) is correct and is what this work uses — confirm it starts.
- **Acceptance Criteria**: `preview_start` on `docs-site` serves the site; no
  launch config points at a non-existent path.

### Task 0.2: choose and verify the animation dependency

- **Location**: `docs-site/package.json`
- **Description**: add `motion` and verify its actual vanilla/Vue API against
  the current release — **do not assume the import shape from the design doc**.
  Build a throwaway SFC that sequences three SVG elements to confirm the API
  does what the films need (timed sequence, easing, imperative play/pause/seek).
  If it does not fit, fall back per design §1: `motion-v`, then the Web
  Animations API with zero dependencies.
- **Acceptance Criteria**: the choice is recorded in a one-line note in the
  design doc's §1 implementer note; the throwaway SFC animates and is then
  deleted; `pnpm --filter harness-docs build` still succeeds.

---

## Sprint 1: scene model, player, and the coding film

**Goal**: one complete, working film end to end, with a schema the other three
can be authored against.

**Demo/Validation**: load `/how-it-works` (or a scratch page), scroll the
coding film into view, watch it autoplay once; pause, click a beat on the
rail, land on that beat; toggle OS reduced-motion and reload — get the static
storyboard with every caption intact.

### Task 1.1: the scene model

- **Location**: `docs-site/.vitepress/theme/films.ts` (new)
- **Description**: implement the `Beat` / `Film` / `ActorId` types exactly as
  specified in design §2 and §3. `Beat.source` is required — it is what the
  citation test in Task 4.3 enforces. Export an empty-but-typed `films` array
  plus the shared actor vocabulary.
- **Acceptance Criteria**: types compile; the actor vocabulary matches design
  §3 exactly (17 actors); nothing about timing or layout lives outside this file.

### Task 1.2: the player component

- **Location**: `docs-site/.vitepress/theme/components/UseCaseFilm.vue` (new),
  registered globally in `docs-site/.vitepress/theme/index.ts` via
  `enhanceApp({ app })`
- **Description**: takes `id: Film['id']`, renders the film's `cast` as an SVG
  stage plus a DOM caption region and a beat rail. Implements: autoplay-once on
  IntersectionObserver (reuse `reveal.ts`'s pattern and its reduced-motion
  early-return convention), play/pause, click-a-beat-to-seek, and
  `#film-<id>-beat-<n>` deep links that select and pause.
  **Captions must be real DOM text**, not SVG-painted or canvas-painted — see
  design §6 for why (selectable, searchable, screen-readable).
  Under `prefers-reduced-motion: reduce`, render the static storyboard instead:
  all beats as a numbered vertical list with captions and tones. Same for
  no-JS.
- **Dependencies**: 1.1, 0.2
- **Acceptance Criteria**: all four playback behaviours work; reduced-motion
  path shows every caption; no console errors.

### Task 1.3: tone and theme styling

- **Location**: `docs-site/.vitepress/theme/style.css` (extend)
- **Description**: the four tones from design §4 (`normal`, `gate`, `deny`,
  `halt`), using existing CSS custom properties so both light and dark themes
  work. `halt` must be visually distinct from `deny` — a budget abort is a
  terminal state, not a policy refusal, and the runtime keeps them separate.
  No hardcoded hex.
- **Dependencies**: 1.2
- **Acceptance Criteria**: all four tones legible in both themes; screenshot
  each.

### Task 1.4: author the coding film

- **Location**: `docs-site/.vitepress/theme/films.ts`
- **Description**: the film for `use-cases.md` §1. Story: developer asks in the
  TUI → profile resolves → workflow triage routes recon to the `cheap` tier →
  loop streams → a `Bash` call hits `prompt` ACL and **waits for the human** →
  approved → executes under pre/post hooks → escalation to `frontier` on an
  observed failure → review at the `critic` tier → audit entry. Every beat
  cites real paths (`src/loop/agent-loop.ts`, `src/tools/acl.ts`,
  `src/workflow/`, `profiles/coding.yaml`, …).
  The `Bash: prompt` beat is the emotional centre of this film — it is the one
  thing `use-cases.md` calls out as always asking. Give it a `gate` tone and
  real dwell time.
- **Dependencies**: 1.1
- **Acceptance Criteria**: 8–12 beats; every `source` path exists; film reads
  correctly at 1× without pausing to comprehend.

---

## Sprint 2: the ops film (schema stress test)

**Goal**: the hardest film, built second on purpose. If the vocabulary from
design §3/§4 cannot express it, fix the schema **now** — before two more films
are authored against it.

**Demo/Validation**: the film shows the free no-change path before it shows a
firing, and ends on a budget halt that is visually distinct from a deny.

### Task 2.1: author the ops film

- **Location**: `docs-site/.vitepress/theme/films.ts`
- **Description**: the film for `use-cases.md` §4. Story, in order:
  1. **The common case first** — watch trigger polls `/var/log/app`, nothing
     changed, **no model call, zero cost**. Design §5 rule 3 makes this
     mandatory, not optional: it is the central economic claim of the trigger
     design, and a film that only shows the exciting branch misrepresents the
     system.
  2. Error spike → debounce → batch → a real run fires.
  3. `Notify` resolves through a **conditional ACL** (`allow_if` channel in
     `trusted_channels`) — `gate` tone — and pages `oncall` and nothing else.
  4. Budget ceiling reached → `BudgetExceeded` with a real reason from
     `src/runs/budget.ts` (`'cost' | 'tools' | 'wall'`) → partial output
     preserved → `oncall` told what was in flight. `halt` tone.
  5. Audit journal entry with why each call was allowed.
- **Dependencies**: Sprint 1 complete
- **Acceptance Criteria**: 10–14 beats; the no-change beat precedes the firing
  beat; the halt beat names a real `BudgetExceeded` reason; every `source`
  path exists.

### Task 2.2: schema reconciliation

- **Location**: `docs-site/.vitepress/theme/films.ts`,
  `components/UseCaseFilm.vue`
- **Description**: if Task 2.1 could not be expressed cleanly, change the
  schema now and re-author the coding film against it. Record what changed and
  why in the design doc. If nothing needed to change, say so explicitly —
  that is a real result worth recording, not silence.
- **Dependencies**: 2.1
- **Acceptance Criteria**: both films render on one schema; the design doc
  reflects the final shape.

---

## Sprint 3: the assistant and data films

These two are independent of each other and can be authored in parallel once
the schema survived Sprint 2.

### Task 3.1: author the assistant film

- **Location**: `docs-site/.vitepress/theme/films.ts`
- **Description**: the film for `use-cases.md` §2. Story: voice utterance in
  (STT plugin, endpointing, barge-in) → `mode: assistant` ACLs (no shell, no
  code execution) → `AskUser({ defer: true, ttl: '12h', channel: 'phone' })`
  parks the question **to disk** → the run ends, the server restarts, and the
  question survives → hours later an answer arrives over the paired `phone`
  channel → the run resumes → `Recall` answers a temporal question with a
  fact that has a real expiry.
  The durability beat (survives a restart) is this film's distinguishing
  moment — `use-cases.md` calls it out as "not an in-memory promise that dies
  with the connection." Show the restart.
- **Acceptance Criteria**: 9–13 beats; the restart is visible; `inbound: paired`
  is depicted (an unpaired sender is inert); every `source` path exists.

### Task 3.2: author the data film

- **Location**: `docs-site/.vitepress/theme/films.ts`
- **Description**: the film for `use-cases.md` §3. Story: a *service* (not a
  human) POSTs to `/run` → contract validation → show **both** branches: a
  malformed call returning **422 with a reason** (`halt` tone) and a valid call
  proceeding → read-only tools run → a `Bash` call is refused by `Bash: deny`
  (`deny` tone), and the beat names the ACL entry → note there is no human to
  prompt, which is why `deny` here is not `prompt` → typed output returns.
- **Acceptance Criteria**: 8–12 beats; the 422 and the deny use different tones
  and read as different kinds of event; every `source` path exists.

---

## Sprint 4: page, wiring, and the anti-drift test

### Task 4.1: the How it works page

- **Location**: `docs-site/how-it-works.md` (new),
  `docs-site/.vitepress/config.ts`
- **Description**: host all four films with a short framing paragraph each and
  a link from each to its full prose treatment in `use-cases.md`. Add to nav
  between "Use Cases" and "Architecture", and to the sidebar in the same
  position.
- **Acceptance Criteria**: page builds, nav and sidebar entries present, all
  four films render.

### Task 4.2: cross-links

- **Location**: `docs-site/architecture.md`, `docs-site/use-cases.md`
- **Description**: `architecture.md`'s opening section already points at the
  interactive explorer as the canonical detailed doc. Add a sibling pointer to
  the films, and state the split explicitly in both directions: **the explorer
  is the map (what exists and where), the films are the narrative (what happens
  in this scenario)**. Add a link from `use-cases.md`'s intro to the films.
- **Acceptance Criteria**: a reader landing on either page learns the other
  exists and what it is for; `pnpm --filter harness-docs build` reports no
  dead links.

### Task 4.3: the citation test

- **Location**: `tests/use-case-films.test.ts` (new — root suite, not docs-site)
- **Description**: import `films.ts` as data and assert, per design §7:
  every `Beat.source` path exists on disk; every `Beat.actor`/`Beat.to` is in
  its film's `cast`; beats are ordered and non-overlapping and the last ends at
  `Film.runtime`; every `Film.profile` path exists; all four ids present.
  This goes in the **root vitest suite** (already 673 tests, already in CI) —
  do not add a test runner to `docs-site`.
- **Acceptance Criteria**: test passes. **Then prove it can fail**: temporarily
  break one `Beat.source` path, confirm red, revert. Record the beat id used in
  the validation checklist below — a citation test that has never been observed
  failing is not an anti-drift check.

### Task 4.4: ADR entries

- **Location**: `docs/ADR.md` (next free number is **ADR-73**; add index rows too)
- **Description**: record two decisions:
  - **Films are narrative, the explorer is the map** — two animation surfaces
    on purpose, with the split stated. Consequence: the explorer keeps exactly
    one generic lifecycle and does not grow per-use-case buttons.
  - **Films are declarative data rendered by SVG+DOM, not canvas** — captions
    stay real text (selectable, searchable, screen-readable), and the scene
    model stays renderer-agnostic so a Remotion MP4 pass remains additive.
    This is a deliberate divergence from the sibling Konva app; say so.
- **Acceptance Criteria**: both entries added with context/decision/consequences,
  matching the house format; index table updated.

---

## Risks

| Risk | Mitigation |
|---|---|
| Schema doesn't fit the ops film after two other films are written | Sprint order puts ops second, explicitly to surface this before S3 |
| Animation package API differs from the design's assumption | Task 0.2 verifies before any film work; fallback chain ends at zero-dependency WAAPI |
| Films drift from code as the runtime changes | Task 4.3's citation test turns drift into a CI failure |
| Four films of hand-authored timing is a lot of tuning | Beats are declarative and small; tune one film to feel right (S1), then reuse its pacing constants |
| Someone later "unifies" the films into the Konva explorer | ADR-73 records the split and why; Task 4.2 states it in the docs themselves |

## Validation

- [ ] `.claude/launch.json` has no entry pointing at a non-existent path.
- [ ] Animation library choice recorded in the design doc's §1 note, with the
      reason if it was not `motion`.
- [ ] All four films autoplay once on scroll, pause, seek by beat, and deep-link.
- [ ] Reduced-motion renders a static storyboard with **every caption present** —
      verified by toggling the OS setting, not by reading the code.
- [ ] Ops film shows the free no-change path **before** the firing path.
- [ ] `halt` (budget, 422) and `deny` (ACL refusal) are visually distinct.
- [ ] `tests/use-case-films.test.ts` passes, and was observed failing with a
      deliberately broken citation — beat id used: `______`.
- [ ] `pnpm test` green (674+/674+), `pnpm typecheck` clean,
      `pnpm --filter harness-docs build` succeeds with no dead links.
- [ ] ADR-73 (and its sibling) added and indexed.
- [ ] Design doc §10 open questions 1 and 2 resolved with a recorded answer.
