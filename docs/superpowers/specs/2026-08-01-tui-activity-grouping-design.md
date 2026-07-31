# TUI Activity Grouping — Design

> Date: 2026-08-01
> Status: Approved (design)
> Builds on: `docs/superpowers/specs/2026-07-21-bubbletea-tui-design.md`

## Goal

Today the transcript renders one flat list of `Section`s per turn — every tool
call gets equal visual weight, colored only by its own run state (running /
done / error), with no way to tell *what kind* of activity it was without
reading the name, and no way to collapse/expand anything but the whole turn at
once (global `^O`).

This redesign groups activities by category (files, exec, memory, agents,
mcp, misc), color-codes by category, collapses routine detail by default, and
pops errors/approval-needed items out of their group so they're never buried.
Style target: opencode-style categorized activity feed, in the existing
Bubble Tea/Lipgloss transcript.

Non-goals: no change to the WS protocol, agent loop, or server. Pure
client-side rendering/interaction change in `tui/internal/ui/`.

## 1. Data model

- `Section` gains a `Category` field: one of `files | exec | memory | agents
  | mcp | misc`, derived once at section-creation time from the tool name:
  - `files`: `Read`, `Write`, `Edit`, `Glob`, `Grep`
  - `exec`: `Bash`, `ExecuteCode`
  - `memory`: `MemoryRead`, `MemoryWrite`, `MemoryList`, `MemoryDelete`, `MemoryLinked`
  - `agents`: `Delegate`, `DelegateFanout`
  - `mcp`: any tool name containing `__` (MCP tools are exposed as
    `<serverName>__<toolName>`); the group label uses the server name
    (`chrome`, `github`, …), one `mcp` group per server per turn
  - `misc`: everything else (`Skill`, `AskUser`, `TodoRead`, `TodoWrite`, `Stats`, unrecognized names)
- New type:
  ```go
  type ActivityGroup struct {
      Category string
      Label    string // e.g. "FILES", "MCP · chrome"
      Items    []*Section
      Expanded bool // group-level "show all item bodies" toggle
  }
  ```
- `Turn.Sections []Section` is replaced by `Turn.Groups []ActivityGroup`.
- **Grouping rule:** all sections in a turn sharing a category (and, for
  `mcp`, the same server) are merged into a single `ActivityGroup` for that
  turn, regardless of where they occurred in the tool-call sequence. Items
  keep their original chronological (append) order within the group. Group
  order in the turn is first-occurrence order of that category.
- Sections in `SectionError` state, or in a new `SectionAwaitingApproval`
  state, are **excluded from grouping** — see §3.

## 2. Color assignment

Each theme (`ember`, `mono`, `neon`) gains two new palette entries:
`Teal` (agents) and `Rose` (mcp) — chosen per-theme to stay legible against
that theme's background, same as existing `Purple`/`Accent`/etc.

| Category | Color field   |
|----------|---------------|
| files    | `Purple`      |
| exec     | `Accent`      |
| memory   | `Info`        |
| agents   | `Teal` (new)  |
| mcp      | `Rose` (new)  |
| misc     | `Faint` (no dedicated hue — plain gray) |

Category color applies to the group header label and to item glyphs/names
**only while the item is in its default (`SectionDone`/`SectionQueued`)
state**. Run-state color always overrides category color on the glyph:
running keeps the pulsing accent spinner, error keeps `StErr` (red),
regardless of category — state must stay scannable independent of category.

## 3. Collapse defaults and error pop-out

- A group header line is always rendered: `▾ FILES · 4 ops` (category-colored
  label + count), followed by its items indented beneath, one per line.
- Items render in their existing collapsed form (glyph, name, arg, metric —
  no body) by default. Clicking a group header expands **all item bodies in
  that group at once** (`ActivityGroup.Expanded = true`); clicking a single
  item toggles just that item's body independent of the group's state.
- Any item that is `SectionError`, or awaiting an ACL approval prompt, is
  **not placed in any group** — it renders as its own standalone, always-open
  line directly in the turn's flow (full arg + body visible, no collapse),
  at the position it occurred. This guarantees a failure or a pending
  approval is visible without expanding anything.
- Agent prose text is unaffected — rendered plain and full width as today,
  never grouped or collapsed.
- The existing global `^O` ("expand all") still works: it forces every
  group's `Expanded` to true, on top of whatever per-group/per-item state
  exists.

## 4. Mouse interaction

- Enable `tea.WithMouseCellMotion()` on the Bubble Tea program (`main.go`).
- The transcript's render pass builds a `y → target` hit-map alongside the
  rendered string: for each rendered line, record whether it's a group
  header (→ `*ActivityGroup`) or an item line (→ `*Section`), keyed by
  absolute row position within the scrollable viewport.
- `Model.Update` handles `tea.MouseMsg` (left-click, release) by translating
  the click's screen row to a viewport-relative row, looking up the hit-map,
  and toggling the matched target's `Expanded` field.
- Clicks outside any hit-map entry (blank lines, margins) are no-ops.
- Popped-out error/approval lines are not toggleable (always open) and are
  excluded from the hit-map.

## Testing

- `section_test.go`: category derivation from tool name (including MCP
  `server__tool` parsing), color resolution respecting state-override.
- New `activity_group_test.go`: grouping merge logic (order preservation,
  first-occurrence group ordering), error/approval pop-out exclusion.
- `transcript_test.go`: render output includes group headers with correct
  counts/labels; popped-out items appear inline, not nested.
- New hit-map test: given a rendered transcript, clicking a known row toggles
  the expected group/item and leaves others untouched.
