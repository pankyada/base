# TUI Uplift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Ink TUI to match the harness design — amber/dark aesthetic, split pane layout, braille spinners, command palette, status bar, and GenUI workspace widgets.

**Architecture:** All changes are in `src/tui/`. New component tree replaces the existing monolithic `App.tsx`. The WS client wire-up and message protocol are unchanged; only the rendering layer changes. New `widgets/` directory hosts the GenUI text-art components.

**Tech Stack:** Ink v4, React, TypeScript. No new npm dependencies beyond what Ink already provides. `chalk` for colours (already in tree).

**Spec:** `docs/superpowers/specs/2026-05-30-tui-uplift-design.md`

---

## Prerequisites

- Ink TUI exists at `src/tui/` with a working WS connection to the harness server
- `pnpm dev:tui` starts the TUI
- Existing `App.tsx` renders messages, tools, and composer

---

## File Map

| Action | Path | What changes |
|--------|------|--------------|
| Add | `src/tui/theme.ts` | Colour constants (amber palette) |
| Add | `src/tui/layout.ts` | Column width helpers using terminal size |
| Add | `src/tui/hooks/useClock.ts` | HH:MM:SS ticker |
| Add | `src/tui/hooks/useSpinner.ts` | Braille frame cycler |
| Add | `src/tui/hooks/useTermSize.ts` | Terminal width/height via `process.stdout` |
| Rewrite | `src/tui/App.tsx` | Root: state, keybinds, layout switch, WS events |
| Add | `src/tui/components/TopBar.tsx` | Brand + segments + clock + palette pill |
| Add | `src/tui/components/StatusBar.tsx` | RDY/RUN + pane + ctx + keyhints |
| Add | `src/tui/components/Palette.tsx` | Command palette overlay |
| Add | `src/tui/components/ConvColumn.tsx` | Scroll area + pane border |
| Add | `src/tui/components/Hero.tsx` | Idle ASCII art + suggestion chips |
| Add | `src/tui/components/Message.tsx` | User / agent message row |
| Add | `src/tui/components/AgentTurn.tsx` | Thinking + tools + response |
| Add | `src/tui/components/Thinking.tsx` | Dashed-border thinking block |
| Add | `src/tui/components/Spinner.tsx` | Braille spinner |
| Add | `src/tui/components/ToolCall.tsx` | Collapsible tool card |
| Add | `src/tui/components/Composer.tsx` | `›` input + hint row |
| Add | `src/tui/components/Workspace.tsx` | Workspace pane wrapper |
| Add | `src/tui/components/TabBar.tsx` | Tab strip |
| Add | `src/tui/widgets/GenWidget.tsx` | Dispatcher |
| Add | `src/tui/widgets/Metrics.tsx` | Metric cards |
| Add | `src/tui/widgets/BarChart.tsx` | Animated bar chart |
| Add | `src/tui/widgets/LineChart.tsx` | Sparkline via block chars |
| Add | `src/tui/widgets/DataTable.tsx` | Sortable table |
| Add | `src/tui/widgets/FileTree.tsx` | Tree with box-drawing glyphs |
| Add | `src/tui/widgets/Diff.tsx` | Unified diff view |
| Add | `src/tui/widgets/TermOut.tsx` | Terminal output block |
| Add | `src/tui/widgets/Doc.tsx` | Doc draft viewer |
| Add | `src/tui/widgets/Research.tsx` | Sources + synthesis |

---

## Task 1 — Foundation: theme, hooks, layout

**Files:** `src/tui/theme.ts`, `src/tui/layout.ts`, `src/tui/hooks/`

- [ ] **Step 1.1 — `theme.ts`**

```typescript
// src/tui/theme.ts
export const C = {
  bg:         '#0b0c0e',
  bgDeep:     '#08090a',
  panel:      '#111317',
  border:     '#262b33',
  borderHi:   '#3a414e',
  text:       '#e7e9ee',
  dim:        '#99a0ad',
  faint:      '#595f6b',
  accent:     '#f1a44d',
  accentDim:  '#a9712f',
  ok:         '#74c79a',
  add:        '#74c79a',
  del:        '#e87f8d',
  info:       '#6cb6d9',
  purple:     '#b394e0',
}
```

- [ ] **Step 1.2 — `hooks/useClock.ts`**

```typescript
import { useState, useEffect } from 'react'
export function useClock() {
  const fmt = () => new Date().toLocaleTimeString('en-US', { hour12: false })
  const [t, setT] = useState(fmt)
  useEffect(() => { const id = setInterval(() => setT(fmt()), 1000); return () => clearInterval(id) }, [])
  return t
}
```

- [ ] **Step 1.3 — `hooks/useSpinner.ts`**

```typescript
import { useState, useEffect } from 'react'
const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
export function useSpinner() {
  const [f, setF] = useState(0)
  useEffect(() => { const id = setInterval(() => setF(x => (x + 1) % FRAMES.length), 80); return () => clearInterval(id) }, [])
  return FRAMES[f]
}
```

- [ ] **Step 1.4 — `hooks/useTermSize.ts`**

```typescript
import { useState, useEffect } from 'react'
export function useTermSize() {
  const get = () => ({ cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 })
  const [size, setSize] = useState(get)
  useEffect(() => {
    const h = () => setSize(get())
    process.stdout.on('resize', h)
    return () => { process.stdout.off('resize', h) }
  }, [])
  return size
}
```

- [ ] **Step 1.5 — `layout.ts`**

```typescript
export function convWidth(totalCols: number, split: boolean) {
  return split ? Math.floor(totalCols * 0.42) : Math.min(totalCols, 80)
}
export function workWidth(totalCols: number, convW: number) {
  return totalCols - convW - 2 // 2 for gap
}
```

---

## Task 2 — Atom components: Spinner, TopBar, StatusBar

- [ ] **Step 2.1 — `Spinner.tsx`**

```tsx
import { Text } from 'ink'
import { C } from '../theme.js'
import { useSpinner } from '../hooks/useSpinner.js'
export function Spinner() {
  return <Text color={C.accent}>{useSpinner()}</Text>
}
```

- [ ] **Step 2.2 — `TopBar.tsx`**

Renders a single `<Box>` full-width row. Segments separated by `│` in dim colour.

Fields:
- `◆ harness` in accent bold
- `model harness-core` — read from `profile.name` prop
- `session #xxxx` — first 4 hex of session ID
- Live dot: `●` animating opacity (ok-green idle, accent busy)
- `ready` / `working` label
- Spacer
- Clock from `useClock()`
- `⌘K palette` pill

Props: `{ profileName: string, sessionId: string, busy: boolean, onPalette: () => void }`

- [ ] **Step 2.3 — `StatusBar.tsx`**

Single bottom row. Left: `RDY`/`RUN` block (accent bg). Segments: pane, surface, ctx. Right: keyhints.

Props: `{ busy: boolean, focusPane: 'conv'|'work', surface?: string, surfaceIdx?: number, surfaceTotal?: number, tokens: number, theme: string, onToggleTheme: () => void }`

---

## Task 3 — Thinking, ToolCall

- [ ] **Step 3.1 — `Thinking.tsx`**

Dashed-border box. Each step: `✓` (done), `<Spinner/>` (active), `·` (pending). Active step is full brightness; others dimmed.

Props: `{ steps: string[], active: number, done: boolean }`

- [ ] **Step 3.2 — `ToolCall.tsx`**

Single line when collapsed: `type  arg (truncated)  ✓ summary  ▸`
Expanded: adds an indented body line with full `out`.

Props: `{ tool: { type: string, arg: string, out: string, done: boolean }, running: boolean }`

State: `open: boolean` toggled by Enter when row focused.

---

## Task 4 — Hero, Composer, Message

- [ ] **Step 4.1 — `Hero.tsx`**

ASCII art header + 4 suggestion chips in a 2×2 grid. Arrow keys change selection; Enter fires `onSelect(id)`.

```
  ┌─┐  agent control surface
  │◆│  data · code · writing · research
  └─┘

◆ harness
A harness for an agent that does the work in the open.

  ▟  DATA ANALYSIS    Analyze Q2 revenue…    ↵ run task
  ❮❯ CODING           Fix the race cond…     ↵ run task
  ✎  WRITING          Draft a launch ann…    ↵ run task
  ◎  RESEARCH         Map on-device LLM…     ↵ run task
```

Props: `{ onSelect: (id: string) => void }`

- [ ] **Step 4.2 — `Composer.tsx`**

`›` prompt + `<TextInput>` from `ink`. Enter submits; Shift+Enter inserts `\n`. Hint row below (hidden in compact mode).

Props: `{ value: string, onChange: (v: string) => void, onSubmit: () => void, busy: boolean, compact: boolean }`

- [ ] **Step 4.3 — `Message.tsx`**

User message: `YOU › HH:MM:SS` header + left-border bar in info-blue.
Agent message: `HARNESS ◆ HH:MM:SS` header — delegates body to `AgentTurn`.

- [ ] **Step 4.4 — `AgentTurn.tsx`**

Composes `<Thinking>` + `<ToolCall>` list + response text + artifact note.

---

## Task 5 — Pane borders, ConvColumn, Workspace, TabBar

- [ ] **Step 5.1 — `Pane.tsx`** (shared wrapper)

Draws a box with `┌─┐│└─┘` border. Title inset at top-left: `┤ ● title N ├`. Corner ticks. Focused = accent border colour.

```tsx
<Box borderStyle="single" borderColor={focused ? C.accent : C.border} flexDirection="column">
  {/* title absolutely positioned via marginTop=-1 trick */}
  <Box marginTop={-1} marginLeft={2}>
    <Text color={C.borderHi}>┤</Text>
    <Text color={focused ? C.accent : C.dim}> ● {title} </Text>
    <Text color={C.faint}>{num}</Text>
    <Text color={C.borderHi}>├</Text>
  </Box>
  {children}
</Box>
```

- [ ] **Step 5.2 — `ConvColumn.tsx`**

Wraps in `<Pane>` when split. Contains scroll area (`<Static>` for history + live tail), `<Composer>`.

- [ ] **Step 5.3 — `TabBar.tsx`**

Horizontal row of tabs. Active tab: accent colour + underline. Each tab: `num label ✕`.

Props: `{ tabs: Tab[], active: number, onSelect: (i: number) => void, onClose: (i: number) => void }`

- [ ] **Step 5.4 — `Workspace.tsx`**

`<Pane>` wrapping `<TabBar>` + scrollable artifact area + footer with surface count + keyhints.

---

## Task 6 — GenUI widgets

Each widget gets a `Cap` header: `ICON TITLE · META` in dim uppercase, underlined.

- [ ] **Step 6.1 — `Metrics.tsx`** — grid of bordered metric cards (box chars)
- [ ] **Step 6.2 — `BarChart.tsx`** — `█` fill bars with animated width; `▒` track background; right-aligned values
- [ ] **Step 6.3 — `LineChart.tsx`** — sparkline using `▁▂▃▄▅▆▇█`; flag labels above anomaly indices
- [ ] **Step 6.4 — `DataTable.tsx`** — header row (uppercase, faint) + body rows; `<` / `>` to sort; badge rendering for status column
- [ ] **Step 6.5 — `FileTree.tsx`** — `▾` for dirs, `├─` / `└─` for files; add/del counts right-aligned; selected row in accent
- [ ] **Step 6.6 — `Diff.tsx`** — `±` header + line numbers + gut char (`+`/`−`/` `); add lines in green bg, del lines in red bg
- [ ] **Step 6.7 — `TermOut.tsx`** — dark bg box; prompt in ok-green; output lines in dim; errors in del-red
- [ ] **Step 6.8 — `Doc.tsx`** — bordered doc with header bar; title in large text; h2s in accent uppercase; body text
- [ ] **Step 6.9 — `Research.tsx`** — numbered source rows; synthesis block with accent border
- [ ] **Step 6.10 — `GenWidget.tsx`** — switch dispatcher

---

## Task 7 — Command Palette

- [ ] **Step 7.1 — `Palette.tsx`**

Full-width overlay. Input line at top. Filtered list below. Arrow keys + Enter. Dim scrim via an Ink overlay `<Box>` covering full terminal.

Categories: `RUN TASK` (4 built-in scenarios) and `SESSION` (toggle theme, clear).

Props: `{ onClose: () => void, onRun: (sid: string) => void, onReset: () => void }`

---

## Task 8 — Root App.tsx rewrite

- [ ] **Step 8.1 — State + WS events**

```typescript
// Connect WS, dispatch to state:
ws.on('token')        → append to current agent message
ws.on('tool_start')   → push tool card (running=true)
ws.on('tool_end')     → mark tool done, update output
ws.on('stats')        → update token count
ws.on('session_end')  → set busy=false
ws.on('tool_prompt')  → open approval overlay
ws.on('artifacts')    → push tab to workspace, open split
```

- [ ] **Step 8.2 — Keybinds**

```typescript
useInput((input, key) => {
  if (key.ctrl && input === 'k') { setPaletteOpen(o => !o); return }
  if (key.ctrl && input === 'l') { reset(); return }
  if (key.escape) { setPaletteOpen(false); return }
  if (input === '/') { setComposerFocus(true); return }
  if (key.tab && workspaceOpen) { toggleFocus(); return }
  if (/^[1-9]$/.test(input) && workspaceOpen) { setActiveTab(+input - 1); return }
})
```

- [ ] **Step 8.3 — Layout**

```tsx
<Box flexDirection="column" height={rows}>
  <TopBar ... />
  <Box flexGrow={1} flexDirection="row">
    <ConvColumn width={convW} ... />
    {workspaceOpen && <Workspace width={workW} ... />}
  </Box>
  <StatusBar ... />
  {paletteOpen && <Palette ... />}
</Box>
```

---

## Task 9 — WS protocol: `artifacts` event

- [ ] **Step 9.1 — Add `artifacts` to `ServerMessage` in `src/types.ts`**

```typescript
| { type: 'artifacts'; sessionId: string; artifacts: ArtifactWidget[] }
```

`ArtifactWidget` is the same shape as `window.HARNESS_SCENARIOS[x].artifacts[y]` in the design (kind + data fields). Export `ArtifactWidget` type from a new `src/types/widgets.ts`.

- [ ] **Step 9.2 — Emit from agent loop**

In `src/loop/agent-loop.ts`, after the final response, if `events.onArtifacts` exists, call it with parsed artifacts from the response. Artifact detection: look for `__ARTIFACTS__` marker in final text, or structured output matching the contract schema.

---

## Task 10 — Smoke test

- [ ] **Step 10.1** — `pnpm dev:tui` starts without errors on 80×24 terminal
- [ ] **Step 10.2** — Idle hero renders with 4 suggestion chips
- [ ] **Step 10.3** — Typing a message and pressing Enter shows thinking steps + spinner
- [ ] **Step 10.4** — Tool cards appear and collapse/expand on Enter
- [ ] **Step 10.5** — `⌘K` opens palette; arrow keys navigate; Enter runs a scenario
- [ ] **Step 10.6** — Workspace opens when artifacts arrive; `Tab` switches focus; `1–4` switches tabs
- [ ] **Step 10.7** — Status bar shows correct pane, ctx count, and mode
- [ ] **Step 10.8** — Terminal resize reflows layout correctly
- [ ] **Step 10.9** — `⌘L` clears session and returns to hero
- [ ] **Step 10.10** — `q` quits cleanly
