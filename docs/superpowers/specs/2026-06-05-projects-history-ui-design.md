# Projects + History — UI Design (Web + TUI)

> Date: 2026-06-05
> Status: Approved design, ready for implementation planning
> Companion to: `2026-06-05-projects-and-history-design.md` (runtime/data layer).
> Decision: **palette-driven** navigation — no new persistent sidebar/chrome.

## Problem

The runtime spec adds per-user projects and richer session history (find + resume). The UI
must expose: create a project, switch the active project, browse history, resume a session,
and reassign a session to a project. Decision: surface all of this through the **existing
command palette** (`Cmd+K` web / `Ctrl+K` TUI) rather than adding a sidebar. Cheapest path,
fits the established pattern, keeps the stage full-width.

## Current UI facts (verified against code)

- Web shell: `TopBar` (top) → `stage` (conv column + optional `Workspace` column) →
  `StatusBar` (bottom), plus floating `TodoPanel`, `Palette` (`Cmd+K`), `Tweaks` drawer
  (`web/components/HarnessApp.tsx`).
- `Palette` today is a **static** list (`RUN_SCENARIOS` + `SESSION_ACTIONS`) firing
  `onRun(id)` / `onReset()` (`web/components/Palette.tsx`). No async data, no sub-views.
- WS plumbing: `useHarnessWS` + a `SERVER_MSG` reducer in `HarnessApp`; `send()` emits
  `ClientMessage`s. `session_ready` already carries `{ profile, sessionId }`.
- TUI mirrors the shell with `Palette` + `TabBar` panes (`src/tui/components/`).

## Approach: mode-based palette

Evolve `Palette` from a flat list into a small **view stack** with these modes:

| Mode | Entry | Content | Enter action |
|------|-------|---------|--------------|
| `root` | default | existing commands + new ones (below) | run command / push mode |
| `project_switch` | "Switch project…" | `projects` (from `project_list`) | set active project, close |
| `project_new` | "New project…" | text input (name) | `project_create`, close |
| `history` | "Browse history…" | `SessionSummary[]` (from `session_list`, active project) | `resume`, close |
| `history_all` | "Browse all history…" | `SessionSummary[]` (no project filter) | `resume`, close |
| `assign` | "Move session to project…" | `projects` | `project_assign` (current session), close |

New `root` commands appended to the palette list, grouped under `PROJECT` and `HISTORY`:

- `PROJECT` → New project…, Switch project…, Move session to project…
- `HISTORY` → Browse history…, Browse all history…

Navigation: `Esc` pops one mode (back), or closes from `root`. `↑/↓` move selection,
`Enter` activates, type-to-filter persists per mode. A breadcrumb line at the top of the
palette shows the current mode (e.g. `Projects ›`). Sub-views that need data dispatch the
relevant `*_list` request **on mode entry** and render a one-line "Loading…" until the
matching `projects` / `sessions` ServerMessage arrives.

## State additions (web)

`HarnessApp` reducer `State` gains:

```ts
activeProject: string          // projectId; defaults to "inbox"
activeProjectName: string       // for display; defaults to "Inbox"
projects: Project[]             // last project_list result (cache)
history: SessionSummary[]       // last session_list result (cache)
```

New actions: `SET_ACTIVE_PROJECT`, `SET_PROJECTS`, `SET_HISTORY`. New `SERVER_MSG` handling
for `projects`, `project_created`, `sessions` (history). On `project_created`, append to
`projects` and switch active project to the new one.

`Project` and `SessionSummary` types are added to `web/lib/types.ts`, mirroring the runtime
spec.

## Active project ↔ new sessions (protocol reconciliation)

The server creates a session in **Inbox** by default (runtime spec). To make new sessions
land in the user's chosen project **without adding new protocol messages**, the client treats
`activeProject` as a pointer and reconciles after a session starts:

- On `session_ready`, if `activeProject !== "inbox"`, the client immediately sends
  `project_assign { sessionId, projectId: activeProject }`.
- Switching project mid-conversation only affects **subsequently created** sessions; it does
  not retro-move the live session unless the user explicitly runs "Move session to project…".

This keeps the UI spec consistent with the runtime spec's existing `project_assign` message —
no new message types are introduced by the UI layer.

## Glanceable breadcrumb (minimal, not a sidebar)

Even in palette-only mode, the user needs to see where they are. Add the active project name
to the existing chrome — **no new component**:

- Web: `TopBar` shows `profile · ProjectName · sessionId` (extend existing props).
- TUI: session breadcrumb header gains the project name segment.

This is the only persistent visual change. Everything else is invoked through the palette.

## Resume flow

History sub-views render each `SessionSummary` as `title` (bold) + dim `summary` +
right-aligned `created_at`/cost. `Enter` sends the existing `resume { sessionId }` message;
the reducer already handles `session_resumed`. On resume, the client also sets `activeProject`
to the resumed session's `project` so the breadcrumb stays correct.

## TUI parity

The TUI `Palette` gets the same mode stack and the same `PROJECT` / `HISTORY` commands, wired
to the TUI's WS send + message hooks. The TUI breadcrumb header shows the active project. No
new panes — consistent with the palette-only decision.

## Components touched

| File | Change |
|------|--------|
| `web/components/Palette.tsx` | Rewrite as mode-based view stack; accept data + handlers |
| `web/components/HarnessApp.tsx` | New state/actions; `projects`/`sessions` msg handling; `session_ready` → conditional `project_assign`; pass palette data/handlers |
| `web/components/TopBar.tsx` | Show active project name segment |
| `web/lib/types.ts` | `Project`, `SessionSummary`, new client/server message types |
| `src/tui/components/Palette.tsx` | Mode stack + PROJECT/HISTORY commands |
| `src/tui/` breadcrumb | Active project segment |

## Testing

- Palette mode navigation: push/pop, `Esc` back vs close, filter-per-mode reset.
- `project_new` round-trip: create → `project_created` → active project switches → breadcrumb
  updates.
- `project_switch`: selecting a project sets `activeProject`; a newly started session is
  auto-assigned via `project_assign`.
- `history` / `history_all`: list renders summaries (not full blobs); `Enter` resumes; active
  project syncs to resumed session.
- `assign`: moves the current session; subsequent `session_list` reflects the move.
- Component tests follow existing web test patterns; TUI palette tested via its hook layer.

## Build order

1. Types in `web/lib/types.ts` + reducer state/actions + `projects`/`sessions` msg handling
2. Mode-based `Palette` rewrite (web) with the six modes
3. `session_ready` → conditional `project_assign`; breadcrumb in `TopBar`
4. TUI palette parity + TUI breadcrumb
5. Tests

## Non-goals / YAGNI

- No persistent sidebar, drag-to-assign, or project color/icon theming (palette-only decision).
- No multi-select bulk reassignment — one session at a time.
- No history search ranking beyond simple substring filter (matches current palette behavior).
- No new WS message types beyond those defined in the runtime spec.
