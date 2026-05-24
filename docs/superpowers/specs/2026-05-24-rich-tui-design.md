# Rich TUI Design Spec

**Date:** 2026-05-24
**Status:** Approved → ready for implementation plan

## 1. Goal

Add a rich terminal UI (`pnpm tui`) as a second client for the harness. Built with Ink (React for terminals). Connects to the same WebSocket server as the existing readline CLI — no server changes required.

## 2. Non-Goals

- No changes to `src/server/`, `src/loop/`, or any existing source files
- No new WS protocol messages — uses existing `ClientMessage` / `ServerMessage` types
- Old `pnpm cli` (readline) remains unchanged and functional
- No mouse support

## 3. Stack

- **Ink** — React-based terminal UI framework
- **@inkjs/ui** — Ink component primitives
- **react** + **@types/react** — peer deps for Ink
- **tsx** — already in dev deps, used for entry point

New deps: `ink @inkjs/ui react` (runtime), `@types/react` (dev)

## 4. Layout

```
┌─ coding · abc12345 ──────────────────────── in:2.4k out:184 $0.014 ─┐
│                                      │ TOOLS                          │
│  you: fix the auth bug               │ ▶ Read  running…               │
│                                      │ ✓ Edit  34ms                   │
│  Sure, let me look at auth.ts…       │ ✗ Bash  err                    │
│                                      │ ✓ Read  12ms                   │
│  ⚙ Read src/auth.ts → 12ms          │────────────────────────────────│
│                                      │ MEMORY                         │
│  Found issue in validateToken()      │ 📝 project-context             │
│  line 42. Fixing now.                │ + api-patterns (new)           │
│                                      │────────────────────────────────│
│                                      │ STATS                          │
│                                      │ in: 2,431  out: 184            │
│                                      │ cost: $0.014                   │
│                                      │────────────────────────────────│
│                                      │ ^C cancel  ^L clear            │
│                                      │ Tab profile  ↑↓ history        │
├──────────────────────────────────────┴────────────────────────────────┤
│ ❯ _                                                                    │
└────────────────────────────────────────────────────────────────────────┘
```

- **Header** — single line: profile name + session id (left), token counts + cost (right)
- **Chat pane** — left column, scrollable, auto-scrolls on new content
- **Right panel** — fixed 28-col width: tool log → memory keys → stats → keybinding hints
- **Input bar** — pinned bottom, full width

## 5. File Structure

```
src/tui/
  index.tsx              # entry: renders <App />, exits on ws close
  app.tsx                # root component: layout, ws lifecycle
  theme.ts               # VS Code Dark color constants
  hooks/
    use-ws.ts            # WS connect/send/recv/reconnect
    use-messages.ts      # chat message list state
    use-tools.ts         # tool event log (last 20)
    use-memory.ts        # live memory key list
  components/
    header.tsx           # top bar
    chat-pane.tsx        # scrollable message list
    message.tsx          # single message (user / assistant / tool-call / tool-prompt)
    input-bar.tsx        # input + keybinding handler
    right-panel.tsx      # tool log + memory + stats + hints
```

## 6. Theme

VS Code Dark:

```ts
// src/tui/theme.ts
export const theme = {
  bg:       '#1c1c1c',
  text:     '#d4d4d4',
  dim:      '#666666',
  accent:   '#569cd6',   // blue — tool calls, active profile
  success:  '#4ec9b0',   // teal — completed tools, ok status
  warn:     '#dcdcaa',   // yellow — tool approval prompts
  error:    '#f44747',   // red — errors, failed tools
  border:   '#333333',
  inputBg:  '#252526',
  newMemory:'#4ec9b0',   // teal — newly written memory keys
}
```

## 7. Component Specs

### header.tsx
Single `<Box>` row. Left: `● <profile>  <sessionId>`. Right: `in:<n>  out:<n>  $<cost>`. Updates on every token/llm event.

### chat-pane.tsx
Scrollable list of `<Message>` components. Auto-scrolls to bottom when `useMessages` appends. ↑/↓ keys scroll (captured in `input-bar.tsx`, emitted via shared scroll state). Renders user messages dimmed, assistant messages normal, tool-call blocks with ⚙ icon + name + duration + status color.

### message.tsx
Three variants:
- **user** — dim color, prefixed `you:`
- **assistant** — normal text, streamed token by token
- **tool-call** — `⚙ <name>  <args-preview>  →  <duration>ms` — accent color while running, success/error on complete
- **tool-prompt** — yellow bordered block: `⚠ Allow <name>? [y/N]` — captures `y`/`n`/Esc directly

### input-bar.tsx
Single-line text input. Manages:
- ↑/↓ — cycle through last 50 sent messages
- Enter — send `{ type: 'message', content }`
- Ctrl+C — send `{ type: 'cancel' }`, re-enable input
- Ctrl+L — clear `useMessages` state
- Tab — cycle to next profile name → reconnect WS (`useWs` teardown + reconnect)
- Esc (when tool-prompt visible) — send `{ type: 'tool_deny', id }`

### right-panel.tsx
Fixed width 28 cols. Four sections separated by dim horizontal rules:
1. **TOOLS** — scrolling log of last 20 tool events (running/ok/err with icons + duration)
2. **MEMORY** — live list of profile memory keys; newly written keys shown in teal for 3s then dim
3. **STATS** — `in: <n>  out: <n>` + `cost: $<n>`
4. **hints** — static keybinding reference

### use-ws.ts
Opens `WebSocket` to `ws://localhost:${HARNESS_PORT ?? 7337}`. Exposes `send(msg: ClientMessage)` and `onMessage` callback. Auto-reconnects with 1s delay on unexpected close. Profile switch (Tab) calls `reconnect(newProfilePort)` — for now same port, different session.

### use-tools.ts
Receives `tool_start` / `tool_end` / `tool_prompt` events. Maintains array of last 20 `ToolEntry` objects: `{ name, status: 'running'|'ok'|'err', duration_ms?, ts }`. `tool_start` appends running entry. `tool_end` updates matching entry with duration + status.

### use-memory.ts
Receives `tool_end` events for `MemoryWrite` tool. Maintains `MemoryKey[]` list: `{ key, isNew: boolean }`. Sets `isNew = true` on write, reverts to false after 3000ms via `setTimeout`.

### use-messages.ts
Maintains `Message[]` array. `token` events append to current streaming assistant message. `session_end` seals it. `tool_prompt` appends a prompt message block and stores pending `id` + resolve callback.

## 8. Keybindings Summary

| Key | Action |
|-----|--------|
| Enter | Send message |
| ↑ / ↓ | Scroll chat OR cycle input history (input focused = history) |
| Ctrl+C | Cancel in-flight generation |
| Ctrl+L | Clear chat pane |
| Tab | Cycle profile (reconnects WS) |
| Esc | Deny pending tool prompt |
| y / n | Approve / deny tool prompt (when prompt visible) |

## 9. Entry Point + Script

```ts
// src/tui/index.tsx
import React from 'react'
import { render } from 'ink'
import { App } from './app.js'

render(<App />)
```

```json
// package.json addition
"tui": "tsx src/tui/index.tsx"
```

## 10. Out of Scope (v2)

- Mouse support
- Multiple simultaneous sessions in tabs
- Split-pane diff view for file edits
- Persistent scroll position across reconnects
