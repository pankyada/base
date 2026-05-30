# Web Client (Next.js) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js web client that implements the harness design prototype — full split-pane TUI aesthetic in the browser, real WS connection to the harness server, GenUI workspace widgets, theme/palette/density tweaks, command palette, and tool approval modal.

**Architecture:** `web/` directory at repo root. Next.js 15 App Router (client components throughout — no SSR needed). WS connection managed in a custom hook. CSS token system ported verbatim from `harness.css`. All widgets are pure React, no chart library.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS v4, JetBrains Mono via `next/font/google`. No UI component library.

**Spec:** `docs/superpowers/specs/2026-05-30-web-client-design.md`
**Design files:** `harness-ui/project/` (harness.html, harness.css, components.css, genui.css, app.jsx, shell.jsx, conversation.jsx, genui.jsx, scenarios.js)

---

## Prerequisites

- Node.js ≥ 20, pnpm
- Harness server runs at `ws://localhost:7337` (for manual testing)
- `src/types.ts` exports `ClientMessage` and `ServerMessage` (WS protocol types)

---

## File Map

| Action | Path | What |
|--------|------|------|
| Create | `web/package.json` | Next.js 15 + Tailwind deps |
| Create | `web/next.config.ts` | Basic config |
| Create | `web/tsconfig.json` | Strict TS |
| Create | `web/tailwind.config.ts` | Content paths |
| Create | `web/styles/globals.css` | Full token system (ported from design CSS) |
| Create | `web/app/layout.tsx` | `<html>` with font vars + default theme attrs |
| Create | `web/app/page.tsx` | Mounts `<HarnessApp>` |
| Create | `web/lib/types.ts` | WS types + Artifact types |
| Create | `web/hooks/useHarnessWS.ts` | WS hook with auto-reconnect |
| Create | `web/hooks/useClock.ts` | HH:MM:SS ticker |
| Create | `web/components/HarnessApp.tsx` | Root: reducer + WS dispatch + layout |
| Create | `web/components/TopBar.tsx` | Brand + segments + clock + palette pill |
| Create | `web/components/StatusBar.tsx` | Mode + pane + ctx + keyhints |
| Create | `web/components/Palette.tsx` | Command palette overlay |
| Create | `web/components/ConvColumn.tsx` | Scroll area + pane border |
| Create | `web/components/Hero.tsx` | Idle state: ASCII + chips |
| Create | `web/components/Message.tsx` | User message row |
| Create | `web/components/AgentTurn.tsx` | Thinking + tools + response |
| Create | `web/components/Thinking.tsx` | Dashed thinking block |
| Create | `web/components/Spinner.tsx` | Braille spinner |
| Create | `web/components/ToolCall.tsx` | Collapsible tool card |
| Create | `web/components/Composer.tsx` | Input area |
| Create | `web/components/Workspace.tsx` | Workspace pane + tab bar + artifacts |
| Create | `web/components/Tweaks.tsx` | Slide-in tweaks panel |
| Create | `web/components/ApprovalModal.tsx` | Tool approval overlay |
| Create | `web/widgets/GenWidget.tsx` | Dispatcher |
| Create | `web/widgets/Metrics.tsx` | Metric cards |
| Create | `web/widgets/BarChart.tsx` | Animated bar chart |
| Create | `web/widgets/LineChart.tsx` | SVG line/area chart |
| Create | `web/widgets/DataTable.tsx` | Sortable table |
| Create | `web/widgets/FileTree.tsx` | File tree |
| Create | `web/widgets/Diff.tsx` | Unified diff |
| Create | `web/widgets/TermOut.tsx` | Terminal output |
| Create | `web/widgets/Doc.tsx` | Doc draft |
| Create | `web/widgets/Research.tsx` | Sources + synthesis |

---

## Task 1 — Project scaffold

- [ ] **Step 1.1 — `web/package.json`**

```json
{
  "name": "harness-web",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "typescript": "^5",
    "tailwindcss": "^4",
    "@tailwindcss/postcss": "^4",
    "vitest": "^2",
    "@testing-library/react": "^16",
    "@vitejs/plugin-react": "^4"
  }
}
```

- [ ] **Step 1.2 — `web/next.config.ts`**

```typescript
import type { NextConfig } from 'next'
const config: NextConfig = {}
export default config
```

- [ ] **Step 1.3 — `web/tsconfig.json`**

Standard Next.js strict tsconfig with `"moduleResolution": "bundler"`.

- [ ] **Step 1.4 — `web/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss'
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './widgets/**/*.{ts,tsx}'],
  theme: { extend: {} },
} satisfies Config
```

---

## Task 2 — CSS token system

- [ ] **Step 2.1 — `web/styles/globals.css`**

Port `harness.css` + `components.css` + `genui.css` verbatim. Keep all CSS custom properties and class names identical to the design. Add `@import 'tailwindcss'` at top.

Key sections to port:
- All `:root[data-theme][data-palette]` token blocks (dark/amber, dark/flux, dark/ember, light variants)
- `body`, `#root`, `.app` base styles
- `.topbar`, `.stage`, `.pane`, `.pane-title`, `.pane-body`, `.pane-foot`, `.statusbar`
- `.msg`, `.thinking`, `.tool`, `.composer`, `.suggests`, `.hero`
- All widget styles: `.metrics`, `.barchart`, `.linechart`, `.dtable`, `.ftree`, `.diff`, `.termout`, `.doc`, `.research`, `.synth`
- `.wtabs`, `.wtab`, `.palette-scrim`, `.palette`
- Keyframe animations: `pulse`, `rise`, `fade`, `blink`

- [ ] **Step 2.2 — `web/app/layout.tsx`**

```tsx
import { JetBrains_Mono, IBM_Plex_Mono, Spline_Sans_Mono } from 'next/font/google'
import '../styles/globals.css'

const jb = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jb', weight: ['400','500','700'] })
const ibm = IBM_Plex_Mono({ subsets: ['latin'], variable: '--font-ibm', weight: ['400','500','600'] })
const spline = Spline_Sans_Mono({ subsets: ['latin'], variable: '--font-spline', weight: ['400','500','600'] })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" data-palette="amber" data-density="regular"
          className={`${jb.variable} ${ibm.variable} ${spline.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

---

## Task 3 — Types

- [ ] **Step 3.1 — `web/lib/types.ts`**

Copy/adapt `src/types.ts` WS message types. Add:

```typescript
export type ArtifactKind = 'metrics' | 'bar' | 'line' | 'table' | 'filetree' | 'diff' | 'terminal' | 'doc' | 'research'

export interface Artifact {
  id: string
  kind: ArtifactKind
  title: string
  icon: string
  meta?: string
  // kind-specific data fields (loose union — each widget validates what it needs)
  data?: unknown
  [key: string]: unknown
}

export interface WorkspaceTab {
  id: string
  label: string
  icon: string
  artifacts: Artifact[]
}
```

---

## Task 4 — WS hook

- [ ] **Step 4.1 — `web/hooks/useHarnessWS.ts`**

```typescript
'use client'
import { useRef, useState, useEffect, useCallback } from 'react'
import type { ClientMessage, ServerMessage } from '../lib/types.js'

export function useHarnessWS(url: string, onMessage: (m: ServerMessage) => void) {
  const ws = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<'connecting'|'open'|'closed'|'error'>('connecting')
  const backoff = useRef(1000)

  const connect = useCallback(() => {
    setStatus('connecting')
    const sock = new WebSocket(url)
    ws.current = sock
    sock.onopen = () => { setStatus('open'); backoff.current = 1000 }
    sock.onmessage = e => { try { onMessage(JSON.parse(e.data)) } catch {} }
    sock.onclose = () => {
      setStatus('closed')
      setTimeout(connect, backoff.current)
      backoff.current = Math.min(backoff.current * 2, 30000)
    }
    sock.onerror = () => setStatus('error')
  }, [url, onMessage])

  useEffect(() => { connect(); return () => ws.current?.close() }, [connect])

  const send = useCallback((msg: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg))
  }, [])

  return { send, status, reconnect: connect }
}
```

- [ ] **Step 4.2 — `web/hooks/useClock.ts`**

```typescript
'use client'
import { useState, useEffect } from 'react'
export function useClock() {
  const fmt = () => new Date().toLocaleTimeString('en-US', { hour12: false })
  const [t, setT] = useState(fmt)
  useEffect(() => { const id = setInterval(() => setT(fmt()), 1000); return () => clearInterval(id) }, [])
  return t
}
```

---

## Task 5 — Atom components: Spinner, TopBar, StatusBar

- [ ] **Step 5.1 — `web/components/Spinner.tsx`**

```tsx
'use client'
import { useState, useEffect } from 'react'
const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
export function Spinner() {
  const [f, setF] = useState(0)
  useEffect(() => { const id = setInterval(() => setF(x => (x + 1) % FRAMES.length), 80); return () => clearInterval(id) }, [])
  return <span className="spin">{FRAMES[f]}</span>
}
```

- [ ] **Step 5.2 — `web/components/TopBar.tsx`**

Port directly from `shell.jsx` `TopBar` function. Use `useClock()`. Props: `{ profileName, sessionId, busy, onPalette }`.

- [ ] **Step 5.3 — `web/components/StatusBar.tsx`**

Port from `shell.jsx` `StatusBar`. Props: `{ busy, focusPane, surface, surfaceIdx, surfaceTotal, tokens, theme, onToggleTheme }`.

---

## Task 6 — Conversation components

- [ ] **Step 6.1 — `web/components/Thinking.tsx`** — port from `conversation.jsx`
- [ ] **Step 6.2 — `web/components/ToolCall.tsx`** — port from `conversation.jsx`
- [ ] **Step 6.3 — `web/components/Message.tsx`** — port from `conversation.jsx`
- [ ] **Step 6.4 — `web/components/AgentTurn.tsx`** — port from `shell.jsx` `AgentTurn`
- [ ] **Step 6.5 — `web/components/Hero.tsx`** — port from `shell.jsx` `Hero`

Replace `window.HARNESS_SUGGESTS` with a typed constant in the component file.

- [ ] **Step 6.6 — `web/components/Composer.tsx`** — port from `shell.jsx` `Composer`

Use `<textarea>` (not `TextInput`). Handle `Enter` / `Shift+Enter` via `onKeyDown`.

---

## Task 7 — Workspace + palette + tweaks

- [ ] **Step 7.1 — `web/components/Workspace.tsx`** — port from `shell.jsx` `Workspace`

Replace `GenWidget` reference with import from `web/widgets/GenWidget.tsx`.

- [ ] **Step 7.2 — `web/components/Palette.tsx`** — port from `shell.jsx` `Palette`

Replace `window.HARNESS_SCENARIOS` references with local typed constants.

- [ ] **Step 7.3 — `web/components/Tweaks.tsx`** — port from `shell.jsx` `Tweaks` + `tweaks-panel.jsx`

Slide-in panel using CSS `transform: translateX(100%)` → `translateX(0)` transition. Applies changes to `document.documentElement` attributes.

- [ ] **Step 7.4 — `web/components/ApprovalModal.tsx`**

New component (not in prototype — this replaces the headless auto-deny in the REST path):

```tsx
interface Props {
  toolName: string
  toolInput: unknown
  onApprove: () => void
  onDeny: () => void
}
```

Centred modal overlay. Shows `tool_prompt` details. `Allow` (ok-green border) and `Deny` (del-red border) buttons. Keyboard: `y` / `n` or `Enter` / `Esc`.

---

## Task 8 — GenUI widgets

Port each from `genui.jsx`. Remove `window.*` globals, add TypeScript types.

- [ ] **Step 8.1 — `web/widgets/Metrics.tsx`** — metric cards grid
- [ ] **Step 8.2 — `web/widgets/BarChart.tsx`** — animated bar chart (CSS width transition)
- [ ] **Step 8.3 — `web/widgets/LineChart.tsx`** — SVG polyline with `strokeDashoffset` draw animation
- [ ] **Step 8.4 — `web/widgets/DataTable.tsx`** — sortable table with badges
- [ ] **Step 8.5 — `web/widgets/FileTree.tsx`** — clickable file tree
- [ ] **Step 8.6 — `web/widgets/Diff.tsx`** — unified diff with colour-mix backgrounds
- [ ] **Step 8.7 — `web/widgets/TermOut.tsx`** — terminal output box
- [ ] **Step 8.8 — `web/widgets/Doc.tsx`** — doc draft viewer
- [ ] **Step 8.9 — `web/widgets/Research.tsx`** — sources + synthesis
- [ ] **Step 8.10 — `web/widgets/GenWidget.tsx`** — kind → component dispatcher

---

## Task 9 — ConvColumn + root HarnessApp

- [ ] **Step 9.1 — `web/components/ConvColumn.tsx`**

Wraps `<Hero>` (no messages) or message scroll area + `<Composer>`. In split mode: wrapped in `.pane` with title. In idle mode: bare column.

- [ ] **Step 9.2 — `web/components/HarnessApp.tsx`**

This is the main orchestration component:

```typescript
'use client'
// State shape
interface State {
  messages: UIMessage[]
  tabs: WorkspaceTab[]
  activeTab: number
  input: string
  busy: boolean
  focusPane: 'conv' | 'work'
  paletteOpen: boolean
  tokens: { in: number; out: number }
  pendingApproval: { id: string; name: string; input: unknown } | null
  tweaksOpen: boolean
  theme: string
  palette: string
  font: string
  density: string
}
```

Reducer handles all actions. `useHarnessWS` dispatches server messages. Keyboard shortcuts via `useEffect` + `window.addEventListener('keydown', ...)`.

Layout:
```tsx
<div className="app">
  <TopBar ... />
  {wsStatus !== 'open' && <DisconnectedBanner status={wsStatus} onReconnect={reconnect} />}
  <div className={`stage ${workspaceOpen ? 'split' : 'idle'}`}>
    <div className="col-conv">
      <ConvColumn ... />
    </div>
    {workspaceOpen && (
      <div className="col-work">
        <Workspace ... />
      </div>
    )}
  </div>
  <StatusBar ... />
  {paletteOpen && <Palette ... />}
  {pendingApproval && <ApprovalModal ... />}
  <Tweaks open={tweaksOpen} ... />
</div>
```

- [ ] **Step 9.3 — `web/app/page.tsx`**

```tsx
import { HarnessApp } from '../components/HarnessApp.js'
export default function Page() { return <HarnessApp /> }
```

---

## Task 10 — `pnpm dev` script wiring

- [ ] **Step 10.1 — Root `package.json`** — add `"dev:web": "pnpm --filter harness-web dev"` to root scripts

- [ ] **Step 10.2 — `web/.env.local.example`**

```env
NEXT_PUBLIC_HARNESS_WS_URL=ws://localhost:7337
NEXT_PUBLIC_DEFAULT_USER=anonymous
```

---

## Task 11 — Smoke tests

- [ ] **Step 11.1** — `pnpm dev:web` starts on `http://localhost:3000`
- [ ] **Step 11.2** — Hero renders with 4 suggestion chips when no WS connection
- [ ] **Step 11.3** — Click a suggestion chip → sends message over WS → thinking steps animate
- [ ] **Step 11.4** — Tool cards appear and are collapsible
- [ ] **Step 11.5** — Workspace opens when artifacts arrive; tabs switch correctly
- [ ] **Step 11.6** — `⌘K` opens palette; arrow keys + Enter run a scenario
- [ ] **Step 11.7** — Tweaks panel opens; palette switch updates accent colour live
- [ ] **Step 11.8** — Light mode toggle: all CSS vars flip correctly
- [ ] **Step 11.9** — Disconnected banner shows when server is off; hides on reconnect
- [ ] **Step 11.10** — Tool approval modal appears on `tool_prompt` WS event; Allow/Deny sends correct WS reply
- [ ] **Step 11.11** — `⌘L` clears session and returns to hero
- [ ] **Step 11.12** — Responsive layout: on narrow viewport, split stage stacks vertically
