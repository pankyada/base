# Use-Case Films — Design (UCF)

> Date: 2026-08-22
> Status: Draft (design)
> Related: [`../plans/2026-08-22-use-case-films.md`](../plans/2026-08-22-use-case-films.md),
> [`2026-06-27-map-centric-architecture-site-design.md`](2026-06-27-map-centric-architecture-site-design.md),
> `docs-site/use-cases.md`, `docs-site/architecture.md`, `docs/ROADMAP.md`

## Goal

Four animated, narrative walkthroughs — "films" — that show how each of the
four documented use cases actually runs, beat by beat, through the real
runtime. Each film is a short scripted sequence with captions, not a looping
decoration: a viewer who watches one should be able to say what happened, in
what order, and which component did it.

## What already exists (verified 2026-08-22, do not rebuild)

This is the single most important section of this design. Two animation
surfaces already ship, and a third would be waste.

| Surface | What it is | Where |
|---|---|---|
| Interactive architecture explorer | Konva canvas, 8 layers / 29 nodes / 31 edges, pan-zoom-drag, detail panel, list view, and **one 11-step "Play lifecycle" animation** | `docs/architecture-site/` (vanilla JS, no build, Konva 9 vendored at `assets/konva.min.js`, 172K) |
| Docs site | VitePress 1.5, custom theme with an animated SVG hero (`HeroSignal.vue`, SMIL `animateMotion`) and scroll-reveal (`reveal.ts`) | `docs-site/` |
| Use-case prose | Four complete use cases as prose + runnable YAML, 326 lines | `docs-site/use-cases.md` |

The explorer is synced into `docs-site/public/architecture-site/` at build time
by `scripts/sync-architecture-site.sh` (wired as `predev`/`prebuild` in
`docs-site/package.json`), because VitePress only publishes
`.vitepress/dist`.

**The gap is specific.** The explorer's lifecycle animation is *spatial and
generic*: one path, one request, the same eleven steps regardless of who is
asking or why. It answers "what components exist and how does a request move
through them." It does not, and should not, answer "what does an unattended
ops agent do at 3am when the error log spikes and it hits its budget ceiling."

The four use cases are documented only as static prose and YAML. Nothing
animates them.

**So: the films are narrative (temporal — what happens in this scenario), the
explorer is a map (spatial — what exists and where).** Different jobs. The
films must not become a second architecture map, and the explorer must not
grow four more lifecycle buttons.

## Non-goals

- Not a replacement for or a fork of `docs/architecture-site/`. That app keeps
  its single generic lifecycle. No changes to `data.js`.
- Not a marketing sizzle reel. Every beat depicts something the code actually
  does; see "Honesty rules" below.
- Not a fifth use case. The films cover exactly the four in `use-cases.md`.
  (`profiles/security.yaml`'s webhook pattern stays a prose footnote there.)
- Not audio/voiceover in this pass.

---

## 1. Technology decision: Motion, not Framer Motion or Remotion

The request named "framer or remotion." Both are the wrong literal fit, for
reasons that are structural rather than preferential — so this design picks a
third option that keeps the door open to Remotion later.

**Framer Motion is React-only.** `docs-site` is VitePress, which is Vue 3.
Using framer-motion there means either adding React + `@vitejs/plugin-react`
to the docs site (two frameworks, one page) or building the films in `web/`
(the Next.js *operator console* — a product surface, not a docs surface;
putting marketing/docs animation there is a boundary smell in a repo that
already enforces a harness/product boundary in CI via `scripts/check-boundary.sh`).

**Remotion renders video, not interaction.** It is genuinely excellent at
"movie" — precise frame timing, scene composition, real easing — and it would
produce the most cinematic result. But it renders MP4s via headless Chromium
plus ffmpeg. That means: CI gains a browser + video toolchain; the repo gains
four multi-megabyte binaries (today its heaviest committed asset is one 172K
vendored JS file); and the output cannot be deep-linked to a beat, cannot
respect `prefers-reduced-motion`, and cannot theme to the reader's light/dark
setting — all three of which are established conventions here
(`prefers-reduced-motion` appears in 4 places across the two stylesheets;
`reveal.ts` bails out entirely under it).

**Decision: use Motion (`motion`, motion.dev) — the framework-agnostic
successor to framer-motion, by the same author.** It has a vanilla-JS
imperative API that drives plain DOM/SVG, so it composes with Vue SFCs in the
VitePress theme without a second framework. It is the "framer" lineage the
request asked for, in the form this codebase can actually host.

> **Implementer note:** verify the package's current API surface and Vue
> integration story before committing to it — do not take this design's word
> for the import shape. If `motion`'s vanilla API has drifted, the fallback
> order is: (1) `motion-v` (Vue port of the Framer Motion API), (2) hand-rolled
> Web Animations API — the films' needs are sequence-and-easing, not physics,
> and WAAPI covers that natively with zero dependencies. Record which was
> chosen and why. Do not add React to `docs-site` under any of these branches.

### Remotion stays reachable, and that is the point of §2

The films' scene scripts are **declarative data**, not imperative animation
code. That mirrors what `docs/architecture-site/data.js` already does — a pure
model (`layers`, `edges`, `flow`) that `app.js` renders. Given the same
discipline, a Remotion renderer that consumes `films.ts` and emits shareable
MP4s for the README or social is a later, additive project that needs no
rewrite of the films themselves. Deferring Remotion is therefore cheap;
adopting it now is not.

---

## 2. The scene model

One module, `docs-site/.vitepress/theme/films.ts`, exports the four films as
data. Nothing about timing or layout lives in component code.

```ts
export interface Beat {
  id: string                    // stable, used for deep links (#film-ops-beat-4)
  t: number                     // start time in ms, relative to film start
  dur: number                   // beat duration in ms
  actor: ActorId                // which node lights up (see §3)
  to?: ActorId                  // optional edge target for a travelling pulse
  caption: string               // one sentence, present tense, plain language
  detail?: string               // optional second line, shown on pause/hover
  source: string[]              // repo paths this beat depicts — REQUIRED
  tone?: 'normal' | 'gate' | 'deny' | 'halt'   // drives colour, see §4
}

export interface Film {
  id: 'coding' | 'assistant' | 'data' | 'ops'
  title: string
  premise: string               // one paragraph: who is asking, and why
  profile: string               // path to the profile YAML this film runs
  runtime: number               // total ms, derived-checked against beats
  cast: ActorId[]               // the subset of the system this film uses
  beats: Beat[]
}
```

`source` is mandatory on every beat and is load-bearing — see §5.

## 3. Cast: a shared, small actor vocabulary

Every film draws from one fixed set of actors so the four films read as a
series rather than four unrelated diagrams. The set is deliberately smaller
than the explorer's 29 nodes — a film needs the actors in *its* story, not the
whole system.

```
client · server · profile · session · loop · provider
context · acl · gate · budget · tools · mcp · memory
channel · trigger · audit · artifact
```

Each film declares its `cast` and only those actors render. The coding film
does not draw a channel; the data film does not draw a trigger. An actor that
never appears in a beat must not appear on the stage — an inert box is
noise, and it makes the busy films (ops) unreadable.

## 4. Visual language

Four tones, mapped to what the runtime actually distinguishes:

| Tone | Means | Where it appears |
|---|---|---|
| `normal` | ordinary progress | every film |
| `gate` | a control engaged and the run continued (approval prompt answered, provenance escalation satisfied) | coding (Bash prompt), ops (conditional ACL) |
| `deny` | a control refused an action | data (`Bash: deny`), ops |
| `halt` | the run stopped on a terminal condition | data (contract 422), ops (budget exceeded) |

`halt` must be visually distinct from `deny` — a budget abort is not a
policy refusal, and the roadmap's #29 language is explicit that
budget-exceeded is *its own terminal state, not a generic failure*. The films
should not blur what the runtime keeps separate.

Colours come from existing CSS custom properties in
`docs-site/.vitepress/theme/style.css` so both themes work. Do not hardcode
hex values; the site has a light and a dark mode and the reader picks.

## 5. Honesty rules (the constraint that makes this worth building)

A film that dramatises a capability the harness does not have is worse than no
film — it is a documentation bug with a soundtrack. Three rules:

1. **Every beat cites its source.** `Beat.source` lists real repo paths. This
   is not decoration: §7's test asserts every cited path exists, so a beat
   describing a module that got deleted or moved fails CI.
2. **Terminal states match the code.** The budget beat shows a real reason
   from `BudgetExceeded` (`'cost' | 'tools' | 'wall'` — see
   `src/runs/budget.ts`), not a generic "stopped". The contract beat shows
   422, matching `use-cases.md`'s claim. The deny beats name the ACL entry
   that denied them.
3. **The no-change path is shown, not skipped.** The ops film's watch trigger
   must depict the common case — nothing changed, no model call, zero cost —
   before it depicts a firing. That free no-change path is the central claim
   of the trigger design; a film that only shows the exciting branch misrepresents
   the system's economics.

## 6. Playback and accessibility

- **Autoplay on scroll-into-view, once**, via the same `IntersectionObserver`
  pattern `reveal.ts` already establishes — not on page load, and not looping.
- **Transport**: play/pause, a scrubbable beat rail (click a beat, jump to it),
  and a speed toggle. The explorer's lifecycle transport is prior art for the
  interaction shape; match its vocabulary rather than inventing new controls.
- **Deep links**: `#film-<id>-beat-<n>` selects and pauses on that beat, so
  prose elsewhere in the docs can link to a specific moment.
- **Reduced motion is a first-class path, not a disable switch.** Under
  `prefers-reduced-motion: reduce`, render the film as a static storyboard —
  all beats visible at once as a numbered vertical list with their captions
  and tones intact. The reader loses the motion, never the content. This
  matches `reveal.ts`'s existing early-return convention and is also the
  no-JS fallback.
- **Captions are real text in the DOM**, never canvas-painted, so they are
  selectable, searchable by VitePress's local search, and readable by a screen
  reader. This is a reason to build the films in SVG+DOM rather than on a
  Konva canvas like the explorer — a deliberate divergence from the sibling
  app, and worth stating in the ADR.

## 7. Verification

`docs-site` has no test runner and this design does not add one. Two layers
instead:

**Automated — in the existing root vitest suite** (`tests/`, currently 673
passing, already runs in CI). A new `tests/use-case-films.test.ts` imports
`films.ts` as data and asserts:
- every `Beat.source` path exists on disk (this is the anti-drift check);
- every `Beat.actor`/`Beat.to` is in its film's declared `cast`;
- beats within a film are ordered and non-overlapping, and the last beat ends
  at `Film.runtime`;
- every film's `profile` path exists;
- all four use-case ids are present.

This costs no new infrastructure and it can fail for real reasons — a
refactor that moves `src/runs/budget.ts` breaks the ops film's citation, which
is exactly when someone should be told the film is now lying.

**Manual — the preview loop**, following the precedent set by
`docs/superpowers/plans/2026-06-27-map-centric-architecture-site.md`: run the
docs site, load the page, assert DOM state, check for console errors, and
screenshot each film at a few beats.

> **Blocker to fix first:** `.claude/launch.json`'s `architecture-site` entry
> points at `.claude/worktrees/architecture-site/docs/architecture-site`,
> which **does not exist** (verified 2026-08-22). The `docs-site` entry (port
> 4174, `pnpm --filter harness-docs preview`) is correct and is the one this
> work needs. Fix or remove the stale entry as part of this work rather than
> leaving a broken preview target behind.

## 8. Placement

New page `docs-site/how-it-works.md`, added to nav between "Use Cases" and
"Architecture". It hosts all four films with a short framing paragraph each,
and links each film to its full prose treatment in `use-cases.md` and to the
explorer for the component detail.

The film component is built to be embeddable (`<UseCaseFilm id="ops" />`), so
dropping each film into the top of its matching `use-cases.md` section later
is a one-line change per section. Whether to do that is left open — see §10.

`architecture.md` gains a pointer to the new page in its opening section,
alongside the existing explorer pointer, framed as the distinction in §"What
already exists": map vs narrative.

## 9. Risks

| Risk | Mitigation |
|---|---|
| The films drift from the code as the runtime changes | §7's citation test fails when a cited path moves — the drift becomes a CI failure, not a stale doc |
| Four films is a lot of hand-authored timing data | The beat model is small and declarative; author the coding film first and freeze the schema before writing the other three (see the plan's sprint order) |
| The ops film is the most complex (cron + watch + no-change + conditional ACL + budget halt) and may overflow the visual language | Build it **second**, not last — if the vocabulary from §3/§4 cannot express it, that is a schema problem worth discovering before authoring two more films on the wrong schema |
| Motion's API differs from what this design assumes | Verify before committing; documented fallback order in §1, ending at zero-dependency WAAPI |
| A second animation surface confuses readers about where to look | §8's cross-links state the map/narrative split explicitly in both directions; the ADR records it |

## 10. Open questions

1. **Should each film also embed at the top of its `use-cases.md` section?**
   **Resolution (2026-08-22): no, not in this pass.** `how-it-works.md` links
   to each `use-cases.md` section and vice versa; embedding would double page
   weight on an already-326-line page for a benefit ("watch inline instead of
   clicking through") that hasn't been validated against real usage yet.
   Revisit if reader feedback asks for it.
2. **Does the ops film need a timeline scrub across simulated hours** (cron at
   08:00, watch event at 03:00) or is beat-sequence enough?
   **Resolution (2026-08-22): beat-sequence is enough.** The shipped ops film
   (10 beats, ~16s) reads clearly as a sequence — idle poll, spike, MCP check,
   conditional-ACL page, budget climb, halt, audit — without needing simulated
   wall-clock jumps. Revisit only if user feedback says it reads as
   simultaneous rather than sequential.
3. **Remotion pass for shareable MP4s** — explicitly deferred, not rejected.
   Revisit once the four films are stable and `films.ts` has proven itself as
   the single source. Do not build it speculatively in this pass.
   Still deferred as of the 2026-08-22 implementation — `films.ts` shipped as
   pure data with no rendering dependency baked in, so the door stays open.
