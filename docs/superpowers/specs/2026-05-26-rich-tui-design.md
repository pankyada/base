# Rich TUI Design Spec

**Goal:** Upgrade the Ink TUI from a basic chat view to an information-dense, visually alive terminal UI — covering four dimensions: information density, visual innovation, layout/navigation, and input quality.

**Architecture:** Purely TUI-side changes except one: `stats` ServerMessage gains `context_window?: number` so the header can render a context progress bar. All animation is driven by `useInterval`/`setInterval` hooks local to components. No new server routes or WebSocket message types.

**Tech Stack:** Ink 7, React 19, existing `ws` WebSocket, TypeScript.

---

## 1. File Map

### New files

| File | Responsibility |
|------|---------------|
| `src/tui/hooks/use-orb.ts` | Breathing orb animation: cycles opacity at 1.5s rhythm, returns current color based on cost thresholds |
| `src/tui/hooks/use-narrator.ts` | Derives live narrator string from the most recent running tool-call message; updates elapsed every 100ms |
| `src/tui/hooks/use-token-rate.ts` | Rolling 2s token-rate window (8 × 250ms buckets); returns bar heights array + `tok/s` number |
| `src/tui/components/wave.tsx` | Renders 8-bar histogram using `▁▂▃▄▅▆▇█` glyphs from `useTokenRate` |
| `src/tui/components/tabs.tsx` | Tab bar component: renders tab labels, highlights active tab |
| `src/tui/components/tools-tab.tsx` | Full tool list (up to 20), full name, aggregate footer |
| `src/tui/components/memory-tab.tsx` | Memory keys with one-line content preview |
| `src/tui/components/stats-tab.tsx` | Token counts, cost, session duration, tool summary |

### Modified files

| File | Change |
|------|--------|
| `src/types.ts` | Add `context_window?: number` to `stats` ServerMessage variant |
| `src/server/index.ts` | Include `context_window: profile.context_window` in `onStats` send |
| `src/tui/theme.ts` | Add `tabActive`, `tabInactive`, `orbGreen`, `orbYellow`, `orbRed` |
| `src/tui/hooks/use-memory.ts` | Extend `MemoryKey` with `preview?: string`; capture preview from `tool_start`; fix result regex |
| `src/tui/hooks/use-tools.ts` | Fix `duration_ms` (currently hardcoded 0); add aggregate helpers |
| `src/tui/components/header.tsx` | 3-row header: orb+stats / narrator+wave / context bar |
| `src/tui/components/right-panel.tsx` | Orchestrates tab bar + active tab content; drops old inline sections |
| `src/tui/components/input-bar.tsx` | Multiline input with cursor positioning (lines[], lineIdx, colIdx) |
| `src/tui/app.tsx` | Adds `activeTab` state; handles Tab keypress to cycle tabs; passes `contextWindow` to header |

---

## 2. Header (3 rows)

### Row 1 — identity + orb + stats (unchanged shape, orb replaces static `●`)

```
◌ coding  a3f9b2c1              in:12,340 out:4,210 $0.009 ●
```

The `●` before the profile name is the **breathing orb**:
- Animation: opacity cycles `0.3 → 1.0 → 0.3` over 1.5s via `setInterval` at 50ms ticks; only animates while `generating === true`
- Color thresholds (from `costUsd`):
  - `< $0.01` → `theme.orbGreen` (`#4ec9b0`)
  - `< $0.10` → `theme.orbYellow` (`#dcdcaa`)
  - `≥ $0.10` → `theme.orbRed` (`#f44747`)
- When idle: static `●` at full opacity in `theme.dim`

### Row 2 — narrator (left) + token-rate wave (right)

```
⚙ reading src/auth/token.ts · 0.4s                ▁▂▃▄▅▆▇█ 62 t/s
```

**Narrator (`use-narrator.ts`):**
- Watches `messages` for `role === 'tool-call'` with `status === 'running'`
- Uses the most recent running entry
- Verb map (tool name → present participle):
  - `Read` → `reading`
  - `Write` → `writing`
  - `Edit` → `editing`
  - `Bash` → `running`
  - `MemoryWrite` → `remembering`
  - `MemoryRead` → `recalling`
  - `Delegate` → `delegating to <profile>` (extracted from input.profile)
  - anything else → `calling`
- Target: uses `getKeyArg(name, input)` (existing helper from `message.tsx`), max 50 chars
- Elapsed: `(Date.now() - startTs) / 1000` formatted to 1 decimal, updated every 100ms
- Slow indicator: appends ` · ⚠ slow` (in `theme.warn`) when elapsed > 3s
- When no running tool: empty row (row 2 collapses to height 0 via conditional render)

**Token-rate wave (`use-token-rate.ts` + `wave.tsx`):**
- Rolling window: 8 buckets × 250ms = 2s
- Each 250ms tick: count tokens received in that interval, rotate buckets
- Bar heights: normalize bucket values to 8 levels (0–7), map to `['▁','▂','▃','▄','▅','▆','▇','█']`
- Rate label: sum of all 8 buckets / 2 = tokens/sec, formatted as `62 t/s`
- When idle (0 tokens in last 2s): show `▁▁▁▁▁▁▁▁` dimmed
- Only visible while `generating === true` (entire right portion of row 2 hidden when idle)

### Row 3 — context bar

```
ctx ▓▓▓░░░░░░░░░░░ 18% of 128k
```

- Only rendered when `contextWindow > 0`
- Fill: `Math.round((tokensIn / contextWindow) * 20)` filled `▓` chars, remainder `░`, total 20 chars
- Warning: bar color shifts to `theme.warn` when fill > 80%
- `contextWindow` sourced from `stats` ServerMessage; stored in `app.tsx` state

---

## 3. Tabbed Right Panel

### Tab bar (`tabs.tsx`)

```
 TOOLS  memory  stats
```

- Active tab: `theme.tabActive` (`#569cd6`), bold, underline via `bold` prop
- Inactive tabs: `theme.tabInactive` (`#555555`)
- `activeTab: 'tools' | 'memory' | 'stats'` lives in `app.tsx`
- **Tab key** in `app.tsx`'s `useInput` cycles: `tools → memory → stats → tools`
- Width: matches right panel width (32 chars)

### TOOLS tab (`tools-tab.tsx`)

- Renders all entries in `tools` array (up to `MAX_ENTRIES = 20`)
- Each row: `<icon> <name>  <target>  <duration>`
  - Icons: `▶` running (in `theme.accent`), `✓` ok (in `theme.success`), `✗` err (in `theme.error`)
  - Name: full name, not truncated
  - Duration: `Xms` or `running…`
- **Aggregate footer** (always shown, dimmed):
  - `<N> calls · <total_ms>ms total · <N_err> err`
  - `total_ms`: sum of all `duration_ms` values where defined
  - `N_err`: count of entries with `status === 'err'`

**Fix in `use-tools.ts`:** `duration_ms` currently hardcoded to `0` in `tool_end` handler. Fix: store `startTs` in each entry (already present in `ToolEntry` in `use-messages.ts`), compute `Date.now() - entry.startTs` on end.

### MEMORY tab (`memory-tab.tsx`)

- Renders all keys in `memoryKeys`
- Each key is a 2-line block:
  ```
  📝 user-prefs
     prefers TypeScript, tabs over spaces…
  ```
  - Line 1: `📝` + key name in `theme.text` (new keys in `theme.newMemory`)
  - Line 2: `preview` in `theme.dim`, max 60 chars, ellipsis if truncated
  - If no preview: only line 1 rendered

**Changes to `use-memory.ts`:**
- Extend `MemoryKey`: add `preview?: string`
- Extend `memoryReducer` `write` action: add `preview?: string`
- In `handleMessage`: also listen for `tool_start` where `msg.name === 'MemoryWrite'`; extract `preview` from first line of `msg.input.content` (cast to string), truncate to 60 chars
- Fix broken regex: current is `/Wrote memory key:\s*(.+)/`, actual result is `Memory written: ${scope}/${key}` → new regex: `/Memory written:\s*\S+\/(.+)/`

### STATS tab (`stats-tab.tsx`)

```
Tokens
  in:   12,340
  out:   4,210
Cost     $0.009
Duration   4.2s
─────────────
Tools     5 calls
Errors    1
Avg dur   454ms
```

- `sessionStart` timestamp: set in `app.tsx` on first `token` or `tool_start` message
- Duration: `(Date.now() - sessionStart) / 1000`, formatted to 1 decimal, updated every second
- Averages computed from `tools` array in `app.tsx`; passed as props

---

## 4. Multiline Input

### State

```typescript
const [lines, setLines] = useState<string[]>([''])
const [lineIdx, setLineIdx] = useState(0)
const [colIdx, setColIdx] = useState(0)
const [history, setHistory] = useState<string[]>([])
const [histIdx, setHistIdx] = useState(-1)
```

### Key bindings

| Key | Action |
|-----|--------|
| `Shift+↵` | Split current line at `colIdx`, push remainder to new line below; move cursor to start of new line |
| `↵` | Join all lines with `\n`, send, reset to `['']`, reset cursor |
| `←` | `colIdx--`; if `colIdx < 0` and `lineIdx > 0`: move to end of prev line |
| `→` | `colIdx++`; if past end of line and `lineIdx < lines.length - 1`: move to start of next line |
| `↑` | If `lineIdx > 0`: `lineIdx--`, clamp `colIdx` to new line length. Else: history navigate up |
| `↓` | If `lineIdx < lines.length - 1`: `lineIdx++`, clamp `colIdx`. Else: history navigate down |
| `Backspace` | Delete char before `colIdx`; if `colIdx === 0` and `lineIdx > 0`: merge with prev line |
| Any printable | Insert at `colIdx`, advance `colIdx` |

### Rendering

```
❯ first line of input
  second line▌
  third line
  2 lines · ⇧↵ newline
```

- Prompt `❯` shown only on first line; subsequent lines indented by 2 spaces
- Cursor glyph `▌` inserted after char at `colIdx` on active `lineIdx`
- Line count hint: shown below when `lines.length > 1`, in `theme.dim`
- Pending tool prompt: overrides entire input display with `⚠ y/n ❯` (unchanged behavior)
- `disabled` and no pending: show `… ❯` prompt on single line (unchanged)

---

## 5. Protocol Change

### `src/types.ts`

```typescript
| { type: 'stats'; tokens_in: number; tokens_out: number; cost_usd: number; context_window?: number }
```

### `src/server/index.ts`

```typescript
onStats: (tokens_in, tokens_out, cost_usd) => {
  send({ type: 'stats', tokens_in, tokens_out, cost_usd, context_window: profile.context_window ?? 0 })
},
```

---

## 6. Theme additions (`theme.ts`)

```typescript
export const theme = {
  // existing...
  tabActive:   '#569cd6',
  tabInactive: '#555555',
  orbGreen:    '#4ec9b0',
  orbYellow:   '#dcdcaa',
  orbRed:      '#f44747',
} as const
```

---

## 7. Testing

- `tests/tui-hooks.test.ts`: unit tests for `messagesReducer`, `toolsReducer`, `memoryReducer` (extend existing patterns)
- `use-narrator.ts`, `use-orb.ts`, `use-token-rate.ts`: pure logic functions extracted and tested independently (no React, just the computation functions)
- No visual/render tests — Ink's `ink-testing-library` is present but skipped for animation-heavy components; covered by manual smoke test

---

## 8. Out of scope

- Mouse support
- Resizable panels
- Persistent tab preference across sessions
- Syntax highlighting in tool result expansions
- Scroll within the memory/stats tabs (panel is fixed height)
