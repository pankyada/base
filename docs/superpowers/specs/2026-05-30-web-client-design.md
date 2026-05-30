# Web Client (Next.js) — Design Spec

> Roadmap item #8
> Date: 2026-05-30
> Design source: harness-ui bundle (harness.html + supporting files)

---

## Overview

A Next.js (App Router) web client for the harness that faithfully implements the harness design prototype. It connects to the harness WS server for streaming chat, uses the REST API for session history, and renders the full GenUI widget surface inside a split pane layout.

The design language is identical to the TUI uplift (#7) but implemented in the browser with CSS: JetBrains Mono, amber-on-near-black, CSS-drawn TUI pane borders, animated bar/line charts, the command palette, theme/palette/font/density tweaks, and GenUI workspace widgets.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 + CSS custom properties (token system from `harness.css`) |
| Fonts | JetBrains Mono, IBM Plex Mono, Spline Sans Mono via `next/font/google` |
| State | React `useState` / `useReducer` — no external state lib |
| WS | Native browser `WebSocket` wrapped in a custom hook |
| Charts | SVG-based (inline, no chart library) — matches design exactly |
| Tests | Vitest + React Testing Library |

No UI component library (shadcn, MUI, etc.) — the design is bespoke and hand-crafted.

---

## Repository location

New directory at the repo root: `web/`

```
web/
  app/
    layout.tsx        — html/body, font vars, theme attrs
    page.tsx          — root: mounts <HarnessApp>
  components/
    HarnessApp.tsx    — root state + WS + layout
    TopBar.tsx
    StatusBar.tsx
    Palette.tsx
    ConvColumn.tsx
    Hero.tsx
    Message.tsx
    AgentTurn.tsx
    Thinking.tsx
    Spinner.tsx
    ToolCall.tsx
    Composer.tsx
    Workspace.tsx
    TabBar.tsx
    Tweaks.tsx        — slide-in tweaks panel
    ApprovalModal.tsx — tool_prompt approval UI
  widgets/
    GenWidget.tsx
    Metrics.tsx
    BarChart.tsx
    LineChart.tsx
    DataTable.tsx
    FileTree.tsx
    Diff.tsx
    TermOut.tsx
    Doc.tsx
    Research.tsx
  hooks/
    useHarnessWS.ts   — WS connection + message dispatch
    useClock.ts
  lib/
    types.ts          — shared WS + artifact types (copied/imported from src/types.ts)
    theme.ts          — CSS custom property names
  styles/
    globals.css       — harness.css + components.css + genui.css (ported to Tailwind/CSS vars)
  public/
    favicon.ico
  package.json
  next.config.ts
  tsconfig.json
  tailwind.config.ts
```

---

## Design Token System

CSS custom properties matching `harness.css` exactly. Applied to `<html data-theme="dark" data-palette="amber" data-density="regular">`.

### Dark / Amber (default)
```css
--bg: #0b0c0e;  --panel: #111317;  --border: #262b33;
--text: #e7e9ee; --dim: #99a0ad;   --faint: #595f6b;
--accent: #f1a44d; --ok: #74c79a;  --del: #e87f8d; --info: #6cb6d9;
--glow: rgba(241,164,77,.16);
```

### Palettes
Three accent palettes selectable: `amber` (default), `flux` (cyan/green), `ember` (red/magenta).

### Light / Paper
Full light mode with same token names; toggled via `data-theme="light"`.

---

## Layout

Exact port of the design prototype:

```
┌── TopBar ──────────────────────────────────────────────┐
│ ◆ harness │ model │ session │ ● status │    clock  ⌘K │
├────────────────────────────────────────────────────────┤
│  STAGE                                                  │
│                                                         │
│  .stage.idle    → centred conv column (max 760px)       │
│  .stage.split   → conv 42% │ workspace flex-1           │
│                                                         │
├────────────────────────────────────────────────────────┤
│  StatusBar                                              │
└────────────────────────────────────────────────────────┘
```

CSS class names and structure match the prototype (`.app`, `.stage`, `.col-conv`, `.col-work`, `.pane`, `.pane-title`, `.pane-body`, `.pane-foot`) so the existing CSS can be ported almost verbatim.

---

## Components

### HarnessApp

Root component. Manages all state via `useReducer`:

```typescript
type Action =
  | { type: 'user_message'; text: string }
  | { type: 'agent_token'; id: string; content: string }
  | { type: 'agent_tool_start'; id: string; name: string; input: unknown }
  | { type: 'agent_tool_end'; id: string; name: string; result: string }
  | { type: 'agent_thinking_step'; id: string; step: string }
  | { type: 'agent_response_done'; id: string; text: string }
  | { type: 'artifacts'; id: string; label: string; icon: string; items: Artifact[] }
  | { type: 'tool_prompt'; id: string; name: string; input: unknown }
  | { type: 'stats'; tokens_in: number; tokens_out: number; cost_usd: number }
  | { type: 'reset' }
  | { type: 'close_tab'; idx: number }
  | { type: 'set_active_tab'; idx: number }
  | { type: 'set_focus'; pane: 'conv' | 'work' }
  | { type: 'toggle_palette' }
  | { type: 'approve_tool'; id: string; approved: boolean }
```

Connects to WS via `useHarnessWS` and dispatches actions on each message type.

### TopBar

Identical to design. Segments:
- `◆ harness` — accent, bold
- `model {profileName}` — from `hello` response or config
- `session #{shortId}` — first 4 chars of session ID
- Live dot `●` — CSS `@keyframes pulse` opacity, colour switches on `busy`
- `ready` / `working`
- Clock
- `⌘ palette` pill → opens Palette

### Hero

Idle state (no messages). ASCII art header + 4 suggestion cards in 2-column grid. Each card: tag (accent, uppercase), description, `↵ run task` arrow. `hover` lifts the card 1px, border goes accent. Click fires scenario.

### AgentTurn

Shows thinking block + tool cards + response text + artifact note.

**Thinking block**: dashed border box; steps reveal one-by-one with `Spinner` on active step. Steps that are done show `✓`.

**ToolCall card**: Collapsible. Header: `type  arg  ✓ summary  ▸`. Click to expand output body. Running state: `Spinner running` in accent.

### Composer

`›` prompt prefix + `<textarea>` + `run ↵` button. Full border on focus → accent + glow. `Enter` submits; `Shift+Enter` inserts newline. Hint row below (hidden in split/compact mode). `disabled` + placeholder change when busy.

### Workspace

Tab bar + scrollable artifact body + footer bar. Tab `active` state: accent colour + 2px accent bottom border. Close `✕` per tab. Footer: `● N surfaces │ [1–9] switch │ [⇥] focus pane`.

### ApprovalModal

Shown when `tool_prompt` WS event arrives. Centred overlay. Shows tool name + input preview. `Allow` button (ok-green border) and `Deny` button (del-red border). Resolves the pending approval and sends `tool_approve` / `tool_deny` back over WS.

### Tweaks panel

Slide-in panel from the right (CSS `transform: translateX`). Controls:
- **Theme**: dark / light radio
- **Palette**: 3 colour swatches (amber `#f1a44d`, flux `#58e0a6`, ember `#f06d6d`)
- **Font**: dropdown (JetBrains Mono / IBM Plex Mono / Spline Sans Mono)
- **Density**: compact / regular / cozy radio
- **Agent speed**: fast / normal / slow (controls demo playback speed)
- **Status bar**: toggle

All changes applied immediately to `<html>` attributes + CSS vars.

---

## GenUI Widgets

Port of the React prototype widgets, but using proper Next.js/React conventions (no `window.*` globals, proper TypeScript types).

### Metrics
Grid of metric cards. Each: label (small uppercase), large value, delta with `▲`/`▼` indicator (ok-green / del-red).

### BarChart
Horizontal bars. CSS `transition: width .7s cubic-bezier(.2,.8,.2,1)` with `staggered` delay per row (70 ms × index). Glow shadow on filled bars via `box-shadow: 0 0 12px -2px var(--glow)`.

### LineChart
SVG polyline + area fill with `strokeDashoffset` animation (draw-in effect). Dashed horizontal grid lines. Flag labels above anomaly points. Axis labels below.

### DataTable
`<table>` with sticky header row. Sortable columns: click header toggles `asc`/`desc`; sort arrow in accent. Badge cells: `ok` (green border), `warn` (accent border), `bad` (red border). Sparkline column uses block chars.

### FileTree
`▾` for directories (info-blue), `├─` / `└─` for files. Change badges right-aligned (`+18 −6` in add/del colours). Selected row: accent filename. Clickable rows.

### Diff
Unified diff with line number columns. Add lines: green background tint (`color-mix(in oklab, var(--add) 12%, transparent)`). Del lines: red tint. Hunk headers: info-blue. Header bar: filename + `+N −N` stat.

### TermOut
Dark background (`var(--bg-deep)`) box. Prompt in ok-green. Commands in accent. Output in dim. Errors in del-red.

### Doc
Bordered doc frame with toolbar. Title in large (19px) text. `h2` in accent uppercase. Paragraphs with `line-height: 1.65`. Edit highlights in amber tint (`color-mix`). Strikethrough in del-red; insertions in add-green.

### Research
Numbered source rows with title, URL (info-blue), snippet with `<mark>` highlights. Favicon placeholder box. Synthesis block with accent border + `◆ synthesis` header. Citation superscripts in accent.

---

## WS Hook — `useHarnessWS`

```typescript
interface UseHarnessWSOptions {
  url: string           // ws://localhost:7337
  onMessage: (msg: ServerMessage) => void
  onConnect?: () => void
  onDisconnect?: () => void
}

function useHarnessWS(opts: UseHarnessWSOptions): {
  send: (msg: ClientMessage) => void
  status: 'connecting' | 'open' | 'closed' | 'error'
  reconnect: () => void
}
```

- Auto-reconnect: exponential backoff (1 s, 2 s, 4 s, max 30 s)
- Connection status shown as `●` colour in TopBar and banner when disconnected
- Sends `hello` with `user_id` from config on connect
- Handles `tool_prompt` → dispatches to approval modal state

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus composer |
| `⌘K` / `Ctrl+K` | Open command palette |
| `⌘L` / `Ctrl+L` | Clear session |
| `Tab` | Toggle focus pane (conv ↔ work) |
| `1`–`9` | Switch workspace tab |
| `Esc` | Close palette |

---

## Configuration

`web/.env.local` (gitignored):

```env
NEXT_PUBLIC_HARNESS_WS_URL=ws://localhost:7337
NEXT_PUBLIC_HARNESS_API_KEY=          # optional; if set, sent as Authorization header on REST calls
NEXT_PUBLIC_DEFAULT_USER=anonymous
```

---

## Connection Status UI

When WS is disconnected, a banner appears below the TopBar:

```
⚠ disconnected from harness · reconnecting in 4s…   [reconnect now]
```

Banner colour: del-red border, amber text. Disappears on reconnect.

---

## Non-goals (this iteration)

- Server-side rendering of conversation history (client-only SPA)
- Authentication / login UI (user identity is set via env var)
- Mobile-native gestures (responsive layout only)
- Exporting transcripts to file
