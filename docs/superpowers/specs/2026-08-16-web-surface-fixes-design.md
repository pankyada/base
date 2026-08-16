# Web Surface — Fixes Design (W-fix)

> Date: 2026-08-16
> Status: Draft (design)
> Related: [`2026-08-16-web-surface-design.md`](2026-08-16-web-surface-design.md),
> [`2026-08-16-web-read-api-design.md`](2026-08-16-web-read-api-design.md),
> [`2026-08-16-analyst-workbench-design.md`](2026-08-16-analyst-workbench-design.md),
> [`../plans/2026-08-16-web-surface-fixes.md`](../plans/2026-08-16-web-surface-fixes.md), `docs/ROADMAP.md`

## Goal

Phase 0–3 of the web surface plan (`docs/superpowers/plans/2026-08-16-web-surface.md`)
landed with `pnpm typecheck && pnpm test` green in both the backend and `web/`, and
`scripts/check-boundary.sh` clean. Independent review of the working tree
(uncommitted at review time) found eight gaps, one of them a real security hole
that the phase was specifically built to close. This design fixes all eight.

None of these are new subsystems. Every fix is a change to code that already
exists and already has a test file; most are 1–2 line corrections plus a
strengthened or added test.

### Non-goals

- Not a re-review of Phase 0–3 as a whole — scope is exactly the eight findings
  below.
- Not Phase 4/5 (operator console, assistant surface) — those are unimplemented,
  not broken, and are out of scope here.
- Not a redesign of the canvas or export features — F3/F4/F5 restore what the
  original design already specified, not a new shape.

---

## F1 — Approval-mode ceiling doesn't cap `analyst`/`assistant` (HIGH)

**Where:** `src/server/approval-mode.ts:15`

```ts
const ceiling = profile.mode === 'production' ? 'danger' : 'yolo'
```

**The gap:** roadmap #12 documents `analyst` and `assistant` as multi-tenant-safe
modes with no destructive capability, enforced by `MODE_DEFAULTS`
(`src/profiles/schema.ts:119-146`) denying `Bash`/`Write`/`Edit`/`Delegate`/
`ExecuteCode`. But the approval-mode ceiling this task introduced only restricts
`production`. A profile combining `mode: assistant` with `approval_mode: yolo`
(misconfiguration, or an attacker who can influence profile YAML) resolves to an
effective mode of `yolo`. In `src/tools/acl.ts:50`, `mode === 'yolo'`
unconditionally returns `allow`, which overrides the `deny` that `MODE_DEFAULTS`
set — the exact "misconfigured profile silently runs Bash in a multi-tenant
context" scenario #12 exists to prevent, and this task's own goal statement
names.

**Why `developer` and undefined `mode` are correctly excluded:** `applyModeDefaults`
(`src/profiles/loader.ts:20-21`) is a no-op when `profile.mode` is unset — an
profile with no `mode:` field already has full, unrestricted ACL trust, identical
to `developer`. Capping its ceiling would be inconsistent with the ACL layer and
would not close any actual gap. None of the eight shipped example profiles in
`profiles/*.yaml` set `mode:` or `approval_mode:`, so this fix changes no example
profile's default behavior (confirmed: their effective mode today is already
`danger`, from `profileMode` defaulting to `'danger'` when `approval_mode` is
unset — see `approval-mode.ts:14`).

**Fix:**

```ts
const TRUSTED_MODES = new Set<string | undefined>(['developer', undefined])
const ceiling = TRUSTED_MODES.has(profile.mode) ? 'yolo' : 'danger'
```

This caps `analyst`, `assistant`, and `production` alike at `danger` — `danger`
still auto-allows non-`deny` tools without a prompt (matching those modes' intent
of low interactive friction for the tools they do permit), but a tool the mode's
ACL denies stays denied, because only `yolo` overrides `deny` in `acl.ts:50`.

**Test:** extend `tests/approval-authority.test.ts` with a case for each of
`analyst`, `assistant`, and `production` — profile requests `approval_mode: yolo`,
effective ceiling is `danger`, and a `Bash` call under that profile's ACL is
still denied even with the requested mode nominally granted (i.e. assert against
`src/tools/acl.ts`'s `resolveAclDecision`, not just the ceiling value in
isolation, so the test fails if the two modules drift again).

---

## F2 — `DELETE /datasets/:id` missing (MEDIUM)

**Where:** `src/datasets/store.ts`, `src/server/read-api.ts`

Spec'd in [W1 §2.8](2026-08-16-web-read-api-design.md) and plan Task 0.5; never
built. `DatasetStore` has upload/list/schema/preview but no delete, and
`read-api.ts` has no `DELETE` branch for `/datasets/:id`.

**Fix:**

```ts
delete(user: string, id: string): void {
  if (!/^[a-z0-9]+$/i.test(id)) throw new DatasetError(404, 'unknown dataset')
  const dir = join(this.root, sanitizeUserId(user), id)
  if (!existsSync(dir)) throw new DatasetError(404, 'unknown dataset')
  rmSync(dir, { recursive: true, force: true })
}
```

Route: `DELETE /datasets/:id` in `read-api.ts`'s existing dataset-route matcher,
mirroring the `schema`/`preview` pattern already there. `readable` gate must be
extended to accept `DELETE` for exactly this one path — not a blanket `DELETE`
allowance, to keep the "one write endpoint" constraint honest (delete is a
write-adjacent operation on a resource the client itself created via the one
sanctioned write path, not a new capability).

**Test:** upload, delete, assert `list()` no longer contains it and `schema()`/
`preview()` 404; deleting an unknown id 404s without touching the filesystem;
deleting another user's dataset id 404s (namespace isolation, mirrors the
existing `load()` behavior).

---

## F3 — Canvas renders raw JSON instead of the widget kit (MEDIUM)

**Where:** `web/components/data/Canvas.tsx:12`

```tsx
<pre>{JSON.stringify(item.artifact.data, null, 2)}</pre>
```

**The gap:** design W3 §6 describes the canvas as a dashboard of *rendered*
artifacts. Every pinned item currently shows as a debug dump, not a chart or
table — the feature does not do what pinning is for.

**Fix:** replace the `<pre>` with `<GenWidget artifact={toArtifactWidget(item.artifact)} />`,
reusing the exact same widget kit `Workspace.tsx` already uses for live
artifacts (`web/widgets/GenWidget.tsx`, built in Phase 2). `CanvasArtifact` in
`web/lib/canvas.ts` needs `kind: ArtifactKind` added (currently only `{ id, data,
title? }`) so the pin action can carry it through — `pinArtifact` call sites
(wherever an artifact/cell/surface exposes a "pin" affordance) already have the
artifact's kind available at the point they call it.

**Test:** extend `web/tests/canvas.test.ts` — pinning a `bar` artifact and
rendering the canvas produces the same DOM shape `GenWidget` produces for that
kind directly (assert via the `Bar` widget's own test-id/marker, not string
matching); malformed/missing `kind` falls back to the existing `<pre>` dump as a
degrade path, not a crash.

---

## F4 — Canvas has no persistence (MEDIUM)

**Where:** `web/lib/canvas.ts`, `web/components/data/Canvas.tsx`

Pure in-memory transforms; nothing writes anywhere. Reload loses every pin.
Design's open question 3 was never resolved or documented.

**Fix — resolving open question 3 now:** `localStorage`, scoped per project, not
a new server store. Rationale: canvas state is view configuration (which
artifacts, in what order, at what width) plus enough provenance to *re-fetch*
the data — it is not itself a fact worth memory's ACL/provenance/audit
machinery, and a new `~/.harness/canvas/` store would be a second persistence
concept for a feature that fits in a few KB of JSON. This resolution is recorded
here per the standing instruction to document open-question decisions rather
than deciding silently in code.

```ts
// web/lib/canvas.ts
const KEY_PREFIX = 'harness-canvas:'
export function loadCanvas(projectId: string): PinnedArtifact[] {
  try { return JSON.parse(localStorage.getItem(KEY_PREFIX + projectId) ?? '[]') } catch { return [] }
}
export function saveCanvas(projectId: string, items: PinnedArtifact[]): void {
  localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(items))
}
```

`Canvas.tsx` loads on mount (keyed by `activeProject`) and saves after every
pin/reorder/refresh. A `PinnedArtifact.artifact.data` that grows large (e.g. a
1000-row table) is capped — reuse the existing 512 KB `MAX_SURFACE_BYTES`-style
bound so one oversized pin can't silently break `localStorage` for the whole
canvas; a pin over the cap stores a truncation marker instead of the full data
and shows a "refresh to reload full data" state.

**Test:** pin, reload the module state (simulate a fresh mount), assert the
canvas rehydrates; switching `projectId` shows a different canvas, not a shared
one; an oversized artifact stores truncated with the marker rather than
throwing.

---

## F5 — Export functions built but unwired (MEDIUM)

**Where:** `web/lib/export.ts`, `web/components/data/Canvas.tsx`

`tableToCsv` is wired (`DataTable.tsx`). `canvasToPng` and `sessionToHtml` are
tested in isolation and called from nowhere.

**Fix:**
- Canvas gets an "Export" control that calls `canvasToPng` against a canvas-root
  ref (requires the canvas DOM to be rendered to an offscreen `<canvas>` first —
  simplest correct approach is `html-to-image`-style DOM rasterization is out of
  scope; instead render the canvas section into an actual `<canvas>` element via
  each widget's existing SVG output serialized through `Image` + `drawImage`, one
  function `renderCanvasToPng(root: HTMLElement): Promise<string>` in
  `web/lib/export.ts` that walks child SVGs). If this proves heavier than the
  budget below, the fallback is a plain "download as SVG" per-widget action
  instead of a rasterized whole-canvas PNG — acceptable, and cheaper, but record
  which was shipped.
- Conversation view (or a new top-level action in `TopBar`) gets a "Export
  session" control that assembles the current turn list into the `body` argument
  for `sessionToHtml` (see F6 for the escaping fix this depends on) and triggers
  a browser download via an object URL — **not** a data-URI link for a
  potentially large document.

**Test:** clicking Export on a canvas with ≥1 pinned artifact produces a
non-empty PNG data URL; clicking Export session with a non-empty transcript
produces a self-contained HTML string containing no `http://`/`https://`
references (existing `export.test.ts` assertion, now exercised through the
actual UI action via Testing Library, not just the pure function).

---

## F6 — `sessionToHtml` doesn't escape body content (LOW, blocks F5)

**Where:** `web/lib/export.ts:3`

```ts
export function sessionToHtml(title: string, body: string): string {
  return `<!doctype html>...<title>${title.replace(/[<>]/g, '')}</title>...<body>${body}</body></html>`
}
```

`body` is interpolated raw. Once F5 wires this to real transcript content —
which may contain text the agent quoted from untrusted, provenance-tainted
sources per #22 — this becomes stored HTML/script execution in a file the
operator opens locally.

**Fix:** the caller (F5) must pass already-safe fragments, not raw turn text.
Two options, pick the cheaper one that's still correct:
1. Escape: caller HTML-escapes each turn's text content before building `body`,
   and only structural wrapper markup (the caller's own, not user/agent content)
   is unescaped.
2. Sanitize: run `body` through a minimal allowlist sanitizer (strip `<script>`,
   `on*` attributes, `javascript:` hrefs) before it reaches `sessionToHtml`.

Given the export is plain turn text plus tool-call summaries (no rich HTML
authored by the agent today), option 1 is sufficient and needs no new
dependency: build `body` from escaped text nodes, not from concatenated raw
strings. `sessionToHtml` itself gains a doc comment stating the caller's
obligation, and a defense-in-depth escape of any literal `</script`-like
sequence (same technique already used in `web/surface/frame.ts`'s
`scriptSafe`) so the function is not a footgun for the next caller either.

**Test:** a turn containing `<script>alert(1)</script>` round-trips through the
real export path (F5's caller) into an HTML string with no executable
`<script>` tag; the existing `export.test.ts` case for `sessionToHtml` itself
gains a raw-body-with-script-tag case asserting the tag is neutralized.

---

## F7 — Escape-attempt corpus is declarative only (LOW)

**Where:** `web/tests/surface.test.ts:16`

```ts
expect(escapeCorpus).toHaveLength(6)
```

The runtime mitigation (`sandbox="allow-scripts"` without `allow-same-origin"` in
`SurfaceHost.tsx`) is correctly applied. The test only checks the corpus's
length, so a future change that weakens isolation (e.g. someone adds
`allow-same-origin` for a plausible-seeming reason) would not be caught by
anything in the current suite — jsdom cannot enforce the `sandbox` attribute.

**Fix:** a real-browser test using the Playwright MCP tooling already available
in this environment (`mcp__plugin_playwright_playwright__*`), or a Playwright
dev-dependency test if the environment running CI needs it headless and
scriptable outside the MCP tool. For each of the six corpus entries: mount a
`SurfaceHost` with `js: entry` in a real page, wait for the frame to settle, and
assert the attempt either throws inside the frame (visible as a `ui_result` with
`errors` containing the exception) or silently no-ops without leaking data back
to the parent (for `fetch`/`document.forms.submit`, assert no corresponding
network request left the sandboxed context — `read_network_requests` if done via
the Playwright/browser MCP, or a page-level fetch spy if done via a Node-side
Playwright test).

If a full browser-driven CI test is judged too heavy for this pass, the interim
floor is: keep the declarative corpus, but add one narrower unit test that reads
`SurfaceHost.tsx`'s JSX output and asserts the `sandbox` attribute string is
exactly `"allow-scripts"` (not a superset) — cheap, catches the most likely
regression (someone appending `allow-same-origin`), and should be treated as a
placeholder for the real browser test, not a replacement for it. State which was
shipped.

---

## F8 — Open questions never resolved-and-documented (LOW, process)

**Where:** all four `2026-08-16-*-design.md` files

Fix is procedural, not code: as F1–F7 are implemented, whichever open question
each one touches gets a short **Resolution (2026-08-16):** note added directly
under the relevant "Open questions" entry in the design doc it lives in —
matching what F4 does above for canvas persistence. Specifically:
- [`web-surface-design.md`](2026-08-16-web-surface-design.md) §8.1 (chart lib) —
  confirm hand-rolled SVG shipped in Phase 2; note it as resolved rather than
  open.
- [`web-surface-design.md`](2026-08-16-web-surface-design.md) §8.4 (`ExecuteCode`
  in web) — leave open if genuinely undecided; do not close speculatively.
- [`analyst-workbench-design.md`](2026-08-16-analyst-workbench-design.md) §9.1
  (are surfaces pinnable?) — resolve per whatever F3's implementation actually
  does (the fix above pins `ArtifactWidget`s; if a surface pin path exists or is
  added, say so and say what "export" means for a pinned surface, since a
  surface cannot be rasterized to CSV).
- [`analyst-workbench-design.md`](2026-08-16-analyst-workbench-design.md) §9.2
  (auto-profile on upload) and §9.3 (`.ipynb` export) — leave open, out of scope
  for this fix pass.
- [`web-read-api-design.md`](2026-08-16-web-read-api-design.md) §7.2 (Parquet) —
  confirm opaque-store-only shipped; note resolved.
- Canvas persistence — added by F4 above.

---

## Risks

| Risk | Mitigation |
|---|---|
| F1's ceiling tightening breaks a real deployment that relied on `analyst`/`assistant` + explicit `yolo` | None of the shipped example profiles use this combination (confirmed); document the behavior change in `docs/DEPLOYMENT.md` as a breaking-change note, same convention as the original origin-policy change |
| F5's PNG export approach (SVG rasterization) is heavier than it looks | Fallback to per-widget SVG download is explicitly sanctioned in F5; ship whichever is correct and cheap, record the choice |
| F7's browser-driven test is flaky in CI | Keep the interim unit-test floor as a permanent second line, not a throwaway — a strict-string `sandbox` attribute check costs nothing and stays even after the browser test lands |
| F3/F4 touch the same files sequentially | Order F4 after F3 in the plan — F4's persistence shape (`PinnedArtifact` round-trip) is simpler to get right once F3's `CanvasArtifact.kind` field exists |

## Validation

- [ ] `tests/approval-authority.test.ts` proves `analyst`/`assistant`/`production` all reject an effective `yolo`, and that a `deny`-ACL tool stays denied under the resulting `danger` ceiling.
- [ ] `DELETE /datasets/:id` removes the dataset; 404s on unknown or cross-user id.
- [ ] A pinned bar/table artifact renders as a chart/table on the canvas, not JSON.
- [ ] Canvas state survives a reload, scoped per project.
- [ ] Canvas export and session export are reachable from the UI, not just from tests.
- [ ] A `<script>`-bearing turn cannot execute in an exported session HTML file.
- [ ] Surface isolation has either a real browser-executed escape test or, at minimum, a strict `sandbox` attribute string test, with the choice stated.
- [ ] Every design doc's touched open question has a `Resolution (2026-08-16):` note.
- [ ] `pnpm typecheck && pnpm test && ./scripts/check-boundary.sh` and `pnpm --filter harness-web typecheck && pnpm --filter harness-web test` all green.
