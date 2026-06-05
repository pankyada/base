# Projects + History — UI Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **DEPENDS ON Plan 1** (`2026-06-05-projects-history-runtime.md`). The WS message types, `Project`, and `SessionSummary` must exist on the server before this plan is executed.

**Goal:** Surface projects + history through the existing command palette (web + TUI): create/switch projects, browse history, resume sessions, reassign sessions — plus a minimal active-project breadcrumb. No new sidebar.

**Architecture:** The palette becomes a small mode stack (`root` → `project_switch` / `project_new` / `history` / `history_all` / `assign`). Sub-views fetch data via existing-pattern WS messages on entry and render the cached result. `activeProject` is a client pointer; on `session_ready` the client auto-sends `project_assign` if it is not `inbox`. No new WS message types beyond Plan 1.

**Tech Stack:** Next.js + React (web), Ink + React (TUI), TypeScript.

> Spec: `docs/superpowers/specs/2026-06-05-projects-history-ui-design.md`

---

### Task 1: Web types — mirror `Project`, `SessionSummary`, new messages

**Files:**
- Modify: `web/lib/types.ts`
- Test: `web/lib/types.test.ts` (compile-only assertion via vitest)

- [ ] **Step 1: Write the failing test**

```ts
// web/lib/types.test.ts
import { describe, it, expect } from 'vitest'
import type { Project, SessionSummary, ClientMessage, ServerMessage } from './types'

describe('project/history web types', () => {
  it('constructs values matching the new types', () => {
    const p: Project = { id: 'inbox', user: 'u', name: 'Inbox', created_at: '2026-06-05T00:00:00Z' }
    const s: SessionSummary = { id: 'abc12345', project: 'inbox', created_at: '2026-06-05T00:00:00Z', usage: { input: 0, output: 0, cost_usd: 0 } }
    const c: ClientMessage = { type: 'project_create', name: 'X' }
    const m: ServerMessage = { type: 'projects', projects: [p] }
    expect(p.id).toBe('inbox')
    expect(s.project).toBe('inbox')
    expect(c.type).toBe('project_create')
    expect(m.type).toBe('projects')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run lib/types.test.ts`
Expected: FAIL — `Project` / `SessionSummary` not exported; new message variants missing.

- [ ] **Step 3: Add the types**

In `web/lib/types.ts`, add the interfaces:

```ts
export interface Project {
  id: string
  user: string
  name: string
  created_at: string
  description?: string
}

export interface SessionSummary {
  id: string
  project: string
  title?: string
  summary?: string
  created_at: string
  usage: { input: number; output: number; cost_usd: number }
}
```

Add to the `ClientMessage` union:

```ts
  | { type: 'project_create'; name: string; description?: string }
  | { type: 'project_list' }
  | { type: 'project_assign'; sessionId: string; projectId: string }
  | { type: 'session_list'; projectId?: string }
```

Add to the `ServerMessage` union:

```ts
  | { type: 'project_created'; project: Project }
  | { type: 'projects'; projects: Project[] }
  | { type: 'sessions'; sessions: SessionSummary[] }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run lib/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/types.ts web/lib/types.test.ts
git commit -m "feat(web): project + history client types"
```

---

### Task 2: Reducer state + message handling in `HarnessApp`

**Files:**
- Modify: `web/components/HarnessApp.tsx`
- Test: `web/components/harnessReducer.test.ts`

> The reducer is currently a private `function reducer` inside `HarnessApp.tsx`. First export it so it can be unit-tested.

- [ ] **Step 1: Export the reducer and its types**

In `web/components/HarnessApp.tsx`, change `function reducer(...)` to
`export function reducer(...)`, and export the `State` and `Action` types
(`export interface State` / `export type Action`).

- [ ] **Step 2: Write the failing test**

```ts
// web/components/harnessReducer.test.ts
import { describe, it, expect } from 'vitest'
import { reducer, type State } from './HarnessApp'

const base: State = {
  messages: [], tabs: [], activeTab: 0, input: '', busy: false,
  focusPane: 'conv', paletteOpen: false, tokens: { in: 0, out: 0 },
  pendingApproval: null, tweaksOpen: false, theme: 'dark', palette: 'amber', density: 'regular',
  todos: [], pendingInputRequest: null, pendingCodeExecution: null,
  profile: '…', sessionId: '…',
  activeProject: 'inbox', activeProjectName: 'Inbox', projects: [], history: [],
}

describe('reducer project/history handling', () => {
  it('stores projects from a projects message', () => {
    const next = reducer(base, { type: 'SERVER_MSG', payload: { type: 'projects', projects: [{ id: 'p1', user: 'u', name: 'Alpha', created_at: 'x' }] } })
    expect(next.projects.map(p => p.name)).toContain('Alpha')
  })

  it('switches active project on project_created', () => {
    const next = reducer(base, { type: 'SERVER_MSG', payload: { type: 'project_created', project: { id: 'p9', user: 'u', name: 'Fresh', created_at: 'x' } } })
    expect(next.activeProject).toBe('p9')
    expect(next.activeProjectName).toBe('Fresh')
    expect(next.projects.some(p => p.id === 'p9')).toBe(true)
  })

  it('stores history from a sessions message', () => {
    const next = reducer(base, { type: 'SERVER_MSG', payload: { type: 'sessions', sessions: [{ id: 's1', project: 'inbox', created_at: 'x', usage: { input: 0, output: 0, cost_usd: 0 } }] } })
    expect(next.history.map(h => h.id)).toContain('s1')
  })

  it('SET_ACTIVE_PROJECT updates pointer + name', () => {
    const next = reducer(base, { type: 'SET_ACTIVE_PROJECT', id: 'p2', name: 'Beta' })
    expect(next.activeProject).toBe('p2')
    expect(next.activeProjectName).toBe('Beta')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npx vitest run components/harnessReducer.test.ts`
Expected: FAIL — `activeProject` not on State; new actions/handlers missing.

- [ ] **Step 4: Extend `State`, `Action`, and the reducer**

In `web/components/HarnessApp.tsx`:

a) Add to `State` (import `Project`, `SessionSummary` from `../lib/types`):

```ts
  activeProject: string
  activeProjectName: string
  projects: Project[]
  history: SessionSummary[]
```

b) Add to `Action`:

```ts
  | { type: 'SET_ACTIVE_PROJECT'; id: string; name: string }
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'SET_HISTORY'; payload: SessionSummary[] }
```

c) Add reducer cases (top-level, next to the other simple cases):

```ts
    case 'SET_ACTIVE_PROJECT': return { ...state, activeProject: action.id, activeProjectName: action.name }
    case 'SET_PROJECTS': return { ...state, projects: action.payload }
    case 'SET_HISTORY': return { ...state, history: action.payload }
```

d) Inside the `SERVER_MSG` branch, add handlers (before the final `return state`):

```ts
      if (msg.type === 'projects') {
        return { ...state, projects: msg.projects }
      }
      if (msg.type === 'project_created') {
        return { ...state, projects: [...state.projects, msg.project], activeProject: msg.project.id, activeProjectName: msg.project.name }
      }
      if (msg.type === 'sessions') {
        return { ...state, history: msg.sessions }
      }
```

e) Add the new fields to the `useReducer` initial state object:

```ts
    activeProject: 'inbox', activeProjectName: 'Inbox', projects: [], history: [],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run components/harnessReducer.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/HarnessApp.tsx web/components/harnessReducer.test.ts
git commit -m "feat(web): reducer state for projects + history"
```

---

### Task 3: `session_ready` → conditional `project_assign`; resume syncs active project

**Files:**
- Modify: `web/components/HarnessApp.tsx`
- Test: `web/components/harnessReducer.test.ts` (extend)

- [ ] **Step 1: Write the failing test (resume sync via reducer)**

Add to `web/components/harnessReducer.test.ts`:

```ts
it('session_resumed keeps busy false (active project synced by effect, not reducer)', () => {
  const next = reducer({ ...base, busy: true }, { type: 'SERVER_MSG', payload: { type: 'session_resumed', sessionId: 's1' } })
  expect(next.busy).toBe(false)
})
```

> The `project_assign`-on-`session_ready` behavior lives in an effect (side-effecting `send`),
> not the reducer, so it is verified by Step 3's manual check rather than a reducer unit test.

- [ ] **Step 2: Run test to verify current behavior**

Run: `cd web && npx vitest run components/harnessReducer.test.ts`
Expected: PASS (this asserts existing `session_resumed` handling stays intact).

- [ ] **Step 3: Add the assign-on-ready effect**

In `HarnessApp`, after the `useHarnessWS` call, add an effect that fires when the session id
changes. Track the last assigned session in a ref to avoid duplicate sends:

```ts
const assignedFor = useRef<string>('')
useEffect(() => {
  const sid = state.sessionId
  if (sid && sid !== '…' && state.activeProject !== 'inbox' && assignedFor.current !== sid) {
    assignedFor.current = sid
    send({ type: 'project_assign', sessionId: sid, projectId: state.activeProject })
  }
}, [state.sessionId, state.activeProject, send])
```

- [ ] **Step 4: Manual verification**

Run the web client against a server with Plan 1 merged. Create a project via the palette
(Task 4), switch to it, send a message, then check the server: the new session's JSON has
`"project": "<that project id>"`. Confirm switching back to Inbox makes new sessions stay in
inbox (no assign sent).

- [ ] **Step 5: Commit**

```bash
git add web/components/HarnessApp.tsx web/components/harnessReducer.test.ts
git commit -m "feat(web): auto-assign new sessions to active project"
```

---

### Task 4: Mode-based `Palette` rewrite (web)

**Files:**
- Modify: `web/components/Palette.tsx`
- Modify: `web/components/HarnessApp.tsx` (pass new props + render)
- Test: `web/components/Palette.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/Palette.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Palette } from './Palette'

const noop = () => {}
const baseProps = {
  onClose: noop, onRun: noop, onReset: noop,
  projects: [{ id: 'p1', user: 'u', name: 'Alpha', created_at: 'x' }],
  history: [{ id: 's1', project: 'p1', title: 'Old chat', created_at: 'x', usage: { input: 0, output: 0, cost_usd: 0 } }],
  onRequestProjects: vi.fn(), onRequestHistory: vi.fn(),
  onSwitchProject: vi.fn(), onNewProject: vi.fn(), onResume: vi.fn(), onAssign: vi.fn(),
}

describe('Palette modes', () => {
  it('shows PROJECT and HISTORY commands at root', () => {
    render(<Palette {...baseProps} />)
    expect(screen.getByText(/Switch project/i)).toBeTruthy()
    expect(screen.getByText(/Browse history/i)).toBeTruthy()
  })

  it('entering switch-project requests projects and lists them', () => {
    render(<Palette {...baseProps} />)
    fireEvent.click(screen.getByText(/Switch project/i))
    expect(baseProps.onRequestProjects).toHaveBeenCalled()
    expect(screen.getByText('Alpha')).toBeTruthy()
  })

  it('selecting a project calls onSwitchProject', () => {
    render(<Palette {...baseProps} />)
    fireEvent.click(screen.getByText(/Switch project/i))
    fireEvent.click(screen.getByText('Alpha'))
    expect(baseProps.onSwitchProject).toHaveBeenCalledWith('p1', 'Alpha')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/Palette.test.tsx`
Expected: FAIL — Palette has no mode logic / props.

- [ ] **Step 3: Rewrite `Palette.tsx` as a mode stack**

Replace `web/components/Palette.tsx` with a version that keeps the existing scrim/input/list
styling but adds modes. Props:

```tsx
import { useState, useEffect, KeyboardEvent } from 'react'
import { Project, SessionSummary } from '../lib/types'

type Mode = 'root' | 'project_switch' | 'project_new' | 'history' | 'history_all' | 'assign'

interface Props {
  onClose: () => void
  onRun: (id: string) => void
  onReset: () => void
  projects: Project[]
  history: SessionSummary[]
  onRequestProjects: () => void
  onRequestHistory: (projectId?: string) => void
  onSwitchProject: (id: string, name: string) => void
  onNewProject: (name: string) => void
  onResume: (sessionId: string, project: string) => void
  onAssign: (projectId: string) => void
}
```

Behavior:
- `root` shows the existing RUN/SESSION commands **plus** rows: "Switch project…", "New
  project…", "Move session to project…", "Browse history…", "Browse all history…" grouped
  `PROJECT` / `HISTORY`. Selecting one calls `setMode(...)` and, for data modes, the matching
  `onRequest*` on entry (use a `useEffect` keyed on `mode`).
- `project_switch` / `assign`: render `projects` rows; Enter/click → `onSwitchProject(id,name)`
  (switch) or `onAssign(id)` (assign), then `onClose()`.
- `project_new`: render the input; Enter with non-empty value → `onNewProject(value)`, `onClose()`.
- `history` / `history_all`: render `history` rows as `title` (fallback `id.slice(0,8)`) + dim
  `summary`; Enter/click → `onResume(id, project)`, `onClose()`.
- `Esc`: if `mode !== 'root'` pop to `root`; else `onClose()`.
- Keep `↑/↓` selection and substring filtering per mode.
- Show a breadcrumb line (`Projects ›` / `History ›`) above the input when not at root.

Reference the existing static command handling (`onRun` / `onReset`) so RUN/SESSION commands
keep working exactly as before.

- [ ] **Step 4: Wire props in `HarnessApp`**

Where `<Palette ... />` is rendered, pass:

```tsx
<Palette
  onClose={() => dispatch({ type: 'TOGGLE_PALETTE' })}
  onRun={handleSuggest}
  onReset={() => dispatch({ type: 'CLEAR' })}
  projects={state.projects}
  history={state.history}
  onRequestProjects={() => send({ type: 'project_list' })}
  onRequestHistory={(projectId) => send({ type: 'session_list', projectId: projectId ?? state.activeProject })}
  onSwitchProject={(id, name) => { dispatch({ type: 'SET_ACTIVE_PROJECT', id, name }); send({ type: 'session_list', projectId: id }) }}
  onNewProject={(name) => send({ type: 'project_create', name })}
  onResume={(sessionId, project) => { send({ type: 'resume', sessionId }); const p = state.projects.find(x => x.id === project); dispatch({ type: 'SET_ACTIVE_PROJECT', id: project, name: p?.name ?? 'Inbox' }) }}
  onAssign={(projectId) => { if (state.sessionId && state.sessionId !== '…') send({ type: 'project_assign', sessionId: state.sessionId, projectId }) }}
/>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run components/Palette.test.tsx`
Expected: PASS.

> If `@testing-library/react` is not yet a dev dependency, install it first:
> `cd web && pnpm add -D @testing-library/react @testing-library/jest-dom jsdom` and ensure the
> web vitest config uses `environment: 'jsdom'`. Confirm with `grep -n jsdom web/vitest.config.*`.

- [ ] **Step 6: Commit**

```bash
git add web/components/Palette.tsx web/components/HarnessApp.tsx web/components/Palette.test.tsx
git commit -m "feat(web): mode-based palette for projects + history"
```

---

### Task 5: Active-project breadcrumb in `TopBar`

**Files:**
- Modify: `web/components/TopBar.tsx`
- Modify: `web/components/HarnessApp.tsx`
- Test: `web/components/TopBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/TopBar.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopBar } from './TopBar'

describe('TopBar project breadcrumb', () => {
  it('renders the active project name', () => {
    render(<TopBar profileName="coding" sessionId="abcd1234" busy={false} onPalette={() => {}} projectName="Alpha" />)
    expect(screen.getByText(/Alpha/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/TopBar.test.tsx`
Expected: FAIL — `projectName` prop does not exist.

- [ ] **Step 3: Add the prop + segment**

In `web/components/TopBar.tsx`, add `projectName: string` to `Props` and render a segment
between profile and session:

```tsx
        <span style={{ color: 'var(--dim)', margin: '0 0.5rem' }}>│</span>
        <span>project {projectName}</span>
```

- [ ] **Step 4: Pass it from `HarnessApp`**

Update the `<TopBar ... />` render to add `projectName={state.activeProjectName}`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run components/TopBar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/TopBar.tsx web/components/HarnessApp.tsx web/components/TopBar.test.tsx
git commit -m "feat(web): active project breadcrumb in TopBar"
```

---

### Task 6: TUI palette parity + breadcrumb

**Files:**
- Modify: `src/tui/components/Palette.tsx`
- Modify: the TUI breadcrumb/header component (find with `grep -rln "profile\|session" src/tui/components/TopBar.tsx src/tui/components/StatusBar.tsx`)
- Modify: `src/tui/app.tsx` (wire WS sends + state)
- Test: `tests/tui-palette-modes.test.ts`

> The TUI uses Ink; component rendering tests are heavier. Test the **pure mode-reducer** that
> drives the palette rather than Ink rendering, mirroring how the TUI hooks are structured.

- [ ] **Step 1: Extract a pure palette mode helper + test**

Create `src/tui/palette-modes.ts` with a pure function describing root commands and mode
transitions so it is testable without Ink:

```ts
// src/tui/palette-modes.ts
export type PaletteMode = 'root' | 'project_switch' | 'project_new' | 'history' | 'history_all' | 'assign'

export interface RootCommand { id: string; label: string; group: string; mode?: PaletteMode }

export const ROOT_COMMANDS: RootCommand[] = [
  { id: 'switch', label: 'Switch project…', group: 'PROJECT', mode: 'project_switch' },
  { id: 'new', label: 'New project…', group: 'PROJECT', mode: 'project_new' },
  { id: 'assign', label: 'Move session to project…', group: 'PROJECT', mode: 'assign' },
  { id: 'history', label: 'Browse history…', group: 'HISTORY', mode: 'history' },
  { id: 'history_all', label: 'Browse all history…', group: 'HISTORY', mode: 'history_all' },
]

// Esc behavior: pop to root, or signal close from root.
export function popMode(mode: PaletteMode): { mode: PaletteMode; close: boolean } {
  return mode === 'root' ? { mode: 'root', close: true } : { mode: 'root', close: false }
}
```

```ts
// tests/tui-palette-modes.test.ts
import { describe, it, expect } from 'vitest'
import { ROOT_COMMANDS, popMode } from '../src/tui/palette-modes.js'

describe('tui palette modes', () => {
  it('exposes PROJECT and HISTORY commands', () => {
    expect(ROOT_COMMANDS.some(c => c.group === 'PROJECT' && c.mode === 'project_switch')).toBe(true)
    expect(ROOT_COMMANDS.some(c => c.group === 'HISTORY' && c.mode === 'history')).toBe(true)
  })
  it('Esc from a submode returns to root without closing', () => {
    expect(popMode('history')).toEqual({ mode: 'root', close: false })
  })
  it('Esc from root closes', () => {
    expect(popMode('root')).toEqual({ mode: 'root', close: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails then passes**

Run: `npx vitest run tests/tui-palette-modes.test.ts`
Expected: FAIL first (module missing), PASS after creating `palette-modes.ts`.

- [ ] **Step 3: Wire the modes into the Ink `Palette`**

In `src/tui/components/Palette.tsx`, import `ROOT_COMMANDS` / `popMode` and add a `mode`
state. Render `ROOT_COMMANDS` alongside existing commands at root; on selecting a command with
a `mode`, switch to it and call the corresponding WS send passed in via props
(`onRequestProjects` / `onRequestHistory`). Render `projects` / `history` arrays (passed as
props from `app.tsx`) in the respective submodes. Mirror the web key handling: Enter activates,
Esc uses `popMode`.

- [ ] **Step 4: Wire state + sends in `app.tsx`**

In `src/tui/app.tsx`, add `projects` / `history` / `activeProject` / `activeProjectName` to the
TUI state (mirroring the web reducer), handle the `projects` / `project_created` / `sessions`
server messages, and pass the send callbacks + data into `<Palette />`. Add the
assign-on-`session_ready` effect equivalent to web Task 3.

- [ ] **Step 5: Add the breadcrumb segment**

In the TUI header/breadcrumb component, render the active project name next to profile/session.

- [ ] **Step 6: Run suite + typecheck + manual TUI smoke**

Run: `pnpm test && pnpm typecheck`
Then: `pnpm dev:tui` against a Plan-1 server; open the palette (`Ctrl+K`), create + switch a
project, browse history, resume a session. Confirm the breadcrumb updates.

- [ ] **Step 7: Commit**

```bash
git add src/tui/palette-modes.ts src/tui/components/Palette.tsx src/tui/app.tsx tests/tui-palette-modes.test.ts
git commit -m "feat(tui): palette parity for projects + history"
```

---

## Plan 2 self-review notes

- **Spec coverage:** mode-based palette (web T4, TUI T6), six modes (T4/T6), state additions (T2), active-project↔new-session reconciliation via `project_assign` on `session_ready` (T3, T6), breadcrumb (web T5, TUI T6), resume syncs active project (T4 `onResume`), TUI parity (T6). All UI-spec sections map to a task.
- **No new protocol:** every `send` uses a message type defined in Plan 1 (`project_create`, `project_list`, `project_assign`, `session_list`, `resume`). Confirmed against the UI spec's "no new WS message types" non-goal.
- **Type consistency:** `Project` / `SessionSummary` defined once in web T1, reused by reducer (T2) and Palette props (T4). Palette prop names (`onSwitchProject`, `onResume`, `onAssign`, `onRequestProjects`, `onRequestHistory`, `onNewProject`) are identical between the test (T4 Step 1), the component (T4 Step 3), and the wiring (T4 Step 4).
- **Dependency note:** Task 4 may require adding `@testing-library/react` + `jsdom` to the web dev deps if not already present (called out inline in T4 Step 5).
