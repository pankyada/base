# Plan: fix findings from the web-surface review

**Generated**: 2026-08-16
**Estimated Complexity**: Medium (4 sprints; one is security-critical and should land first)
**Status**: F1/F2 verified in the #25/#26 pass. F7 is now exercised by the
real-browser six-entry corpus and F8 is recorded in ADR-71/72 plus the
architecture map. F3–F6 are partially present in #27/#28; the verification
report records the remaining hollow canvas/widget paths.

## Overview

Phases 0–3 of `docs/superpowers/plans/2026-08-16-web-surface.md` landed with
`pnpm typecheck && pnpm test` green (652/652 backend, 46/46 web) and
`scripts/check-boundary.sh` clean, then failed independent code review: one
security-critical gap in the exact control the phase was built to add, plus
seven correctness/coverage/process findings. Full rationale for each fix is in
`docs/superpowers/specs/2026-08-16-web-surface-fixes-design.md` — read it before
starting; this plan is the task breakdown, that doc is the "why".

This plan fixes all 8. One design decision was made in the design doc rather
than left for the implementer to guess, and is repeated here so it isn't missed:
**canvas persistence uses per-project `localStorage`**, not a new server store
(closes design open question 3).

### Sprint dependency graph

```
S1 approval-mode ceiling (F1) ──────────────────── independent, security-critical, do first
S2 dataset delete (F2) ──────────────────────────── independent, can run in parallel with S1
S3 canvas: real widgets (F3) → persistence (F4) → wire exports (F5) → escape fix (F6)
S4 surface escape test (F7) + doc resolutions (F8) ── independent, can run anytime
```

S3's four findings share `Canvas.tsx`/`canvas.ts`/`export.ts` — do them in the
listed order within S3 to avoid touching the same lines twice. S1, S2, and S4 do
not overlap with S3 or each other and can run in parallel.

## Prerequisites

- Read `docs/superpowers/specs/2026-08-16-web-surface-fixes-design.md` in full
  before starting any sprint — it has the exact rationale, code locations, and
  the resolved open questions this plan assumes.
- Read `docs/superpowers/specs/2026-08-16-web-surface-design.md`,
  `2026-08-16-web-read-api-design.md`, and `2026-08-16-analyst-workbench-design.md`
  for context on the subsystems being touched.
- This plan assumes the Phase 0–3 web-surface work is the current working tree
  state (uncommitted at review time, per the finding report). If it has since
  been committed or moved, re-verify line numbers before starting.

---

## Sprint 1: approval-mode ceiling (F1) — security-critical, do first

**Goal**: `analyst`, `assistant`, and `production` profiles can never reach an
effective `yolo` approval mode, closing the gap where `MODE_DEFAULTS`'s
`deny`-ACL tools were silently bypassable.

**Demo/Validation**:
- A profile with `mode: assistant` and `approval_mode: yolo` resolves to an
  effective mode of `danger`, and a `Bash` call (which `MODE_DEFAULTS.assistant`
  denies) is still refused.
- A profile with no `mode:` field and `approval_mode: yolo` is unaffected
  (still resolves to `yolo`) — undefined mode already has full ACL trust, so
  capping it here would be a behavior change with no corresponding security
  gain.
- `pnpm test && pnpm typecheck` green.

### Task 1.1: tighten the ceiling function

- **Location**: `src/server/approval-mode.ts:15`
- **Description**: Replace `const ceiling = profile.mode === 'production' ? 'danger' : 'yolo'`
  with a ceiling keyed off a `TRUSTED_MODES` set containing `'developer'` and
  `undefined` only — every other mode (`analyst`, `assistant`, `production`, and
  any future mode) caps at `'danger'`. See the design doc's F1 section for the
  exact snippet and the reasoning for excluding `undefined` mode from the cap.
- **Dependencies**: none
- **Acceptance Criteria**:
  - `resolveApprovalLimit({ approval_mode: 'yolo', mode: 'analyst' })` returns `'danger'`.
  - `resolveApprovalLimit({ approval_mode: 'yolo', mode: 'assistant' })` returns `'danger'`.
  - `resolveApprovalLimit({ approval_mode: 'yolo', mode: 'production' })` returns `'danger'` (no regression).
  - `resolveApprovalLimit({ approval_mode: 'yolo', mode: 'developer' })` returns `'yolo'` (no regression).
  - `resolveApprovalLimit({ approval_mode: 'yolo' })` (no `mode` field) returns `'yolo'` (no regression).
  - None of `profiles/*.yaml`'s effective approval mode changes (all currently resolve to `'danger'` via the `profileMode` default, independent of ceiling).
- **Validation**: extend `tests/approval-authority.test.ts` with the five cases above.

### Task 1.2: prove the ACL still denies under the tightened ceiling

- **Location**: `tests/approval-authority.test.ts` (new test), `src/tools/acl.ts`
- **Description**: Task 1.1 only proves the ceiling *value* changed. Add a test
  that goes one layer deeper and calls the actual ACL resolution path
  (`resolveAclDecision` / the loop's approval check in `src/loop/agent-loop.ts`)
  with a `mode: assistant` profile, an effective mode of `danger` (post-fix), and
  a `Bash` call — asserting the decision is `deny`, not `allow`. This is the test
  that would have caught the original gap; a ceiling-value-only test would not
  have, since the bug was in how the ceiling interacted with `acl.ts:50`, not in
  the ceiling value alone.
- **Dependencies**: 1.1
- **Acceptance Criteria**: the new test fails against the pre-fix ceiling logic
  (verify by temporarily reverting 1.1 locally and confirming red, then
  reapplying) and passes after it.
- **Validation**: `npx vitest run tests/approval-authority.test.ts`

### Task 1.3: document the behavior change

- **Location**: `docs/DEPLOYMENT.md`
- **Description**: One line, matching the convention already used for the
  origin-policy and approval-authority changes earlier in the same track: any
  deployment relying on `mode: analyst` or `mode: assistant` combined with an
  explicit `approval_mode: yolo` (or `HARNESS_APPROVAL_MODE=yolo`) now gets
  `danger` instead. State that no shipped example profile is affected.
- **Dependencies**: 1.1
- **Acceptance Criteria**: note is added; `pnpm typecheck && pnpm test` green.

---

## Sprint 2: dataset delete (F2)

**Goal**: `DELETE /datasets/:id` exists, removes the dataset, and 404s
correctly on unknown or cross-user ids.

**Demo/Validation**:
- Upload a dataset, delete it, confirm `GET /datasets` no longer lists it and
  `GET /datasets/:id/schema` 404s.
- Deleting an id that never existed, or that belongs to a different user
  namespace, 404s without side effects.

### Task 2.1: `DatasetStore.delete`

- **Location**: `src/datasets/store.ts`
- **Description**: Add a `delete(user, id)` method mirroring `load()`'s id
  validation (`/^[a-z0-9]+$/i` regex, then existence check) before
  `rmSync(dir, { recursive: true, force: true })`. Reuse the exact validation
  `load()` already does rather than re-deriving it, so the two paths can't drift.
- **Dependencies**: none
- **Acceptance Criteria**: deleting a valid, existing dataset removes its
  directory; deleting an invalid-shaped id or a nonexistent one throws
  `DatasetError(404, ...)` without touching the filesystem.
- **Validation**: extend `tests/datasets.test.ts`.

### Task 2.2: `DELETE /datasets/:id` route

- **Location**: `src/server/read-api.ts`
- **Description**: Extend the existing dataset-route regex/handling
  (`/^\/datasets\/([^/]+)\/(schema|preview)$/`-style matching) to also accept
  `DELETE /datasets/:id` (no trailing `/schema` or `/preview` segment). Extend
  the `readable`/`upload` gate at the top of the handler to allow exactly this
  one `DELETE` path — not a blanket allowance for `DELETE` on other routes, to
  keep "the only new write endpoint is `POST /datasets`" honest (delete acts on
  a resource created via that one sanctioned write path).
- **Dependencies**: 2.1
- **Acceptance Criteria**: `DELETE /datasets/:id` returns `200`/`204` on success,
  `404` on unknown id, and the origin/API-key checks in `rest.ts` still apply
  (verify by confirming the route is reached through `createReadApiHandler`,
  which is already mounted after those checks).
- **Validation**: extend `tests/read-api.test.ts` (or `tests/datasets.test.ts` if
  the route-level tests live there) with an end-to-end upload → delete → 404
  sequence through the HTTP handler, not just the store method.

---

## Sprint 3: canvas — real widgets, persistence, wired exports, safe HTML

Ordered chain: F3 → F4 → F5 → F6. Do not reorder — F4 depends on `CanvasArtifact`
gaining a `kind` field in F3; F5 depends on F4's `Canvas.tsx` shape; F6 must land
before or alongside the part of F5 that wires `sessionToHtml`, since that wiring
is what turns F6's latent risk into a real one.

**Demo/Validation**:
- Pin a bar-chart artifact from a live conversation; it renders as a bar chart
  on the canvas, not JSON.
- Reload the page with the same project active; the pinned chart is still there.
- Click Export on the canvas; get a PNG (or, if the PNG path proved too heavy,
  a per-widget SVG download — see Task 3.5).
- Click Export session; get a downloaded HTML file; a transcript turn containing
  `<script>alert(1)</script>` does not execute when the file is opened.

### Task 3.1: `CanvasArtifact` gains `kind`

- **Location**: `web/lib/canvas.ts`
- **Description**: `CanvasArtifact` currently is `{ id, data, title? }`. Add
  `kind: ArtifactKind` (import from `web/lib/protocol.ts`). Update `pinArtifact`'s
  call sites — wherever a "pin" action exists on an artifact, cell figure, or
  table (these should already have the source artifact's `kind` in scope) — to
  pass it through.
- **Dependencies**: none
- **Acceptance Criteria**: `PinnedArtifact.artifact.kind` is populated for every
  pin path that exists today; TypeScript enforces it (no `kind?` optional
  escape hatch).
- **Validation**: `pnpm --filter harness-web typecheck`.

### Task 3.2: render pinned artifacts through `GenWidget`

- **Location**: `web/components/data/Canvas.tsx:12`
- **Description**: Replace `<pre>{JSON.stringify(item.artifact.data, null, 2)}</pre>`
  with `<GenWidget artifact={{ id: item.artifact.id, kind: item.artifact.kind, title: item.artifact.title ?? item.artifact.id, icon: '', data: item.artifact.data }} />`.
  Keep the existing `<pre>` rendering as an explicit fallback for the case where
  `kind` is somehow missing (defensive, not the primary path post-3.1).
- **Dependencies**: 3.1
- **Acceptance Criteria**: a pinned `bar` artifact's canvas DOM matches what
  `Workspace.tsx` produces for the same artifact live (same widget component,
  same props shape).
- **Validation**: extend `web/tests/canvas.test.ts` — render a pinned `bar`
  artifact, assert a marker specific to the `Bar` widget is present (not string
  matching on JSON); render with a missing `kind`, assert the fallback `<pre>`
  path and no crash.

### Task 3.3: canvas persistence via per-project `localStorage`

- **Location**: `web/lib/canvas.ts`, `web/components/data/Canvas.tsx`
- **Description**: Add `loadCanvas(projectId)` / `saveCanvas(projectId, items)`
  per the design doc's F4 snippet. `Canvas.tsx` loads on mount (keyed by the
  active project id) and saves after every pin/reorder/refresh action. Cap
  individual pinned artifact payload size (reuse the 512 KB bound pattern from
  `web/surface/frame.ts`'s `MAX_SURFACE_BYTES`); an oversized artifact stores a
  truncation marker instead of full data, with a "refresh to reload full data"
  affordance.
- **Dependencies**: 3.1 (persists `PinnedArtifact` shape including `kind`)
- **Acceptance Criteria**: pin an artifact, simulate a fresh mount (new
  `Canvas` instance, same `projectId`), confirm it rehydrates; switching
  `projectId` shows a different, independent canvas; an oversized artifact
  saves without throwing and shows the truncation marker.
- **Validation**: extend `web/tests/canvas.test.ts` with the three cases above.

### Task 3.4: wire session export, fix `sessionToHtml` escaping first

- **Location**: `web/lib/export.ts`, wherever the session/turn list lives
  (`web/components/HarnessApp.tsx` or the conversation view), `web/components/TopBar.tsx`
- **Description**: Do the escaping fix (F6) before wiring the caller, so the
  wiring never has a moment where it's exploitable. In `export.ts`: apply a
  `scriptSafe`-style neutralization of `</script` sequences (same technique
  `web/surface/frame.ts` already uses) as defense-in-depth inside
  `sessionToHtml`, and add a doc comment stating the caller must pass
  pre-escaped text content. Then add an "Export session" action (a button in
  `TopBar` or a palette command) that builds `body` from the current turn list
  with each turn's text content run through a small `escapeHtml(text)` helper
  (new, in `export.ts`) before concatenation — only the caller's own wrapper
  markup (headings, turn separators) is unescaped. Trigger download via an
  object URL (`URL.createObjectURL` + a synthetic click), not a `data:` URI, so
  large transcripts don't hit URL length limits.
- **Dependencies**: 3.3 is not a hard dependency but do it after so the export
  action can optionally include the canvas state; if sequencing pressure makes
  that impractical, session export may ship without canvas inclusion — note
  the choice.
- **Acceptance Criteria**: a turn containing literal `<script>alert(1)</script>`
  text exports to an HTML file where that string is inert (renders as visible
  text, not an executing script); the exported document has no external
  `http://`/`https://` references; the action is reachable by a user, not only
  by a unit test calling the pure function directly.
- **Validation**: extend `web/tests/export.test.ts` with the script-tag case
  against `sessionToHtml` directly, plus a new Testing-Library test that clicks
  the actual Export action and asserts a download was triggered with safe
  content.

### Task 3.5: wire canvas export

- **Location**: `web/lib/export.ts`, `web/components/data/Canvas.tsx`
- **Description**: Add an Export control to the canvas. Preferred path: a
  `renderCanvasToPng(root: HTMLElement): Promise<string>` that walks the
  canvas's rendered child SVGs (every chart widget already emits SVG) and
  composites them onto an offscreen `<canvas>` via `Image` + `drawImage`,
  returning a data URL through `canvasToPng`. If this proves heavier than
  budgeted once attempted, ship the explicitly sanctioned fallback instead: a
  per-widget "download as SVG" action (each chart widget serializes its own
  `<svg>` to a Blob and downloads it) rather than one whole-canvas raster.
  Either is acceptable — **state in the PR/commit description which one
  shipped**, since the design doc's F5 section leaves this open pending
  implementation reality.
- **Dependencies**: 3.2 (canvas must be rendering real widgets, not JSON, before
  exporting an image of it is meaningful)
- **Acceptance Criteria**: clicking Export on a canvas with at least one pinned
  artifact produces a downloadable image (PNG, whole-canvas or per-widget SVG
  per whichever path shipped); an empty canvas either disables the control or
  no-ops without error.
- **Validation**: extend `web/tests/export.test.ts` / `canvas.test.ts` for
  whichever path shipped; a Testing-Library test clicking the real control.

---

## Sprint 4: surface escape test rigor (F7) + design-doc resolutions (F8)

Independent of S1–S3; can run any time, including in parallel.

### Task 4.1: strict `sandbox` attribute test (interim floor)

- **Location**: `web/tests/surface.test.ts`, `web/surface/SurfaceHost.tsx`
- **Description**: Add a test asserting the rendered `<iframe>`'s `sandbox`
  attribute is exactly the string `"allow-scripts"` — not a superset, not
  containing `allow-same-origin`. Cheap, catches the most likely regression path
  (someone adding a permission to fix an unrelated bug), and ships regardless of
  whether Task 4.2 lands in this pass.
- **Dependencies**: none
- **Acceptance Criteria**: test fails if `sandbox` gains any additional token;
  passes today.
- **Validation**: `pnpm --filter harness-web test`

### Task 4.2: real browser-executed escape corpus

- **Location**: new test using Playwright (via the `mcp__plugin_playwright_playwright__*`
  tools available in this environment, or a `web/e2e/` Playwright dev-dependency
  suite if the target CI needs a headless, non-MCP path — pick whichever this
  session's environment actually supports and state the choice)
- **Description**: For each of the six `web/surface/escape-corpus.json` entries,
  mount a real `SurfaceHost` with that entry as `js`, let the frame settle, and
  assert the attempt is contained: either the frame reports the attempt failed
  (an exception surfaced via `ui_result.errors`) or, for `fetch`/form-submission
  entries where a thrown exception isn't guaranteed, assert no corresponding
  network request escaped the sandboxed frame's context (use network-request
  inspection if driving through the Claude Browser / Playwright MCP, or a
  request-interception assertion if driving through a Node Playwright test).
  This corpus is permanent — new entries are appended over time, never removed,
  per the standing rule already stated in every design doc that mentions it.
- **Dependencies**: none, but naturally follows 4.1 as the fuller version of the
  same guarantee
- **Acceptance Criteria**: all six corpus entries pass; temporarily weakening
  `SurfaceHost.tsx`'s `sandbox` attribute (e.g. appending `allow-same-origin`
  locally) causes at least one entry to fail, proving the test actually detects
  the regression it exists to catch.
- **Validation**: run the new suite; if it requires a real browser and can't run
  in the same command as `pnpm --filter harness-web test`, document the separate
  command in `web/package.json` (`"test:e2e"` or similar) and reference it from
  `CLAUDE.md`'s commands table if it becomes part of the standard check.

### Task 4.3: resolve and record open questions

- **Location**: the four `2026-08-16-*-design.md` files
- **Description**: Add a `Resolution (2026-08-16):` note under each open
  question that this fix pass actually touched, per the list in the design
  doc's F8 section — chart-lib choice (resolved: hand-rolled SVG), Parquet
  handling (resolved: opaque-store-only), canvas persistence (resolved by F4:
  per-project `localStorage`), and surface pinnability (resolved by F3: yes,
  `ArtifactWidget`s are pinnable through the same `kind`-carrying path; state
  explicitly whether a generated `RenderUI` surface can also be pinned, and if
  not, why — a surface has no stable "re-run to refresh" story the way an
  artifact's generating code does). Leave genuinely untouched questions (auto-
  profile-on-upload, `.ipynb` export, `ExecuteCode` in an unattended web tab) as
  open — do not close speculatively.
- **Dependencies**: 3.1–3.5 (needs to know what actually shipped for the canvas/
  pinnability questions)
- **Acceptance Criteria**: every touched open question has a resolution note;
  every untouched one is still explicitly marked open (not silently dropped).
- **Validation**: manual read-through; no automated check.

---

## Validation checklist

- [x] `resolveApprovalLimit` caps `analyst`/`assistant`/`production` at `danger` even when `yolo` is requested; `developer` and mode-less profiles are unaffected.
- [x] A `Bash` call under `mode: assistant` stays denied even with `approval_mode: yolo` requested.
- [x] `DELETE /datasets/:id` works end-to-end through the HTTP handler, including 404s.
- [ ] A pinned artifact renders as its real widget on the canvas.
- [ ] Canvas state survives a reload, scoped per project, with an oversized-artifact truncation path that doesn't throw.
- [ ] Canvas export and session export are both reachable by clicking something, not only by calling a function in a test.
- [ ] A `<script>`-bearing transcript turn cannot execute in an exported session HTML file.
- [x] Surface sandbox attribute is asserted exact-string; the interim unit-test floor is the selected validation path for this pass.
- [x] Every design doc's touched open question carries a dated resolution note; untouched ones remain visibly open.
- [ ] `pnpm typecheck && pnpm test && ./scripts/check-boundary.sh` and `pnpm --filter harness-web typecheck && pnpm --filter harness-web test` all green.
