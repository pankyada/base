# Web Surface — Master Design (W0)

> Date: 2026-08-16
> Status: Draft (design)
> Related: [`2026-08-16-web-read-api-design.md`](2026-08-16-web-read-api-design.md),
> [`2026-08-16-analyst-workbench-design.md`](2026-08-16-analyst-workbench-design.md),
> [`2026-08-16-operator-assistant-console-design.md`](2026-08-16-operator-assistant-console-design.md),
> [`../plans/2026-08-16-web-surface.md`](../plans/2026-08-16-web-surface.md), `docs/ROADMAP.md`

## Goal

The harness backend grew twenty-seven subsystems. The web client
(`web/`, ~1.5k LOC) still speaks the protocol of roadmap #8 and renders none of
them. This design defines what the browser surface becomes: a control plane with
three faces — **analyst**, **operator**, **assistant** — over one runtime, sharing
one component kit and one token system.

The gap is measurable, not aesthetic:

| Evidence | Location |
|---|---|
| Nine artifact widgets are literal stubs returning `<div>BarChart Widget</div>` | `web/widgets/GenWidget.tsx:4-12` |
| 17 of 35 `ServerMessage` variants are dropped by the reducer | `web/components/HarnessApp.tsx:90-157` vs `src/types.ts:188-221` |
| `cost_usd`, `context_tokens`, `context_window` arrive and are discarded | `web/components/HarnessApp.tsx:127` |
| `ui_render` surfaces are produced by the runtime and never mounted | `src/tools/builtin/render-ui.ts:81`, no web handler |
| `user_id` is hardcoded; `yolo` is asserted by the browser | `web/hooks/useHarnessWS.ts:27-30` |
| No `Origin` validation on WS upgrade | `src/server/index.ts` (absent) |
| Telemetry, usage, audit, routing stats have no HTTP surface | `src/telemetry/`, `src/usage/`, `src/audit/`, `src/analysis/` |

### Non-goals

- **Not multi-tenant hosting.** Deployment target is localhost / trusted LAN for a
  single operator. Login, org accounts, and row-level authorization are out of
  scope; the boundary is the *transport*, not a user table (§3).
- **Not a TUI replacement.** The Go TUI remains the primary dev surface. Parity is
  a floor for the web client, not a ceiling, and neither surface blocks the other.
- **Not a new design language.** The existing token system in
  `web/styles/globals.css` is extended, not replaced (§5).
- **Not a charting framework.** The widget kit is a fixed, small set of marks.
  Anything beyond it is the model's job through `RenderUI` (§4).
- **No product or vendor vocabulary in `src/`.** `scripts/check-boundary.sh`
  applies to every backend change in this track.

---

## 1. Architecture

```
                    ┌─────────────────────── browser ───────────────────────┐
                    │                                                       │
  WS :7337  ───────▶│  useHarnessWS ──▶ reducer ──▶ three route shells      │
  (live turn)       │                     │          /  · analyst           │
                    │                     │          /ops · operator        │
  REST :7337 ──────▶│  useHarnessQuery ───┘          /home · assistant      │
  (read APIs)       │                     │                                 │
                    │                     ├──▶ widget kit (fixed marks)     │
                    │                     ├──▶ SurfaceHost (sandboxed frame)│
                    │                     └──▶ HarnessPython (Pyodide)      │
                    └───────────────────────────────────────────────────────┘
```

Two data paths, deliberately distinct:

- **WS** — everything belonging to a *live turn*: tokens, tool lifecycle,
  approvals, stages, surfaces, todos. Ephemeral, ordered, already implemented
  server-side.
- **REST read APIs** — everything belonging to *accumulated state*: telemetry,
  usage, audit, memory, datasets, triggers, transcripts. Cacheable, paginated,
  independent of a connection. These do not exist yet; W1 builds them.

The split matters because the operator and assistant faces are mostly *not* about
a running turn. Forcing them through the WS session would couple dashboards to an
active agent and make reload lossy.

### 1.1 Module layout (web)

```
web/
  app/
    page.tsx              # analyst workbench (default route)
    ops/page.tsx          # operator console
    home/page.tsx         # assistant brief
    layout.tsx
  components/
    chrome/               # TopBar, StatusBar, Rail, Palette, Tweaks
    turn/                 # Message, AgentTurn, ToolCall, StageStrip, PlanCard
    modals/               # Approval, InputRequest, Undo, Confirm
    data/                 # DatasetDrawer, SchemaCard, NotebookCell, Canvas
    ops/                  # RunBoard, AuditTable, BudgetMeter, TriggerList
    assistant/            # BriefCards, MemoryTimeline, SkillQueue, ChannelList
  widgets/                # fixed mark kit (replaces the stubs)
  surface/                # SurfaceHost — sandboxed iframe + bridge
  hooks/                  # useHarnessWS, useHarnessQuery, useClock
  lib/                    # types, protocol, format, colour ramp
```

Rule: `components/` owns layout and state, `widgets/` owns marks and is pure
(props in, SVG out, no fetching). Widgets must be renderable from a Storybook-less
fixture file so the kit is testable without a server.

---

## 2. Protocol coverage

The reducer's contract becomes: **every `ServerMessage` variant is either handled
or explicitly ignored with a comment naming why.** A `default:` branch that
silently drops is what produced the current gap.

| Message | Today | Target surface |
|---|---|---|
| `turn_start`, `run_id` on all events | ignored | run lanes — concurrent runs render side by side |
| `token`, `tool_start/end/parked/prompt` | handled | keep; add risk badge from `tool_prompt.risk`/`reason` |
| `stats` | partial | context gauge + live cost ticker (uses `context_tokens`/`context_window`/`cost_usd`) |
| `stage` | ignored | stage strip: stage · intensity · tier · per-stage cost |
| `plan` / `plan_request` | ignored | plan card with edit-then-approve |
| `notice` | ignored | toast stack, level-coloured |
| `models` / `model_changed` | ignored | model switcher in palette, availability + price shown |
| `approval_mode_changed` | ignored | approval-mode selector (server is authority, §3) |
| `skills` / `skill_content` / `skill_result` | ignored | skill review queue |
| `commands` | ignored | palette slash commands |
| `pending` | ignored | deferred-ask inbox |
| `undo_entries` | ignored | undo drawer with staleness |
| `ui_render` | ignored | `SurfaceHost` (§4) |
| `code_execute` | handled | keep; add notebook cell rendering + `files` capture |
| `artifacts` | handled | keep; render through the real widget kit |
| `transcript_partial`, `audio_out_*` | ignored | explicitly deferred — voice is #23, not this track |

Client → server additions: `cancel`, `compact`, `models_list`, `set_model`,
`set_approval_mode`, `skills_*`, `commands_list`, `pending_list`,
`pending_answer`, `undo_list`, `undo_apply`, `plan_request`, `ui_result`.

`web/lib/types.ts` currently maintains a hand-copied, already-drifted duplicate of
`src/types.ts` (it lacks `ApprovalMode`, `RiskLevel`, `SurfaceSpec`, `ModelInfo`,
`SkillSummary`, `Stage`). Drift is the root cause of the coverage gap, so the
duplicate is deleted: `web/lib/types.ts` re-exports from a generated
`web/lib/protocol.ts` emitted from `src/types.ts`, with a CI check that the
generated file is current. A protocol addition then *breaks the build* instead of
being silently ignored.

---

## 3. Trust boundary

Chosen deployment posture: **single operator, localhost.** No login. That decision
makes the transport the only boundary, so the transport must actually hold.

It does not today. WebSocket connections are exempt from same-origin policy, and
`src/server/index.ts` performs no `Origin` check. Any page the operator visits in
any tab can open `ws://localhost:7337`, send
`hello { user_id: 'x', yolo: true }`, and drive a `developer`-mode profile with
`Bash`. The browser-asserted `yolo` flag (`web/hooks/useHarnessWS.ts:30`) removes
the approval prompt that would otherwise be the last line of defence.

Two changes, both small, both prerequisites for shipping any new browser surface:

1. **Origin allowlist on upgrade.** `HARNESS_ALLOWED_ORIGINS`, default
   `http://localhost:3000,http://127.0.0.1:3000`. Absent or mismatched `Origin` →
   reject the upgrade with 403. Non-browser clients (TUI, CLI) send no `Origin`
   and are matched by a separate explicit rule, not by falling through.
2. **Approval authority moves server-side.** `hello.yolo` is ignored. Approval
   mode comes from the profile / `HARNESS_APPROVAL_MODE`, and `set_approval_mode`
   is honoured only within the ceiling the profile permits. The UI reflects the
   mode; it does not grant it.

The same allowlist gates the REST read APIs (`Origin` check plus the existing
optional `HARNESS_API_KEY`). Read APIs expose telemetry, audit, and memory — a
CSRF-shaped read leak is a real leak.

`user_id` stays client-supplied but becomes a *scoping* value, not an authorization
one: it selects which memory/usage namespace to use, and is settable in Tweaks so
the operator can mirror their TUI identity instead of the hardcoded `'web-user'`.
This is documented as scoping-only so no later feature mistakes it for auth.

**If the posture ever changes to hosted or multi-user, this section is void** and
real identity becomes a hard prerequisite. Recorded here so that decision cannot be
made implicitly.

---

## 4. Two rendering paths, on purpose

The runtime can already emit arbitrary generated UI through `RenderUI`
(`src/tools/builtin/render-ui.ts`) as a `SurfaceSpec` of html/css/js/python. It
also emits structured `ArtifactWidget`s. These overlap, and the overlap is kept:

**Fixed widget kit** — for anything that must look consistent, be themed, export
cleanly, and be trusted: KPI tiles, the standard chart marks, tables, diffs. The
model chooses a `kind` and supplies data; the client owns presentation. Predictable,
accessible, cheap to render, safe to pin to a dashboard.

**Generative surface** — for anything bespoke: a custom simulation, an interactive
explorer, a layout no fixed kind covers. Isolated in an opaque-origin sandboxed
iframe with no parent DOM, cookies, storage, or network egress, exactly as the tool
description already promises. The client owns only the sandbox and the
`ui_result` diagnostics channel.

Guidance encoded in the system prompt: *prefer an artifact kind when one fits;
reach for `RenderUI` when none does.* Surfaces are the escape hatch, not the
default, because a surface cannot be re-themed, exported to CSV, or diffed.

Surface isolation requirements (non-negotiable, enforced by test):

- `sandbox="allow-scripts"` **without** `allow-same-origin` — opaque origin, so
  `localStorage`/`cookie` access throws rather than reaching the host.
- CSP on the frame document: `default-src 'none'; script-src 'unsafe-inline';
  style-src 'unsafe-inline'; connect-src 'none'; img-src data:`.
- `postMessage` bridge with an explicit message allowlist; the host never `eval`s
  anything the frame sends.
- Payload cap already enforced server-side at 512 KB
  (`src/tools/builtin/render-ui.ts:5`); the host enforces the same bound before
  mounting so a compromised server cannot wedge the tab.

**Resolution (2026-08-16):** This fix pass ships the sanctioned strict
`sandbox="allow-scripts"` attribute test. A full browser-driven six-entry escape
corpus remains follow-up work because the current web unit-test command has no
headless browser runner.

---

## 5. Design tokens v2

The existing dark-first amber system (`web/styles/globals.css:6-60`) stays. It
gains what data-dense surfaces need and currently lack:

```css
/* charts — 8 hues, ordered by first-use, distinguishable at 3% desaturation */
--series-1 … --series-8
--seq-0 … --seq-5        /* sequential ramp, accent-anchored */
--div-neg-2 … --div-pos-2 /* diverging, del↔add anchored */

/* run/tool status — one source of truth for badges, lanes, and timelines */
--st-running / --st-waiting / --st-done / --st-error / --st-denied / --st-skipped

/* density — tables and boards need tighter steps than prose */
--row-h-compact / --row-h-regular / --row-h-comfy
--gap-1 … --gap-6
```

Both themes define every token. Constraints: series hues must remain
distinguishable under deuteranopia simulation and hold ≥3:1 contrast against
`--panel` in both themes; a fixture page renders the full ramp for visual check
and a unit test asserts no token is defined in only one theme block.

---

## 6. Backend changes (summary)

Detailed in [`2026-08-16-web-read-api-design.md`](2026-08-16-web-read-api-design.md).
Shape only, here:

- `src/server/origin.ts` — allowlist check shared by the WS upgrade and REST.
- `src/server/read-api.ts` — `GET /metrics`, `/usage`, `/audit`, `/memory`,
  `/triggers`, `/datasets`, `/sessions/:id/messages`, `/stats/routing`. Thin
  wrappers over `queryEvents`, `readUsage`, `listAudit`, `MemoryProvider.list`,
  the trigger registry, and `aggregateRouting` — all of which already exist.
- `src/datasets/store.ts` — per-user dataset store plus `POST /datasets` upload
  (the only new *write* endpoint in this track).
- No change to the agent loop, ACL, or workflow modules.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Origin allowlist breaks TUI/CLI or Docker deploys | Non-browser (no `Origin`) matched explicitly; compose file sets the var; `harness doctor` prints the effective list |
| Read APIs leak telemetry to a malicious local page | Same allowlist + optional API key; endpoints are read-only and user-scoped |
| Dataset upload becomes an arbitrary-write primitive | Fixed root under `~/.harness/datasets/<user>/`, extension allowlist, size cap, no path components from the client |
| Generated surfaces escape the sandbox | Opaque origin + CSP + message allowlist, with an escape-attempt test corpus that grows and never shrinks |
| Widget kit slowly becomes a charting library | Fixed `ArtifactKind` union; a new kind needs a design note stating why `RenderUI` is insufficient |
| Protocol drift returns | Generated `web/lib/protocol.ts` + CI freshness check; unhandled variant fails typecheck |
| Scope: five faces, one client | Phased plan; every phase ships standalone and leaves `pnpm typecheck && pnpm test` green |

## 8. Open questions

1. **Chart implementation** — hand-rolled SVG (no dep, full token control, more
   code) versus a small library. Plan assumes hand-rolled SVG for the eight marks;
   revisit if the kit exceeds ~800 LOC.
   **Resolution (2026-08-16):** Hand-rolled SVG shipped in Phase 2; the fixed
   widget kit remains dependency-free.
2. **Transcript rehydration bound** — replaying a long ledger into the reducer may
   be slow. Cap at the last N turns with an explicit "load earlier" affordance?
3. **Canvas persistence** — pinned dashboards as project memory records, or a new
   `~/.harness/canvas/` store? Memory scope avoids a new persistence concept but
   makes non-fact data live in a fact store.
   **Resolution (2026-08-16):** Per-project browser `localStorage` shipped. Canvas
   layout is view configuration, not memory, and stays out of server persistence.
4. **Does the web client host `ExecuteCode` for unattended runs?** A browser tab is
   an unreliable executor. Proposal: WASM only while a tab is attached; server
   executors otherwise — already the `executor.fallback` contract, needs testing.
