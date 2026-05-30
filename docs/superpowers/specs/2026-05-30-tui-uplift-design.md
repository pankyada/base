# TUI Uplift — Design Spec

> Roadmap item #7
> Date: 2026-05-30
> Design source: harness-ui bundle (harness.html + supporting files)

---

## Overview

Rebuild the Ink TUI to match the visual language of the harness design prototype: warm-amber-on-near-black monospace aesthetic, CSS-drawn pane borders with `┤ title ├` insets, braille spinners, a tmux-style status bar, a command palette, and a collapsible workspace panel that opens when the agent produces artifacts. The prototype is a browser React app; this spec translates it to Ink (Node.js terminal).

---

## Visual Language

### Type & colour

| Token | Value |
|-------|-------|
| Font | Terminal monospace (inherited from user's terminal) |
| Base bg | Near-black `#0b0c0e` — expressed via Ink `<Box>` bg |
| Accent | Amber `#f1a44d` |
| Dim | `#99a0ad` |
| Faint | `#595f6b` |
| OK / add | `#74c79a` |
| Del | `#e87f8d` |
| Info | `#6cb6d9` |

Ink renders via `chalk` + `ink` primitives; colours map to the nearest chalk `hex()` or named colour.

### Pane borders

Box-drawing Unicode draws each pane:

```
┌────────────────────────────┐
┤ ● conversation  1 ├         ← title inset, accent dot, pane number
│                            │
│  content area              │
│                            │
└────────────────────────────┘
```

Corner ticks use `┌ ┐ └ ┘`; title sits at top-left via absolute cursor positioning in Ink using `<Box position="absolute">`.

Focused pane: border colour switches to accent amber; unfocused: dim grey.

---

## Layout

```
┌─ top bar ─────────────────────────────────────────────────────────────┐
│ ◆ harness │ model harness-core │ session #a3f9 │ ● ready │     21:04 │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  STAGE (idle: single centred column; split: conv 42% + workspace 58%) │
│                                                                       │
│  ┌─ conv pane ──────────────┐  ┌─ workspace pane ──────────────────┐ │
│  │ ┤ ● conversation 1 ├     │  │ ┤ ● workspace 2 ├                 │ │
│  │                          │  │  [tab bar]                        │ │
│  │  messages / hero         │  │                                   │ │
│  │                          │  │  artifact widgets                 │ │
│  │  ─────────────────────   │  │                                   │ │
│  │  › composer              │  │  ─────────────────────────────    │ │
│  └──────────────────────────┘  │  ● N surfaces │ [1–9] │ [⇥]      │ │
│                                 └───────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────────┤
│ RDY │ pane conversation │ ctx 1.2k / 200k │      ◐ dark │ / │ ⌘K │ ⌘L │
└─────────────────────────────────────────────────────────────────────--┘
```

- **Idle**: conversation column centred, max 80 cols wide; hero with ASCII art + suggestion chips.
- **Split**: conversation takes `~42%` width; workspace takes remainder. Layout transitions via Ink re-render.

---

## Components

### TopBar

```
◆ harness  │  model harness-core  │  session #a3f9  │  ● ready          21:04:12  ⌘K palette
```

- `◆` brand glyph in accent
- `●` live dot: accent + pulsing when busy, ok-green when idle (Ink `useInterval` opacity toggle)
- Clock: `HH:MM:SS` updated every second via `useInterval`
- `⌘K palette` pill on right
- All segments separated by `│`

### Hero (idle state)

```
  ┌─┐  agent control surface
  │◆│  data · code · writing · research
  └─┘

◆ harness
A harness for an agent that does the work in the open.

  ▟  DATA ANALYSIS    Analyze Q2 revenue…          ↵ run task
  ❮❯ CODING           Fix the race condition…       ↵ run task
  ✎  WRITING          Draft a launch announcement…  ↵ run task
  ◎  RESEARCH         Map on-device LLM inference…  ↵ run task
```

Arrow keys navigate chips; Enter runs. Styled with accent tags and dim descriptions.

### Thinking block

```
┌ · · · · · · · · · · · · · · · · · ┐  (dashed border)
│ ✓  Locating the revenue dataset    │
│ ✓  Reading q2_revenue.csv          │
│ ⠹  Aggregating by region…          │  ← braille spinner on active step
│ ·  Scanning for outliers           │  ← pending (faint)
└ · · · · · · · · · · · · · · · · · ┘
```

Braille frames: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` cycled at 80 ms.

### ToolCall card

```
query  SELECT region, SUM(net)…              ✓ 5 regions · 38ms   ▸
```

Expanded:
```
query  SELECT region, SUM(net)…              ✓ 5 regions · 38ms   ▾
  → 5 regions · 14,402 rows scanned · 38ms
```

- `type` in accent; `arg` in dim (truncated); status in ok-green; arrow to toggle.
- Running state: braille spinner + `running` in accent.

### Composer

```
› Describe a task — analyze, build, write, research…       [run ↵]

  [/] focus   [⌘K] palette   [⇧↵] newline   [⌘L] clear
```

- `›` prompt in accent
- Textarea: Ink `<TextInput>` with multiline support (shift+enter for newlines)
- Hint row hidden in split mode (compact)

### Workspace pane — tab bar + artifacts

Tab bar:
```
 1 revenue.q2 ✕   2 auth-fix ✕   3 launch-1.0 ✕
```

Artifacts rendered as text-art widgets (see GenUI section below).

Footer:
```
● 3 surfaces  │  [1]–[3] switch  │  [⇥] focus pane
```

### StatusBar

```
 RDY  │ pane conversation │ surface revenue.q2 1/3 │ ctx 1.2k / 200k │        ◐ dark  /  ⌘K  ⌘L
```

- `RDY` / `RUN` block: accent bg, dark text, chevron clip shape (via padding + Unicode `▶`)
- Segments separated by `│`
- Keyhints right-aligned

### Command Palette

Full-width overlay (or centred box), dims background:

```
┌────────────────────────────────────────┐
│ › Run a task or command…          [esc]│
├────────────────────────────────────────┤
│ RUN TASK                               │
│ ▟  Analyze Q2 revenue by region  data  │  ← selected (accent bg)
│ ❮❯ Fix /auth/refresh race       code   │
│ ✎  Draft harness 1.0 post       write  │
│ ◎  Map on-device LLM inference  research│
│ SESSION                                │
│ ◐  Toggle theme                  view  │
│ ⟲  Clear session                 ⌘L   │
└────────────────────────────────────────┘
```

Arrow up/down navigation; Enter executes; `⌘K` or `Esc` closes.

---

## GenUI Widgets (text-art)

All widgets render in the workspace pane body. Each has a caption line:

```
▟ SUMMARY  ·  Q2 2026 · net
─────────────────────────────
```

### Metrics

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ NET REVENUE  │ │ GROSS MARGIN │ │ NEW LOGOS    │ │ NET CHURN    │
│ $23.8M       │ │ 71.2%        │ │ 318          │ │ 2.1%         │
│ ▲ +12.4% QoQ │ │ ▲ +1.8pp    │ │ ▲ +44 QoQ   │ │ ▲ -0.6pp    │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

### Bar chart

```
 Americas  ████████████████████████████████████  $9.4M
 EMEA      ████████████████████████░             $6.1M  (alt colour)
 APAC      ████████████████████                  $4.8M
 LATAM     ████████                              $2.2M
 MEA       █████                                 $1.3M
```

Bars animate on mount via `useEffect` incrementing fill width.

### Line chart (ASCII sparkline)

```
  ▁▁▂▃▄▃▁▄▅▄▆▅▇   wk 14–26 · $M
        ↑ EMEA gap (wk20)
```

Uses `▁▂▃▄▅▆▇█` block chars; flag labels above anomaly points.

### Data table

```
 REGION    NET $M   QOQ      TREND         STATUS
────────────────────────────────────────────────────
 Americas   9.4    +8.1%   ▁▂▃▃▄▅▆▇     healthy
 EMEA       6.1    -3.2%   ▄▅▆▅▃▂▄▅     review
 APAC       4.8   +31.0%   ▂▂▃▃█▅▆▆     outlier
```

Sortable columns via `<` / `>` keys when pane focused.

### File tree

```
▾ services/
  ├─ token.ts          +18 −6   ← selected (accent)
  ├─ lock.ts           +24       new
▾ routes/
  └─ auth.ts            +2 −1
▾ test/
  └─ token.test.ts     +31
```

### Diff

```
± services/token.ts   +18 −6
──────────────────────────────────────────
 @@ -85,9 +85,17 @@ async function refresh
 85  85    const key = `tok:${uid}`;
 86     −  const cur = tokenCache.get(key);  (red bg)
 87     −  const next = await mint(cur);
 88     −  tokenCache.set(key, next);
    86  +  return withLock(key, async () => { (green bg)
    87  +    const cur = tokenCache.get(key);
```

### Terminal output

```
┌─ test run ─────────────────────────────┐
│ harness $ npm test -- token            │
│ › jest --filter token                  │
│ PASS  test/token.test.ts               │
│   ✓ mints a new token (12ms)           │
│   ✓ serializes concurrent (34ms)       │
│                                        │
│ Tests:  24 passed, 24 total            │
│ Time:   1.81s                          │
└────────────────────────────────────────┘
```

### Doc draft

```
┌─ launch-1.0.md ──────────────── ✎ draft · 214 words ─┐
│                                                        │
│ harness 1.0 is here                                    │
│ The control layer for agents that do the work.         │
│                                                        │
│ THE SHIFT                                              │
│ For a year, agents have been able to talk about your   │
│ data…                                                  │
└────────────────────────────────────────────────────────┘
```

### Research

```
 1  Quantization advances: 4-bit at near-FP16 quality
    ml-systems.org/quant-2026
    New rotation-based schemes hold accuracy within 1.2% of FP16…

 2  NPU throughput in consumer silicon, measured
    siliconbench.dev/npu-roundup
    Latest mobile NPUs sustain 30–55 tok/s on 3B models…

 ◆ synthesis ────────────────────────────────────────────
 On-device inference is now practical for 3–8B models: 4-bit
 quant preserves quality within ~1%[1], consumer NPUs sustain
 30–55 tok/s[2]…
```

---

## Keybindings

| Key | Action |
|-----|--------|
| `/` | Focus composer |
| `⌘K` / `Ctrl+K` | Open command palette |
| `⌘L` / `Ctrl+L` | Clear session |
| `Tab` | Toggle focus between conv / workspace pane |
| `1`–`9` | Switch workspace tab |
| `↑` / `↓` | Navigate hero chips or palette items |
| `Enter` | Submit / run |
| `Shift+Enter` | Newline in composer |
| `Esc` | Close palette / blur |
| `←` / `→` | Sort table columns (in workspace) |
| `q` | Quit |

---

## Ink Architecture

### File structure

```
src/tui/
  App.tsx              — root: state, keybinds, layout switch
  components/
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
  widgets/
    Metrics.tsx
    BarChart.tsx
    LineChart.tsx
    DataTable.tsx
    FileTree.tsx
    Diff.tsx
    TermOut.tsx
    Doc.tsx
    Research.tsx
    GenWidget.tsx      — dispatcher
  hooks/
    useTermSize.ts     — terminal width/height
    useClock.ts        — HH:MM:SS ticker
    useSpinner.ts      — braille frame cycler
  theme.ts             — colour constants
  layout.ts            — column width calculations
```

### State

```typescript
interface AppState {
  messages: Message[]
  tabs: WorkspaceTab[]
  activeTab: number
  input: string
  busy: boolean
  focusPane: 'conv' | 'work'
  paletteOpen: boolean
}
```

`Message` is the existing harness WS message type; `WorkspaceTab` carries `{ id, label, icon, artifacts: Artifact[] }`.

### WS connection

`App.tsx` connects to the harness WS server on startup (URL from env `HARNESS_WS_URL` or default `ws://localhost:7337`). Incoming `token` events stream into the active agent message. `tool_start` / `tool_end` / `stats` / `session_end` events update state accordingly. `tool_prompt` events open an approval overlay.

### Artifact rendering

`ServerMessage` gains a new optional `artifacts` field (or a dedicated `artifacts` WS event) carrying the widget payload. Alternatively, the TUI detects structured output in the agent's final text via a marker (`__ARTIFACTS__[...]`) and parses it. The preferred approach: add an `artifacts` event to the WS protocol (no breaking change — clients that don't handle it ignore it).

---

## Animation budget

| Effect | Mechanism | Rate |
|--------|-----------|------|
| Braille spinner | `useInterval` frame cycle | 80 ms |
| Live dot pulse | `useInterval` opacity toggle | 1100 ms |
| Bar chart fill | `useState` + `useEffect` increment | 16 ms × 20 frames |
| Line chart draw | `useState` on mount | single 800 ms CSS-equiv (char-by-char) |
| Message slide-in | `useEffect` opacity ramp | 260 ms |

---

## Non-goals (this iteration)

- Light/paper theme (dark amber only for TUI)
- Font switching (terminal font is fixed)
- Tweaks panel (browser-only concept)
- Inline doc editing
