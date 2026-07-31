# Plan: TUI Revamp — Go/Bubble Tea control surface

**Generated**: 2026-07-31
**Estimated Complexity**: High
**Supersedes**: tasks 8–14 of [`2026-07-21-bubbletea-tui.md`](2026-07-21-bubbletea-tui.md) (tasks 0–7 are committed and kept)
**Extends**: [`2026-07-21-bubbletea-tui-design.md`](../specs/2026-07-21-bubbletea-tui-design.md)

---

## Overview

Turn the in-flight Go/Bubble Tea client into the primary harness interface: a
control surface where the model, the trust level, the session history, and the
agent's own proposed skills are all one keypress away, and where the running
state of the agent is legible without reading text.

Six user-requested capabilities, plus three accepted extras:

| # | Capability | Server work? |
|---|-----------|--------------|
| 1 | `/model` — live model switch, per-session override, curated registry | yes |
| 2 | `/approval` — 4 approval modes (strict / bash / dangerous / yolo) | yes |
| 3 | Skills mining review → edit → promote, plus mine-on-demand | yes |
| 4 | UI overhaul — right-aligned user bubbles, motion, clear errors, better AskUser, context + spend readouts | no |
| 5 | `Tab` → tabbed overlay (Model · Approval · Skills) | no |
| 6 | `^B` → right context rail | no |
| E1 | Input superpowers — `/` `@` `!` `#` autocomplete, message queueing, ↑ recall | partial |
| E2 | Cost & context intelligence — context gauge, spend ticker, per-turn breakdown, sparkline, `/compact` | yes (one field + one message) |
| E3 | Delight & motion — boot splash, typewriter cursor, easing, spinner personalities, OSC-9 notify, themes | no |

### Design decisions (confirmed with user)

- **Target**: the Go/Bubble Tea TUI in `tui/`. Ink (`src/tui/`) is **deleted in
  Sprint 0**, before the Go client is complete. `pnpm dev:cli` (readline client)
  is the interim fallback.
- **Model switch**: per-session override via a new `set_model` WS message; the
  model list comes from a curated in-repo registry (an extended `MODEL_PRICES`)
  so cost and context-window math stay correct.
- **Approval mode**: per-connection override, last choice persisted per profile
  to `~/.harness/tui.json`. Profile YAML remains the baseline; a profile `deny`
  can never be relaxed by a mode.
- **Dangerous classification**: LLM classifier, wrapped in a static prefilter +
  verdict cache + timeout + fail-closed-to-prompt, so the model is consulted
  only on genuinely ambiguous calls.
- **Default approval mode**: `danger`. Fresh installs get risk-aware approvals
  out of the box. Sprint 2 ships it backed by static rules only (zero cost);
  Sprint 3 adds the model stage, which `safety.enabled: false` opts out of.
- **Skills**: review, inline edit, promote/discard, **and** mine-on-demand.
- **Keys**: `Tab` = overlay, `^B` = rail. `Tab` accepts an open autocomplete
  first (see Task 8.1 precedence rule).

### Non-goals

- No changes to the agent loop's tool-execution strategy, MCP, memory, or the
  web client.
- **No History tab and no session resume UI.** The server's `resume` transfers
  no message history, so a history picker would resume into a blank transcript.
  Both it and the `session_transcript` replay message it needs are deferred —
  see "Deferred" at the end.
- Transcript power tools (scrollback search, OSC-52 copy, markdown export,
  inline `+/-` diff renderer) are **out of scope** — deliberately deferred; see
  "Deferred" at the end.

---

## Prerequisites

- Go ≥ 1.26 toolchain (`go.mod` pins `go 1.26.5`).
- Existing pins stay: `bubbletea v1.3.10`, `bubbles v1.0.0`, `lipgloss v1.1.0`,
  `gorilla/websocket v1.5.3`. **Do not** bump to Bubble Tea v2 / Bubbles v2 —
  see Gotcha G1.
- `github.com/charmbracelet/x/ansi` promoted from indirect to direct dependency
  (needed by the overlay compositor).
- An API key in env for whichever provider the active profile uses.
- Committed and kept: `tui/internal/protocol`, `tui/internal/ws`,
  `tui/internal/server`, `tui/internal/ui/{theme,spinner,section,transcript}.go`.

---

## Protocol appendix (single source of truth for Sprints 2–7)

All additions go in **both** `src/types.ts` and `tui/internal/protocol/msg.go`,
and are covered by the round-trip test in `tui/internal/protocol/msg_test.go`.

**New `ClientMessage` variants**

```ts
| { type: 'models_list' }
| { type: 'set_model'; model: string }
| { type: 'set_approval_mode'; mode: ApprovalMode }
| { type: 'skills_list' }
| { type: 'skill_get'; name: string; source: 'proposed' | 'installed' }
| { type: 'skill_save'; name: string; content: string }
| { type: 'skill_promote'; name: string }
| { type: 'skill_discard'; name: string }
| { type: 'skills_mine' }
| { type: 'compact' }
```

**New `ServerMessage` variants**

```ts
| { type: 'models'; models: ModelInfo[]; current: string }
| { type: 'model_changed'; model: string }
| { type: 'approval_mode_changed'; mode: ApprovalMode }
| { type: 'skills'; proposed: SkillSummary[]; installed: SkillSummary[] }
| { type: 'skill_content'; name: string; source: string; path: string; content: string }
| { type: 'skill_result'; action: 'saved'|'promoted'|'discarded'; name: string; path?: string }
| { type: 'notice'; level: 'info'|'warn'|'error'; message: string; detail?: string }
```

**Modified existing messages**

```ts
// tool_prompt gains risk metadata (Sprint 2 static, Sprint 3 classifier-backed)
| { type: 'tool_prompt'; id; name; input; risk?: 'safe'|'caution'|'danger'; reason?: string }
// stats gains live context occupancy (distinct from cumulative usage)
| { type: 'stats'; tokens_in; tokens_out; cost_usd; context_window?; context_tokens?: number }
```

**New shared types**

```ts
export type ApprovalMode = 'strict' | 'bash' | 'danger' | 'yolo'
export type RiskLevel = 'safe' | 'caution' | 'danger'
export interface ModelInfo {
  id: string; label: string; provider: string; base_url: string
  context_window: number; input_price: number; output_price: number
  tags: string[]            // e.g. ["fast"], ["reasoning"]
  available: boolean        // false when base_url differs from active profile
  reason?: string           // why unavailable
}
export interface SkillSummary {
  name: string; description: string; path: string
  source: 'proposed' | 'installed'; mtime: string
}
```

**Approval mode semantics** (`src/tools/approval-mode.ts`)

| Mode | Label in UI | Behaviour |
|------|-------------|-----------|
| `strict` | Ask for each edit | Every mutating tool prompts: `Write`, `Edit`, `Bash`, `ExecuteCode`, `Delegate`, `MemoryWrite`, `MemoryDelete`, and all MCP tools. Reads/search/todos allow. |
| `bash` | Ask only Bash | `Bash` + `ExecuteCode` prompt; everything else allow. |
| `danger` | Ask only when risky | **Default.** Per-call verdict: static rules in Sprint 2, classifier-backed from Sprint 3. `danger` → prompt, `caution`/`safe` → allow. |
| `yolo` | YOLO | Everything allow. |

**Precedence rule (safety-critical):** a profile ACL of `deny` always wins —
no mode can turn `deny` into `allow` or `prompt`. Modes only override `allow`
and `prompt`. This is asserted by a test in Task 2.2.

**Default:** `danger`, unless prefs hold a remembered mode for the profile or
`hello.yolo` is set (→ `yolo`, preserving today's flag behaviour).

---

## Sprint 0: Clear the deck

**Goal**: Ink is gone, the Go module owns the TUI entry points, and the shared
primitives every later sprint depends on (prefs file, overlay compositor,
keymap, model registry) exist and are tested.

**Demo/Validation**:
- `pnpm typecheck && pnpm test` green with zero references to `src/tui`.
- `pnpm dev:tui` runs the Go binary (still the stub screen — accepted gap).
- `cd tui && go test ./...` green.

### Task 0.1: Delete the Ink TUI and rewire scripts
- **Location**: `src/tui/` (delete), `tests/tui/`, `tests/tui-*.test.ts` (delete), `package.json`
- **Description**: Remove `src/tui/` and its vitest suites. Drop `ink`,
  `ink-text-input`, `@inkjs/ui`, `react`, `@types/react`, `ink-testing-library`,
  `react-devtools-core` from `package.json`. Repoint `dev:tui` and `tui` scripts
  to `go run ./tui`. Remove the three bun-compiled `harness-tui*` targets from
  `build:bin` (Go cross-compilation lands in Task 10.1). Keep the `harness-tui`
  bin alias but point it at the Go output path.
- **Dependencies**: none
- **Acceptance Criteria**:
  - `grep -r "src/tui\|from 'ink'" src tests package.json` returns nothing
  - `pnpm install` prunes the React/Ink tree from `node_modules`
  - `pnpm typecheck` and `pnpm test` pass
- **Validation**: `pnpm typecheck && pnpm test && pnpm dev:tui` (prints the stub)

### Task 0.2: Extract and refresh the model registry
- **Location**: `src/models/registry.ts` (new), `src/loop/agent-loop.ts`
- **Description**: Move `MODEL_PRICES` / `FALLBACK_PRICES` / `estimateCost` out
  of `agent-loop.ts` into `src/models/registry.ts`, widening each entry to the
  `ModelInfo` shape (add `label`, `provider`, `base_url`, `context_window`,
  `tags`). Export `listModels(profile): ModelInfo[]` which marks entries whose
  `base_url` differs from the active profile as `available: false` with a
  reason, and always includes `profile.model.id` (synthesising a fallback-priced
  entry with a `notice`-worthy flag if unknown). Re-export `estimateCost` from
  `agent-loop.ts` so no other import sites change.

  **Refresh the table** in the same task: add the current Claude 5 family
  (`claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-haiku-4-5-20251001`)
  and the current OpenAI GPT/o-series alongside the existing entries. **Keep
  every existing id** — `profiles/*.yaml` reference `claude-opus-4-8`,
  `claude-sonnet-4-6`, and `gpt-5.4-mini`, and those must keep resolving. Do
  **not** guess prices or context windows: read them off the provider pricing
  pages at implementation time (the `claude-api` skill is the reference for
  Anthropic ids, pricing, and context limits). Every entry carries a
  `# source: <url>, checked <date>` comment.
- **Dependencies**: none
- **Acceptance Criteria**:
  - `agent-loop.ts` no longer declares price tables; behaviour identical
  - every model id referenced by any file in `profiles/` resolves in the table
  - `listModels()` returns ≥ 10 entries with correct `available` flags for both
    an Anthropic-based and an OpenAI-based profile
  - no entry has a placeholder or invented price
- **Validation**: new `tests/models-registry.test.ts` — asserts `estimateCost`
  parity against the old table for 3 known models + fallback warning path;
  asserts cross-provider entries are `available: false`; asserts every
  `profiles/*.yaml` model id is present in the registry

### Task 0.3: Go client preferences store
- **Location**: `tui/internal/prefs/prefs.go`, `prefs_test.go` (new)
- **Description**: Load/save `~/.harness/tui.json`:
  `{ approval_mode_by_profile: map[string]string, model_by_profile: map[string]string, theme: string, rail_visible: bool, overlay_tab: string, seen_notices: map[string]bool }`.
  Missing/corrupt file → zero-value defaults, never an error to the caller.
  Writes are atomic (temp file + rename) and debounced by the caller.
- **Dependencies**: none
- **Acceptance Criteria**: round-trips all fields; corrupt JSON yields defaults;
  concurrent `Save` calls never leave a truncated file
- **Validation**: `go test ./internal/prefs/` with a `t.TempDir()`-injected home

### Task 0.4: Overlay compositor
- **Location**: `tui/internal/ui/overlay.go`, `overlay_test.go` (new)
- **Description**: `Composite(bg, fg string, x, y int) string` — splice a
  rendered foreground box into a rendered background at cell offset `(x,y)`,
  using `ansi.StringWidth` and `ansi.Truncate` for ANSI-aware slicing. Plus
  `Center(bg, fg string, w, h int) string`. Bubble Tea v1 has no z-index or
  layer API, so this is the modal/overlay primitive for every popup.
- **Dependencies**: promote `github.com/charmbracelet/x/ansi` to direct
- **Acceptance Criteria**:
  - background rows outside the box are byte-identical to input
  - styled (ANSI-coloured) backgrounds keep their colours either side of the box
  - out-of-bounds `x`/`y` clamp instead of panicking
  - wide runes (CJK/emoji) do not shift the right edge
- **Validation**: `go test ./internal/ui/ -run Overlay` with golden strings,
  `lipgloss.SetColorProfile(termenv.Ascii)` for deterministic output

### Task 0.5: Central keymap + help
- **Location**: `tui/internal/ui/keys.go` (new)
- **Description**: One `KeyMap` struct of `key.Binding`s covering: send, newline
  (shift+enter), cancel (esc), quit (ctrl+c), overlay (tab), rail (ctrl+b),
  expand-all (ctrl+o), scroll (pgup/pgdn/ctrl+u/ctrl+d), history recall (↑/↓),
  accept-completion (tab), help (`?`). Provides `ShortHelp`/`FullHelp` for the
  `bubbles/help` bubble.
- **Dependencies**: none
- **Acceptance Criteria**: every binding has non-empty `Help` text; no duplicate
  key across simultaneously-enabled bindings (asserted by test)
- **Validation**: `go test ./internal/ui/ -run KeyMap` — table test that walks
  the struct by reflection and fails on collisions within the same mode

---

## Sprint 1: A runnable TUI again

**Goal**: End-to-end conversation in the Go client — connect, stream, render
turns and tool sections, right-aligned user bubbles, cancel, scroll, clear
errors. This closes the gap Sprint 0 opened.

**Demo/Validation**: `pnpm dev:tui` → type a message → tokens stream in, tool
calls appear as collapsible sections, your message sits in a right-aligned
bubble, `esc` cancels mid-turn, killing the server shows a reconnect banner and
the client recovers when it comes back.

### Task 1.1: Root model skeleton
- **Location**: `tui/internal/ui/model.go`, `tui/main.go`
- **Description**: `Model` with `Init/Update/View`. Holds: WS client handle,
  `Transcript`, composer, viewport, topbar/statusbar state, spinner frame,
  connection state, terminal size, prefs. `Update` routes `tea.WindowSizeMsg`,
  `tea.KeyMsg`, the spinner tick, and `protocol.ServerMessage` (delivered by the
  existing `ws` goroutine via `p.Send`). `main.go` parses flags (`--version`,
  `--profile`, `--port`), calls `server.Boot`, starts the program with
  `tea.WithAltScreen()`, and guarantees server cleanup on exit.
- **Dependencies**: 0.3, 0.5
- **Acceptance Criteria**: launches, renders, `ctrl+c` exits cleanly and reaps
  the spawned server; unknown `ServerMessage` types are ignored, never fatal
- **Validation**: `teatest` boot golden; manual `pnpm dev:tui`

### Task 1.2: Composer
- **Location**: `tui/internal/ui/composer.go`
- **Description**: `bubbles/textarea` based input in a rounded box. `enter`
  sends, `shift+enter` inserts a newline, `↑`/`↓` walk a bounded (50-entry)
  in-memory send history when the cursor is on the first/last line, `esc`
  clears then cancels. Height grows 1→6 lines with content. Placeholder text
  rotates hints ("/model to switch · Tab for panels · ? for keys").
- **Dependencies**: 1.1
- **Acceptance Criteria**: multiline input renders and sends verbatim; history
  recall does not fire mid-paragraph; box width tracks terminal resize
- **Validation**: `go test ./internal/ui/ -run Composer` — key-sequence table
  test asserting resulting value and submitted payload

### Task 1.3: Right-aligned user bubble
- **Location**: `tui/internal/ui/bubble.go`, `transcript.go`
- **Description**: Replace the current left-gutter user block with a rounded
  bubble: `ColInfo` border, width `min(contentWidth*62/100, longestLine+4)`,
  positioned with `lipgloss.PlaceHorizontal(width, lipgloss.Right, box)`, with
  a dim `you · HH:MM` label right-aligned above it. Agent turns stay flat and
  left-aligned — the asymmetry is what makes the stream scannable.
- **Dependencies**: 1.1
- **Acceptance Criteria**: bubbles wrap correctly at 60, 80, and 200 columns;
  a single-word message produces a snug bubble, not a 62% slab; no horizontal
  overflow at 40 columns (bubble falls back to full width)
- **Validation**: extend `transcript_test.go` with golden renders at three widths

### Task 1.4: Streaming, turns, and the viewport
- **Location**: `tui/internal/ui/model.go`, `transcript.go`
- **Description**: Wire `token` → append to the open agent turn; `tool_start` →
  push a `SectionRunning`; `tool_end` → resolve to `SectionDone`/`SectionError`
  (error detected by the `Error:` prefix the loop emits) and fill `Body` with a
  truncated result (first 40 lines, "… N more lines" footer). `session_end`
  closes the turn and stamps its footer. Transcript lives in a
  `bubbles/viewport`; auto-follow while pinned to the bottom, release on manual
  scroll, re-pin on `G`/end.
- **Dependencies**: 1.1, 1.3
- **Acceptance Criteria**: 500-message transcript scrolls without visible lag;
  auto-follow does not fight a user who has scrolled up; sections collapse by
  default and `ctrl+o` toggles all
- **Validation**: `teatest` script — send 3 tool_start/end pairs and a token
  stream, assert final view golden; manual scroll check

### Task 1.5: Top bar + status bar
- **Location**: `tui/internal/ui/topbar.go`, `statusbar.go`
- **Description**: TopBar — `◆ harness` wordmark, profile, short session id,
  connection dot (green/amber/red), clock. StatusBar — mode badge
  (`RUN`/`RDY`), **active model id**, **approval mode badge**, tokens, cost,
  and the hint `tab panels · ^b rail · ? keys`. Both degrade gracefully below
  80 columns by dropping segments right-to-left.
- **Dependencies**: 1.1
- **Acceptance Criteria**: never wraps or exceeds terminal width at 40/80/200
  columns; segments drop in a documented priority order
- **Validation**: `go test ./internal/ui/ -run Bars` golden at three widths

### Task 1.6: Notices, errors, and the disconnect banner
- **Location**: `tui/internal/ui/notice.go`
- **Description**: A toast stack rendered above the composer. `error` messages
  render red with the message and, when present, a `detail` line and a
  suggested action (unknown model → "run /model", missing API key → names the
  env var from the profile). Toasts auto-dismiss after 6s, `esc` clears all.
  Transport disconnect renders a persistent amber banner with the retry
  countdown, replaced by a green "reconnected" toast on recovery.
- **Dependencies**: 1.1
- **Acceptance Criteria**: a malformed server frame produces a toast, never a
  crash; banner and toasts coexist without overlapping the composer
- **Validation**: `go test ./internal/ui/ -run Notice`; manual: kill and restart
  the server mid-session

---

## Sprint 2: Approval modes

**Goal**: `/approval` switches the trust level live, the default `danger` mode
already does something real (static rules, zero cost), the approval modal is
genuinely readable, and `AskUser` requests are first-class.

**Demo/Validation**: Fresh launch defaults to `danger` — `ls` runs silently,
`rm -rf build` prompts with a red badge and the reason "destructive filesystem
removal". Switch to `strict` with `/approval`; `ls` now prompts. Switch to
`yolo`; nothing prompts. Restart the TUI — the mode is remembered for that
profile.

### Task 2.1: ApprovalMode types across the wire
- **Location**: `src/types.ts`, `tui/internal/protocol/msg.go`, `msg_test.go`
- **Description**: Add `ApprovalMode`, `RiskLevel`, `set_approval_mode`,
  `approval_mode_changed`, `notice`, and the `risk`/`reason` fields on
  `tool_prompt` per the Protocol appendix.
- **Dependencies**: none
- **Acceptance Criteria**: Go round-trip test covers every new variant
- **Validation**: `go test ./internal/protocol/` + `pnpm typecheck`

### Task 2.2: Approval-mode ACL resolver
- **Location**: `src/tools/approval-mode.ts` (new), `src/tools/acl.ts`
- **Description**: `APPROVAL_MODES` table per the appendix, plus
  `resolveAcl(toolName, profile, mode): AclValue`. Profile `deny` short-circuits
  first and is never relaxed. `getAcl`/`getMcpAcl` keep their signatures; the
  new resolver wraps them.
- **Dependencies**: 2.1
- **Acceptance Criteria**:
  - `strict` → `Bash: prompt`, `Read: allow`
  - `bash` → `Bash: prompt`, `Write: allow`
  - `yolo` → `Bash: allow`
  - profile `Bash: deny` + `yolo` → still `deny`
  - MCP tools resolve through the same rules
- **Validation**: `tests/approval-mode.test.ts` — full matrix of 4 modes × 8
  tools × {profile allow, prompt, deny}

### Task 2.3: Static danger rules
- **Location**: `src/safety/rules.ts` (new)
- **Description**: Two tables and a path check, all pure functions — this is the
  entire `danger` verdict in Sprint 2, and becomes the free prefilter stage of
  the classifier in Sprint 3:
  - `SAFE_TOOLS`: `Read`, `Grep`, `Glob`, `Skill`, `Stats`, `MemoryRead`,
    `MemoryList`, `TodoRead`, `TodoWrite` → `safe`.
  - `DANGER_PATTERNS`: regexes over `Bash.command` — `rm -rf`, `mkfs`, `dd if=`,
    `:(){`, `chmod 777`, `sudo`, `curl|wget … | sh|bash`, `git push --force`,
    `git reset --hard`, `npm publish`, `> /dev/sd`, `kill -9 1`, `shutdown`,
    `truncate -s 0` → `danger` with a fixed human reason.
  - `escapesWorkingDir(input, workingDir)`: any `file_path`/`path` argument that
    resolves outside `working_dir` → `danger`.
  - Everything else → `caution` (allowed in Sprint 2; escalated to the model in
    Sprint 3).
- **Dependencies**: none
- **Acceptance Criteria**: every pattern has a positive and a negative test case
  (e.g. `rm -rf /tmp/x` matches; `confirm-rm-rfusage` does not); path check
  handles `..`, symlink-free relative paths, and `~`
- **Validation**: `tests/safety-rules.test.ts` — ≥ 30 cases

### Task 2.4: Thread the mode through the loop
- **Location**: `src/tools/types.ts`, `src/loop/agent-loop.ts`, `src/server/index.ts`
- **Description**: Add `approvalMode?: ApprovalMode` to `ToolContext`. The loop
  calls `resolveAcl(..., context.approvalMode)` instead of `getAcl`/`getMcpAcl`
  directly; in `danger` mode it consults `src/safety/rules.ts` and maps
  `danger` → prompt, `caution`/`safe` → allow, attaching `risk` and `reason` to
  the `tool_prompt` message. The server keeps a per-connection `approvalMode`
  (seeded `hello.yolo ? 'yolo' : 'danger'`), handles `set_approval_mode` by
  updating it and echoing `approval_mode_changed`, and rebuilds `ToolContext`
  per message.
- **Dependencies**: 2.2, 2.3
- **Acceptance Criteria**: switching mode between two turns changes prompting
  behaviour on the second turn; a mid-turn switch applies to the next tool call;
  `danger` mode prompts on `rm -rf` and allows `ls`
- **Validation**: extend `tests/agent-loop.test.ts` — same tool call under two
  modes yields prompt vs. no-prompt

### Task 2.5: Approval modal
- **Location**: `tui/internal/ui/modals.go`
- **Description**: Centered overlay (via `ui.Center`) showing tool name, a risk
  badge (`safe` dim / `caution` amber / `danger` red), the `reason` line when
  present, and a pretty-printed, truncated input preview — with `command`
  rendered verbatim for `Bash` and `file_path` + a content excerpt for
  `Write`/`Edit`. Keys: `y`/`enter` approve, `n`/`esc` deny, `a` approve and
  switch to `yolo` for the session (with a confirming toast).
- **Dependencies**: 1.1, 2.1, 0.4
- **Acceptance Criteria**: modal never exceeds 80% of terminal width/height;
  long inputs scroll inside the modal rather than overflowing; approving sends
  exactly one `tool_approve`
- **Validation**: `go test ./internal/ui/ -run ApprovalModal` golden + key table

### Task 2.6: AskUser (input request) modal
- **Location**: `tui/internal/ui/modals.go`
- **Description**: Three renderings for `input_request`: `text` (single-line
  `textinput`), `select` (radio list, ↑/↓ + enter), `multi_select` (checkbox
  list, space toggles, enter confirms, shows "n selected"). The prompt wraps and
  is styled as a question, visually distinct from the approval modal. `esc`
  sends an empty response rather than hanging the agent loop.
- **Dependencies**: 2.5
- **Acceptance Criteria**: all three kinds render and return the right payload
  (`multi_select` joins with `, ` matching the Ink client's contract); `esc`
  always resolves the pending request
- **Validation**: `go test ./internal/ui/ -run InputRequest` — one case per kind

### Task 2.7: `/approval` slash command
- **Location**: `tui/internal/ui/slash.go` (new), `model.go`, `prefs`
- **Description**: Minimal slash dispatcher (full autocomplete arrives in 8.1):
  a line starting with `/` is intercepted and never sent to the agent. `/approval`
  with no argument opens the overlay's Approval tab (Sprint 5) or, until then,
  a plain 4-item picker; `/approval yolo` sets directly. On change: send
  `set_approval_mode`, persist to `~/.harness/tui.json` under the active
  profile, toast the new mode. Unknown commands produce a helpful notice listing
  valid ones — never silently send to the model.
- **Dependencies**: 0.3, 2.1
- **Acceptance Criteria**: mode survives a TUI restart; `/approval bogus` shows
  the valid list; a message that merely *contains* a slash is unaffected
- **Validation**: `go test ./internal/ui/ -run Slash`

---

## Sprint 3: Dangerous-command classification

**Goal**: Upgrade `danger` mode's `caution` bucket from "allow" to a cheap model
verdict — obvious cases still resolve instantly and for free, ambiguous ones get
classified, and nothing fails open.

**Demo/Validation**: In `danger` mode, `ls` runs silently (no network call);
`rm -rf build` still prompts instantly from the static rule; `find . -name
'*.tmp' -delete` — which Sprint 2 allowed — now prompts with a model-written
reason; re-running it is instant (cache hit). Kill network access → the call
times out and prompts anyway. Set `safety.enabled: false` → Sprint 2 behaviour
returns.

### Task 3.1: Safety profile block
- **Location**: `src/profiles/schema.ts`
- **Description**: Optional `safety: { classifier_model_id?: string, timeout_ms: number = 3000, cache_ttl_hours: number = 168, enabled: boolean = true }`.
  Default `classifier_model_id` resolves to the cheapest same-provider entry in
  the model registry. `enabled: false` is the documented opt-out: `danger` mode
  falls back to static-rules-only (Sprint 2 behaviour), making no model calls.
- **Dependencies**: 0.2
- **Acceptance Criteria**: profiles without a `safety:` block parse unchanged
  and default to `enabled: true`
- **Validation**: `tests/profile-schema.test.ts` addition

### Task 3.2: Verdict cache
- **Location**: `src/safety/cache.ts` (new)
- **Description**: Disk-backed map at `~/.harness/danger-cache.json`, keyed by
  `sha256(toolName + canonicalJson(input))`, storing `{ risk, reason, ts }`.
  TTL from profile; capped at 2000 entries (LRU eviction); corrupt file → empty
  cache, never a throw. Loaded once, flushed debounced (≤ 1 write / 5s).
- **Dependencies**: 3.1
- **Acceptance Criteria**: identical input hits cache; key ordering in the input
  object does not change the hash; expired entries are ignored and pruned
- **Validation**: `tests/safety-cache.test.ts` with an injected clock and tmpdir

### Task 3.3: Classifier
- **Location**: `src/safety/classifier.ts` (new)
- **Description**: `classify(toolName, input, ctx): Promise<{risk, reason, source}>`
  running the pipeline: safe-tools → danger-patterns → working-dir check
  (all three from `src/safety/rules.ts`, Task 2.3) → cache → model. Model call
  uses `openai.chat.completions.create` with the
  classifier model, a system prompt that demands strict JSON
  `{"risk":"safe|caution|danger","reason":"≤12 words"}`, `max_tokens: 64`, and
  an `AbortSignal` timeout. Any failure (timeout, bad JSON, network) →
  `{risk:'danger', reason:'classification unavailable', source:'failsafe'}`.
  Emits a `kind: 'safety'` telemetry event with `source` and `duration_ms`.
  When `safety.enabled` is false, the model stage is skipped entirely and
  `caution` is returned as-is.
- **Dependencies**: 2.3, 3.2
- **Acceptance Criteria**:
  - safe tools never reach the network (assert the client is not called)
  - static danger never reaches the network
  - timeout path returns `danger` within `timeout_ms + 100ms`
  - malformed model JSON returns `danger`, not a throw
- **Validation**: `tests/safety-classifier.test.ts` with a stub OpenAI client
  covering all five branches

### Task 3.4: Swap the loop from static rules to the classifier
- **Location**: `src/loop/agent-loop.ts`, `src/types.ts`
- **Description**: Replace Task 2.4's direct `rules.ts` call in `danger` mode
  with `await classify(...)`. Classification happens before `flushBatch()` so
  batched allow-tools are unaffected, and runs concurrently across the tool
  calls of one batch rather than serially. Add `kind: 'safety'` to
  `TelemetryEvent`.
- **Dependencies**: 3.3, 2.4
- **Acceptance Criteria**: in `danger` mode a safe tool adds no measurable
  latency; a classified-danger tool prompts with the reason shown in the modal;
  a batch of 5 ambiguous calls classifies in roughly one round-trip, not five
- **Validation**: `tests/agent-loop.test.ts` addition with a stubbed classifier

### Task 3.5: First-run disclosure
- **Location**: `tui/internal/ui/notice.go`, `src/server/index.ts`
- **Description**: On the first session where `danger` mode actually invokes the
  model stage, send one `notice` explaining that ambiguous tool calls are being
  classified by `<model>`, that verdicts are cached, and that
  `safety.enabled: false` or `/approval bash` opts out. Recorded in prefs so it
  shows once per profile, not once per session.
- **Dependencies**: 3.4, 0.3
- **Acceptance Criteria**: appears exactly once per profile; never appears when
  `safety.enabled` is false
- **Validation**: `go test ./internal/ui/ -run FirstRunNotice`

---

## Sprint 4: Live model switching

**Goal**: `/model` swaps the model for the running session; cost and context
math follow it.

**Demo/Validation**: `/model` lists models with price and context window,
cross-provider ones greyed out with a reason. Pick one → toast + status bar
updates → next turn uses it → the cost ticker reflects the new price. Restart —
the choice is remembered for that profile.

### Task 4.1: Model messages + server handlers
- **Location**: `src/types.ts`, `src/server/index.ts`, `tui/internal/protocol/msg.go`
- **Description**: Add `models_list`/`models`/`set_model`/`model_changed`. Server
  keeps `connectionModel` (default `profile.model.id`) and derives
  `connectionProfile` with the overridden `model.id` on each message. `set_model`
  rejects ids whose `base_url` differs from the active profile with a `notice`
  explaining that switching provider requires a different profile, and rejects
  unknown ids with a warning notice while still applying them (fallback pricing).
- **Dependencies**: 0.2, 2.1
- **Acceptance Criteria**: switch takes effect on the next turn without dropping
  the session; `models` marks exactly one entry as `current`
- **Validation**: `tests/server-model-switch.test.ts` — drive a WS client through
  `hello` → `models_list` → `set_model` → assert `model_changed` and that the
  next loop invocation receives the new id

### Task 4.2: Context window follows the model
- **Location**: `src/server/index.ts`, `src/loop/context-manager.ts`
- **Description**: When no explicit `context_window.max_tokens` is set in the
  profile, condensation and the `stats.context_window` field use the registry's
  `context_window` for the *active* model. An explicit profile value still wins.
- **Dependencies**: 4.1
- **Acceptance Criteria**: switching from a 200k to a 128k model lowers the
  reported window; an explicit profile setting is unaffected
- **Validation**: `tests/context-manager.test.ts` addition

### Task 4.3: `/model` command + picker
- **Location**: `tui/internal/ui/tab_model.go` (new), `slash.go`, `prefs`
- **Description**: A `bubbles/list` of models: label, id, context window, price
  per Mtok, tags; unavailable entries dim with their reason and are
  non-selectable. Filtering enabled (`/` inside the list). A "custom id…" row
  opens a `textinput` for arbitrary ids. Selection sends `set_model` and
  persists to prefs. On session start the TUI applies the remembered model for
  the profile automatically (and toasts once that it did).
- **Dependencies**: 4.1, 0.3
- **Acceptance Criteria**: list renders at 60 columns without truncating the id;
  filtering matches on both label and id; remembered model is re-applied on boot
- **Validation**: `go test ./internal/ui/ -run ModelTab`

---

## Sprint 5: Tab overlay + context rail

**Goal**: One `Tab` press reaches model, approval, and skills. `^B` reveals a
live information rail.

**Demo/Validation**: `Tab` opens the overlay on the last-used tab; `←`/`→` and
`Tab` cycle tabs; `esc` closes and returns focus to the composer. `^B` slides in
the rail showing the running tool with elapsed time, todos, session facts, and
context usage. `/model` and `/approval` now open their respective tabs.

> **No History tab** — see Non-goals. `resume` transfers no message history, so
> a session picker would resume into a blank transcript. The Skills tab (Sprint
> 6) is the third tab.

### Task 5.1: Overlay shell
- **Location**: `tui/internal/ui/tabs.go` (new)
- **Description**: A modal panel (≈ 80% × 70%, min 60×18) drawn with
  `ui.Center`, with a tab strip (`Model · Approval · Skills`), an active-tab
  underline, a per-tab footer hint line, and focus trapping — while open, only
  the overlay sees keys except `ctrl+c`. Remembers the last active tab in prefs.
  Below 60 columns it renders full-screen instead of centered. The tab list is
  data-driven so a fourth tab can be added without touching the shell.
- **Dependencies**: 0.4, 0.5
- **Acceptance Criteria**: focus trap verified (typing does not reach the
  composer); `esc` restores prior focus and cursor position; resizing while open
  re-lays out without artefacts
- **Validation**: `teatest` — open, cycle all three tabs, close, assert composer
  content unchanged

### Task 5.2: Approval tab
- **Location**: `tui/internal/ui/tab_approval.go` (new)
- **Description**: Four rows with one-line explanations and, for each, a
  concrete example of what it would and wouldn't ask about. Current mode marked,
  and `danger` labelled as the default. Selecting sends `set_approval_mode` and
  persists. `yolo` requires a second confirming keypress and renders with a red
  warning strip.
- **Dependencies**: 5.1, 2.7
- **Acceptance Criteria**: selection round-trips to the server; YOLO cannot be
  set with a single accidental `enter`
- **Validation**: `go test ./internal/ui/ -run ApprovalTab`

### Task 5.3: Context rail
- **Location**: `tui/internal/ui/rail.go` (new)
- **Description**: A 34-column right panel toggled by `^B`, auto-hidden below
  100 columns, state persisted in prefs. Sections: **ACTIVE** (running tool +
  live elapsed), **TODOS** (from `todos`), **SESSION** (profile · model ·
  approval mode · session id · project), **CONTEXT** (gauge, filled in 7.2),
  **ARTIFACTS** (titles; `enter` expands inline). Transcript width recomputes
  when it opens or closes.
- **Dependencies**: 1.4
- **Acceptance Criteria**: toggling never corrupts the transcript layout; at
  99 columns the rail refuses to open and says why
- **Validation**: `go test ./internal/ui/ -run Rail` golden at 120 and 99 columns

### Task 5.4: Artifact renderers
- **Location**: `tui/internal/ui/artifacts.go` (new)
- **Description**: Real renderers for `metrics` (label/value grid), `table`
  (aligned columns with header rule), `diff` (`+`/`-` coloured lines), and
  `terminal` (monospace block with a dim frame). Labeled graceful fallback for
  `bar`, `line`, `filetree`, `doc`, `research` — title, icon, meta, and a
  "not rendered in terminal" note. Malformed `data` renders the fallback rather
  than panicking.
- **Dependencies**: 5.3
- **Acceptance Criteria**: each of the 9 kinds renders something sensible;
  `nil`/garbage `data` never panics
- **Validation**: `go test ./internal/ui/ -run Artifacts` — one golden per kind

---

## Sprint 6: Skills — review, edit, promote, mine

**Goal**: The agent's proposed skills stop being invisible files. You can see
them, fix them, promote them, and ask for new ones on demand.

**Demo/Validation**: `/skills mine` → progress toast → proposals appear in the
Skills tab → open one, fix its description, save, promote → confirm the file
lands in `.agents/skills/<name>/SKILL.md` → restart the server and see it in the
skill index.

### Task 6.1: Skills management module
- **Location**: `src/skills/manage.ts` (new)
- **Description**: `listProposed(profile)` (reads `<artifact_dir>/skills/_proposed/*/SKILL.md`,
  parsing frontmatter with gray-matter), `listInstalled()` (delegates to
  `loadAllSkills(resolveSkillsDirs())`), `readSkill`, `writeSkill` (validates
  that frontmatter has non-empty `name` and `description`, and that frontmatter
  `name` matches the directory), `promoteSkill(name)` (moves the directory to
  `<git-root>/.agents/skills/<name>/`, refusing to overwrite an existing skill
  unless `force`), `discardSkill(name)` (moves to `_discarded/`, never a hard
  delete).
- **Dependencies**: none
- **Acceptance Criteria**:
  - name validated against `^[a-z0-9][a-z0-9-]{0,63}$`; `..`, absolute paths,
    and path separators rejected with a clear error
  - every resolved path is asserted to stay inside its expected root
  - promote is atomic-ish: on failure nothing is left half-moved
- **Validation**: `tests/skills-manage.test.ts` — includes explicit traversal
  attempts (`../../etc`, `foo/bar`, `/abs`) and a collision case

### Task 6.2: Skills WS handlers + mine-on-demand
- **Location**: `src/server/index.ts`, `src/types.ts`, `tui/internal/protocol/msg.go`
- **Description**: Handle `skills_list`, `skill_get`, `skill_save`,
  `skill_promote`, `skill_discard`, `skills_mine`. `skills_mine` invokes
  `improver.mineSkills([session])` immediately, sends an interim `notice`
  ("mining…"), then a fresh `skills` list; it is rejected with a notice when
  `improvement.enabled` is false or the session has fewer than two user turns.
  Concurrent mine requests are coalesced (one in flight per connection).
- **Dependencies**: 6.1
- **Acceptance Criteria**: every handler replies exactly once, including on
  error; a failing mine sends an `error`-level notice rather than hanging
- **Validation**: `tests/server-skills.test.ts` — WS-driven, one case per handler
  plus a double-mine coalescing case

### Task 6.3: Skills tab — list and preview
- **Location**: `tui/internal/ui/tab_skills.go` (new)
- **Description**: Two-pane tab: left a list grouped `PROPOSED` / `INSTALLED`
  (name, description, age; proposed rows marked amber), right a scrollable
  preview of the SKILL.md with frontmatter styled distinctly from the body.
  Footer keys: `e` edit · `p` promote · `d` discard · `m` mine · `r` refresh.
- **Dependencies**: 5.1, 6.2
- **Acceptance Criteria**: empty state explains where proposals come from and
  how to trigger mining; preview scrolls independently of the list
- **Validation**: `go test ./internal/ui/ -run SkillsTab`

### Task 6.4: Skills tab — inline edit
- **Location**: `tui/internal/ui/tab_skills.go`
- **Description**: `e` swaps the preview pane for a full `textarea` seeded with
  the file content. `ctrl+s` sends `skill_save`; `esc` prompts to discard
  changes if dirty. Client-side frontmatter validation before sending (must
  start with `---`, must contain `name:` and `description:`), with the error
  shown inline rather than as a toast.
- **Dependencies**: 6.3
- **Acceptance Criteria**: unsaved-changes guard fires; saving refreshes the
  preview from the server's echoed content, not from local state
- **Validation**: `go test ./internal/ui/ -run SkillsEdit`

### Task 6.5: Promote / discard / mine actions
- **Location**: `tui/internal/ui/tab_skills.go`, `slash.go`
- **Description**: `p` promotes after a confirm line showing the destination
  path; `d` discards after confirm; `m` mines with a spinner in the tab header.
  Add `/skills` (opens the tab) and `/skills mine` (opens + mines). Post-promote
  toast states that the skill takes effect on the next server start.
- **Dependencies**: 6.4
- **Acceptance Criteria**: destination path is shown before promoting; discard
  is recoverable and the toast says where it went
- **Validation**: manual demo from the sprint header + `go test -run SkillsActions`

---

## Sprint 7: Cost & context intelligence

**Goal**: You always know how full the context is, what the session has cost,
and what the last turn actually did.

**Demo/Validation**: The rail's context gauge fills and shifts green→amber→red
as the conversation grows; crossing 80% raises a one-time warning toast
suggesting `/compact`; running `/compact` visibly drops the gauge. Each finished
agent turn shows `3 tools · 1.4k tok · 6.2s · $0.011`.

### Task 7.1: Report live context occupancy
- **Location**: `src/loop/context-manager.ts`, `src/loop/agent-loop.ts`, `src/types.ts`
- **Description**: Export `estimateTokens(messages)` from `context-manager.ts`
  and include `context_tokens` on every `stats` message. Add a `compact` client
  message that force-runs `maybeCondenseMessages` with the threshold ignored and
  replies with a fresh `stats` plus a notice reporting tokens saved.
- **Dependencies**: 4.2
- **Acceptance Criteria**: `context_tokens` is monotonic within a turn and drops
  after compaction; `compact` on an already-small session is a no-op with a
  notice, not an error
- **Validation**: `tests/context-manager.test.ts` addition

### Task 7.2: Context gauge
- **Location**: `tui/internal/ui/gauge.go` (new), `rail.go`, `statusbar.go`
- **Description**: A block-character bar (`█▉▊…`) with a colour ramp — green
  < 60%, amber 60–85%, red > 85% — plus `used / window` and a percentage. Full
  version in the rail, compact `▁▃▅ 62%` version in the status bar. Crossing 80%
  fires one warning toast per session suggesting `/compact`.
- **Dependencies**: 7.1, 5.3
- **Acceptance Criteria**: gauge is correct at 0%, 50%, 99%, and > 100%
  (clamps and turns red); the warning fires exactly once per session
- **Validation**: `go test ./internal/ui/ -run Gauge` — table test over ratios

### Task 7.3: Spend ticker + per-turn breakdown
- **Location**: `tui/internal/ui/statusbar.go`, `transcript.go`
- **Description**: Status bar shows session cost, animated by interpolating
  toward the newest `stats` value over ~300ms instead of snapping. Each closed
  agent turn's footer shows real numbers by diffing the `stats` snapshots taken
  at turn start and turn end: `▌ N tools · X tok · Ys · $Z`.
- **Dependencies**: 7.1
- **Acceptance Criteria**: diffed per-turn totals sum to the session total
  (± rounding); the animation never displays a decreasing cost
- **Validation**: `go test ./internal/ui/ -run TurnFooter`

### Task 7.4: Token-rate sparkline
- **Location**: `tui/internal/ui/sparkline.go` (new), `rail.go`
- **Description**: A 20-sample ring buffer of tokens/second sampled on the
  spinner tick, rendered as `▁▂▃▄▅▆▇█` in the rail's ACTIVE section while a turn
  is running, fading to dim when idle.
- **Dependencies**: 5.3
- **Acceptance Criteria**: renders with 0, 1, and 20 samples; no division by
  zero on the first tick
- **Validation**: `go test ./internal/ui/ -run Sparkline`

---

## Sprint 8: Input superpowers

**Goal**: The composer becomes the fastest surface in the app.

**Demo/Validation**: Type `/mo` → inline completion to `/model`. Type `@src/lo`
→ file suggestions → `Tab` completes. `!ls -la` runs a shell command and inserts
the output as context. `#remember X` writes a memory. Type while the agent is
working → the message queues and sends automatically when the turn ends.

### Task 8.1: Slash autocomplete
- **Location**: `tui/internal/ui/slash.go`, `composer.go`
- **Description**: A command registry (`/model`, `/approval`, `/skills`,
  `/compact`, `/theme`, `/clear`, `/help`, `/quit`) with descriptions.
  Typing `/` at position 0 opens a suggestion popup above the composer, filtered
  as you type. **Key precedence for `Tab`:** if a completion popup is open →
  accept the completion; else → open the overlay. Document this in the help
  screen; it is the one non-obvious binding.
- **Dependencies**: 2.7
- **Acceptance Criteria**: the precedence rule is unit-tested in both states;
  `esc` closes the popup without clearing typed text
- **Validation**: `go test ./internal/ui/ -run SlashComplete`

### Task 8.2: `@` file mentions
- **Location**: `tui/internal/ui/mention.go` (new)
- **Description**: `@` followed by a path fragment triggers a suggestion popup
  backed by a lazily-built, debounced (120ms) file index rooted at
  `working_dir`, respecting `.gitignore` and skipping `node_modules`/`.git`,
  capped at 20k entries. Accepting inserts the repo-relative path. The message
  text is sent as-is — the model sees the path and can `Read` it.
- **Dependencies**: 8.1
- **Acceptance Criteria**: indexing a large repo does not block the render loop
  (runs in a `tea.Cmd`); the cap is enforced with a dim "showing first 20" note
- **Validation**: `go test ./internal/ui/ -run Mention` against a fixture tree

### Task 8.3: `!` bash passthrough and `#` memory
- **Location**: `tui/internal/ui/model.go`, `src/server/index.ts`
- **Description**: A line starting with `!` runs locally via `exec.Command` in
  `working_dir` (never through the agent), rendering output as a distinct
  `local` transcript entry with the exit code, and offers `enter` to send that
  output to the agent as context. A line starting with `#` sends a message that
  instructs a `MemoryWrite`, rendered as a compact "remembered" entry.
  `!` respects a 30s timeout and is disabled when the approval mode is `strict`
  (with an explanatory notice).
- **Dependencies**: 8.1
- **Acceptance Criteria**: `!` output is clearly marked as local, not agent
  output; a hanging command can be killed with `esc`
- **Validation**: `go test ./internal/ui/ -run LocalExec` with a fake runner

### Task 8.4: Message queueing while busy
- **Location**: `tui/internal/ui/model.go`, `composer.go`
- **Description**: Submitting while a turn is running appends to a queue instead
  of being dropped. Queued messages render as dim ghost bubbles below the
  transcript with a `queued ⏳` marker and a count in the status bar; `ctrl+x`
  clears the queue. On `session_end`, the head of the queue is sent
  automatically.
- **Dependencies**: 1.4
- **Acceptance Criteria**: order is preserved; cancelling a turn (`esc`) keeps
  the queue and asks whether to send or hold
- **Validation**: `go test ./internal/ui/ -run Queue`

---

## Sprint 9: Delight & motion

**Goal**: The thing people screenshot.

**Demo/Validation**: Launch → a short wordmark reveal resolves into the ready
state. Streaming shows a blinking block cursor. Sections ease open. Different
tool families spin differently. A finished long turn pulses green and rings the
terminal bell. `/theme` cycles three complete looks.

### Task 9.1: Boot splash
- **Location**: `tui/internal/ui/splash.go` (new)
- **Description**: ~700ms animated sequence — the `◆ harness` wordmark
  character-reveals, a dim line reports each boot step (`server ✓`, `ws ✓`,
  `profile <name> ✓`, `skills N ✓`), then it collapses into the top bar. Skipped
  entirely with `--no-splash`, when `TERM=dumb`, or when stdout is not a TTY;
  any keypress skips it immediately.
- **Dependencies**: 1.1
- **Acceptance Criteria**: never delays the first usable frame by more than
  700ms; a boot failure aborts the splash and shows the error screen
- **Validation**: `teatest` — assert the splash resolves and the composer is
  focused afterwards

### Task 9.2: Typewriter cursor + section easing
- **Location**: `tui/internal/ui/transcript.go`, `section.go`
- **Description**: A block cursor (`▌`) blinking at 530ms trails the streaming
  text and disappears on turn end. Section expand/collapse animates over 3
  frames by revealing body lines progressively, driven by the existing tick —
  no new timer. Both are disabled when `--no-motion` is passed or `NO_COLOR` is
  set.
- **Dependencies**: 1.4
- **Acceptance Criteria**: animation adds no allocation per frame beyond the
  render itself; `--no-motion` produces byte-identical output to today's goldens
- **Validation**: existing `transcript_test.go` goldens must pass unchanged with
  motion disabled

### Task 9.3: Spinner personalities
- **Location**: `tui/internal/ui/spinner.go`
- **Description**: Map tool families to distinct frame sets — filesystem
  (braille), shell (`▖▘▝▗`), network/MCP (`◜◝◞◟`), thinking (pulsing `·∘○∘`),
  delegate (`⠁⠂⠄⡀⢀⠠⠐⠈`). One shared tick drives all of them via frame index
  modulo each set's length.
- **Dependencies**: 1.4
- **Acceptance Criteria**: unknown tools fall back to braille; all sets are the
  same display width (1 cell)
- **Validation**: `go test ./internal/ui/ -run Spinner` — asserts width 1 for
  every frame of every set

### Task 9.4: Completion pulse + OSC-9 notify
- **Location**: `tui/internal/ui/model.go`, `notice.go`
- **Description**: On `session_end`, the turn footer pulses from accent to its
  resting colour over 4 frames. If the turn took > 20s **and** the terminal is
  unfocused (best-effort focus tracking via `tea.WithReportFocus`), emit an
  OSC-9 desktop notification and a single bell. Suppressed by `--no-notify`.
- **Dependencies**: 9.2
- **Acceptance Criteria**: no bell for short turns; no bell when focused; the
  OSC sequence is not emitted to a non-TTY
- **Validation**: `go test ./internal/ui/ -run Notify` — asserts the escape
  sequence is present/absent per condition

### Task 9.5: Themes + `/theme`
- **Location**: `tui/internal/ui/theme.go`, `slash.go`, `prefs`
- **Description**: Promote the palette to a `Theme` struct with three presets:
  `ember` (current), `mono` (greyscale + single accent, for screenshots and
  limited terminals), `neon` (high-contrast purple/cyan). `/theme` cycles or
  takes a name; selection persists in prefs. All styles resolve through the
  active theme rather than package-level vars.
- **Dependencies**: 0.3
- **Acceptance Criteria**: switching re-renders everything with no stale
  colours; goldens run against `ember` explicitly so theme changes don't churn
  test fixtures
- **Validation**: `go test ./internal/ui/ -run Theme`

---

## Sprint 10: Distribution, docs, and hardening

**Goal**: Shippable. Cross-compiled binaries, current docs, and a golden test
suite that catches regressions.

**Demo/Validation**: `pnpm build:bin` produces Go binaries for macOS
arm64/x64 and Linux x64; `install.sh` fetches them; `docs-site/cli-tui.md`
matches reality; `go test ./...` and `pnpm test` both green.

### Task 10.1: Go cross-compilation in `build:bin`
- **Location**: `package.json`, `scripts/release.mjs`, `install.sh`
- **Description**: Replace the removed bun `harness-tui*` targets with
  `GOOS`/`GOARCH` builds producing `bin/harness-tui-{darwin-arm64,darwin-amd64,linux-amd64}`,
  with `-ldflags "-s -w -X main.version=<pkg version>"`. Update the release
  script's asset list and `install.sh`'s platform mapping.
- **Dependencies**: all prior sprints
- **Acceptance Criteria**: `--version` on each binary prints the package.json
  version; `install.sh` picks the right asset on macOS arm64
- **Validation**: run `pnpm build:bin` and execute each darwin binary's
  `--version`

### Task 10.2: Keybinding help screen
- **Location**: `tui/internal/ui/help.go` (new)
- **Description**: `?` opens a full-screen cheat sheet generated from the
  `KeyMap` (so it cannot drift), grouped by Composer / Transcript / Overlay /
  Global, including the `Tab` precedence rule and the slash-command list.
- **Dependencies**: 0.5, 8.1
- **Acceptance Criteria**: every binding in `KeyMap` appears exactly once
- **Validation**: `go test ./internal/ui/ -run Help` — reflection test asserting
  full coverage

### Task 10.3: `teatest` end-to-end goldens
- **Location**: `tui/internal/ui/app_test.go` (new)
- **Description**: Scripted sessions against a fake WS server: (a) message →
  stream → tool → end; (b) tool prompt → approve; (c) input request →
  multi_select; (d) overlay open → each tab → close; (e) disconnect → reconnect.
  Colour profile forced to ASCII, motion disabled, fixed terminal size.
- **Dependencies**: all prior sprints
- **Acceptance Criteria**: deterministic across runs; failures print a readable
  diff
- **Validation**: `go test ./internal/ui/ -run App`

### Task 10.4: Documentation
- **Location**: `docs-site/cli-tui.md`, `CLAUDE.md`, `docs/ROADMAP.md`, `README.md`
- **Description**: Rewrite the CLI/TUI doc for the Go client: keys, slash
  commands, approval modes (with the `deny` precedence rule stated), model
  switching and its same-provider constraint, the skills review workflow,
  themes, and flags (`--no-splash`, `--no-motion`, `--no-notify`, `--profile`,
  `--port`). Update `CLAUDE.md`'s key-modules table (`src/tui/` → `tui/`, new
  `src/safety/`, `src/models/`, `src/skills/manage.ts`). Add ROADMAP item #14
  "TUI revamp" with a shipped list.
- **Dependencies**: 10.1
- **Acceptance Criteria**: no doc references `src/tui/`, Ink, or React
- **Validation**: `grep -ri "ink\b\|src/tui" docs docs-site CLAUDE.md README.md`

### Task 10.5: Profile examples for the new blocks
- **Location**: `profiles/coding.yaml`, `profiles/security.yaml`
- **Description**: Add a commented `safety:` block to `coding.yaml` and a
  strict, fully-specified one to `security.yaml` demonstrating a cheap
  classifier model and a short cache TTL.
- **Dependencies**: 3.1
- **Acceptance Criteria**: both profiles still load; `pnpm test` green
- **Validation**: `pnpm test -- profile`

---

## Testing Strategy

| Layer | Tool | What it covers |
|-------|------|----------------|
| Protocol | `go test ./internal/protocol` + `pnpm typecheck` | JSON round-trip for every new message; TS/Go shape parity |
| Server logic | vitest | ACL matrix, classifier branches, cache TTL, skills path safety, model switch, context reporting |
| Go units | `go test ./internal/...` | overlay compositing, prefs, gauge, sparkline, spinner widths, keymap collisions |
| Go views | golden strings, ASCII colour profile | transcript, bubbles, bars, modals, tabs, rail, artifacts at 40/80/200 cols |
| Go e2e | `teatest` | five scripted sessions (Task 10.3) |
| Manual | sprint demo checklists | animation feel, resize behaviour, real provider latency |

**Per-sprint gate**: `pnpm typecheck && pnpm test && (cd tui && go test ./...)`
plus the sprint's demo checklist. No sprint merges red.

**Security-specific tests that must exist** (these are the ones worth being
strict about):
- profile `deny` + `yolo` mode → still `deny` (Task 2.2)
- classifier failure/timeout → `danger` (Task 3.3)
- skill name traversal attempts rejected (Task 6.1)

---

## Potential Risks & Gotchas

**G1 — Bubble Tea v1 vs v2 API drift.** Current Charm documentation (including
what Context7 returns) targets **v2**: import paths `charm.land/bubbletea/v2`,
`charm.land/bubbles/v2`, and `tea.KeyPressMsg`. This repo pins **v1**
(`github.com/charmbracelet/bubbletea v1.3.10`, `bubbles v1.0.0`) and uses
`tea.KeyMsg`. Copy-pasting v2 snippets will not compile. *Mitigation*: stay on
v1 for this plan — Tasks 0–7 are already written against it and a v2 migration
is a separate effort. Verify any snippet against `go doc` for the pinned
version before using it.

**G2 — No z-index in Bubble Tea v1.** Overlays must be composited manually,
which is why Task 0.4 comes first and is tested independently. Getting ANSI-aware
slicing wrong shows up as colour bleed across the whole screen, and it is much
cheaper to catch in a unit test than in a modal.

**G3 — Classifier latency and cost.** Even with the prefilter, a chatty session
in `danger` mode can make many classification calls. *Mitigation*: prefilter +
persistent cache + `max_tokens: 64` + telemetry (`kind: 'safety'`) so real cost
is measurable. If it proves expensive in practice, the fallback is to promote
frequently-classified patterns into the static table.

**G3b — `danger` is the default, so classification is on by default.** From
Sprint 3, a fresh install makes model calls for ambiguous tool calls without
anyone opting in. *Mitigation*: Sprint 2 ships `danger` backed by free static
rules only, so the default is useful before it is ever costly; Task 3.5 discloses
the model stage once per profile the first time it fires; `safety.enabled: false`
and `/approval bash` are both documented opt-outs.

**G4 — Fail-closed is annoying but correct.** A classifier timeout prompts the
user. Offline users in `danger` mode will be prompted for everything ambiguous.
*Mitigation*: the timeout notice explicitly names `bash` mode as the offline
alternative.

**G5 — Cross-provider model switching.** Changing `model.id` does not change
`base_url` or `api_key_env`. Selecting an OpenAI model on an Anthropic profile
would fail at request time with an opaque error. *Mitigation*: Task 4.1 marks
cross-provider entries `available: false` with a reason, and the server rejects
them with an actionable notice.

**G6 — The Ink deletion gap.** Between Sprint 0 and the end of Sprint 1 there is
no graphical TUI. *Mitigation*: `pnpm dev:cli` still works; Sprint 1 is
deliberately scoped to the shortest path back to a usable client. Do not start
Sprint 0 immediately before needing the TUI for other work.

**G7 — Model switch mid-turn.** `agent-loop` re-reads `profile.model.id` every
iteration, so a switch during a multi-tool turn changes model between
iterations. This is harmless for message compatibility but makes per-turn cost
attribution slightly fuzzy. *Mitigation*: accepted; the per-turn footer is
computed from `stats` diffs, which stay correct because `estimateCost` runs per
iteration with the then-current model.

**G8 — Skill promotion target.** `promoteSkill` writes to the git repo root's
`.agents/skills/`, which is a **checked-in directory** — promotion produces a
working-tree change the user may not expect. *Mitigation*: the confirm line
shows the exact destination path, and the post-promote toast says it is an
uncommitted change.

**G9 — Skills take effect only on server restart.** `loadAllSkills` runs once at
server startup, so a promoted skill is not visible to the running session.
*Mitigation*: stated in the toast. A hot-reload is possible but out of scope.

**G10 — `!` shell passthrough.** This runs commands on the user's machine
directly from the composer. *Mitigation*: it is user-typed only (never
model-triggered), disabled in `strict` mode, timeout-bounded, and its output is
visually marked as local rather than agent output.

**G11 — Prefs vs. profile precedence confusion.** A remembered approval mode
silently overriding a carefully-written profile ACL would be a nasty surprise.
*Mitigation*: modes never relax a profile `deny`, and the TUI toasts once on
boot when it applies a remembered mode or model.

**G12 — Golden-test churn.** Motion and themes both change rendered output.
*Mitigation*: goldens run with motion disabled and the `ember` theme pinned
(Tasks 9.2, 9.5).

**G13 — Terminal width floor.** Rail + overlay + bubbles all assume room.
*Mitigation*: every layout task specifies 40-column behaviour, and the rail
refuses to open below 100 columns with an explanation.

---

## Rollback Plan

- **Per sprint**: each sprint is a branch merged only when its gate passes;
  `git revert` of the merge commit restores the prior state. Sprints 2–7 each
  add protocol variants additively — an older client ignores unknown server
  messages and never sends the new client messages, so a partial rollback of the
  Go client alone is safe.
- **Server-side kill switches**: `safety.enabled: false` disables the classifier
  (danger mode then falls back to `bash`-mode behaviour); omitting the new WS
  handlers degrades to the previous fixed-model, profile-ACL behaviour.
- **Full retreat to Ink**: `git revert` of Task 0.1's commit restores
  `src/tui/`, its tests, and the Ink dependencies. This is the reason Task 0.1
  is a single isolated commit and not folded into other work.

---

## Deferred (explicitly out of scope)

**Session history + resume UI.** Needs a server-side `session_transcript`
message that reconstructs prior turns from `session.messages` and
`session.tool_calls` and sends them alongside `session_resumed`. Once that
exists, the History tab is a small addition — Task 5.1's tab strip is
data-driven precisely so it slots in without touching the overlay shell.

**Transcript power tools** — scrollback search, jump-to-turn, OSC-52 copy of the
last code block, markdown transcript export, and a real inline `+/-` diff
renderer for `Write`/`Edit`. The artifact `diff` renderer in Task 5.4 covers
the agent-emitted case; live edit diffs are a natural follow-up.
