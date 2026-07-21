# Bubble Tea TUI — Design

> Date: 2026-07-21
> Status: Approved (design)
> Replaces: `src/tui/` (Ink/React)

## Goal

Replace the Ink (React/TypeScript) TUI with a Go + Bubble Tea client. The new
TUI is a functional, general-agentic control surface — in the spirit of Claude
Code / opencode, but for *any* agentic run, not just coding. It uses color,
indentation, and collapsible sections to make **what is active** and **what is
done** legible at a glance.

Non-goals: no changes to the server, agent loop, MCP, skills, memory, or the
WebSocket protocol. This is a pure client swap.

## Decisions (from brainstorming)

- **Architecture:** New Go client speaking the existing JSON protocol; the Ink
  TUI (`src/tui/`) is deleted in the same effort.
- **Server boot:** Go binary auto-spawns the Node server, matching today's
  `bootstrap.ts` behavior.
- **Layout:** Hybrid — single-stream transcript at full width by default, with a
  toggleable right-hand context rail (`^B` / `Tab`).
- **v1 scope:** Full parity with the Ink TUI before deletion.

## 1. Architecture

New Go module `tui/` at the repo root (replaces the deleted `src/tui`).

Stack:

- **Bubble Tea** — Elm-style Model/Update/View loop
- **Lipgloss** — styling (ports the existing `C` palette)
- **Bubbles** — `textinput`, `list`, `viewport`
- **gorilla/websocket** — WS transport

The TUI is a pure client. The Node server, agent loop, MCP integration, skills,
memory, and the `ClientMessage`/`ServerMessage` protocol are unchanged.

```
tui/
  go.mod
  main.go                # flags, --version, bootstrap server, run program
  internal/
    protocol/msg.go      # ClientMessage/ServerMessage structs mirror src/types.ts (json tags)
    ws/client.go         # connect + 1s-backoff reconnect; read loop -> tea.Msg via p.Send()
    server/boot.go       # /health probe, spawn, SIGTERM->SIGKILL cleanup
    ui/
      model.go           # root Model: Init/Update/View, state, msg routing
      theme.go           # Lipgloss styles mirroring src/tui/theme.ts `C`
      transcript.go      # turn grouping + rendering
      section.go         # collapsible section state + transitions
      spinner.go         # braille spinner tick
      composer.go        # input (Bubbles textinput)
      topbar.go
      statusbar.go
      rail.go            # context rail (active/todos/session/artifacts)
      palette.go         # command palette (Bubbles list + modes)
      modals.go          # tool approval + input request
      artifacts.go       # artifact widget renderers
```

### Message flow

The WS read loop runs in a goroutine and pushes each decoded `ServerMessage`
into the Bubble Tea program via `p.Send()`, which surfaces as a `tea.Msg` in
`Update`. Outbound `ClientMessage`s are written from `Update` through the client.
Spinner animation is driven by a `tea.Tick`.

## 2. State / visual language (creative core)

Lifecycle is encoded by glyph + color; nesting by indentation.

| State                 | Glyph            | Color               |
| --------------------- | ---------------- | ------------------- |
| running               | `⣾` braille spin | accent amber, bold  |
| done ok               | `✓`              | green (dims when scrolled past) |
| error                 | `✗`              | red                 |
| queued / pending      | `◦`              | faint               |
| collapsed / expanded  | `▸` / `▾`        | dim                 |

Indentation levels:

- **L0** — turn header (`▌ you` / `◆ harness`)
- **L1** — activities: tool calls, thinking, subagent dispatch
- **L2** — rolled-up detail: tool output, diff body — dim, in a left-border
  gutter, hidden until the section is expanded

**Sections are the unit of rendering.** Every activity — tool call, thinking,
MCP call, web fetch, subagent dispatch — renders identically:

```
<glyph> <name>  <arg-summary>  <metric>  <chevron>
```

with the body collapsed by default. This uniformity is what makes the TUI
general-agentic rather than coding-specific. A finished agent turn collapses to
a footer summary:

```
▌ 3 tools · 1.2k tok · 4.1s
```

`^O` toggles all section bodies; selecting a section and pressing `enter`
toggles that one.

## 3. Layout (hybrid)

Single-stream transcript at full width by default. `^B` (or `Tab`) slides in a
right-hand **context rail** (~34 columns):

- **ACTIVE** — currently running tool + elapsed time
- **TODOS** — `✓ / ▸ / ◦` list, fed by the `todos` server message
- **SESSION** — profile · session# · project · tokens in/out · cost
- **ARTIFACTS** — list; `enter` expands inline

Carried over from the Ink TUI:

- **TopBar** — wordmark `◆ harness`, profile, session#, active project,
  ready/working dot, clock, palette hint
- **StatusBar** — RUN/RDY badge, conv/work focus, tokens, tools toggle, theme

Theme: the existing `C` palette (`src/tui/theme.ts`) is ported to Lipgloss
styles in `theme.go` (bg `#0b0c0e`, text `#e7e9ee`, accent amber `#f1a44d`,
info blue `#6cb6d9`, ok green `#74c79a`, error `#e87f8d`).

## 4. Feature parity map

Every Ink feature must exist before `src/tui/` is deleted:

| Feature                | Server msgs                                   | Notes |
| ---------------------- | --------------------------------------------- | ----- |
| Streaming chat         | `token`                                        | grouped into turns |
| Tool sections          | `tool_start`, `tool_end`                       | collapsible |
| Tool approval          | `tool_prompt` → `tool_approve` / `tool_deny`   | `[y]/[n]` modal |
| Input request          | `input_request` → `input_response`             | text / select / multi_select |
| Todos                  | `todos`                                         | rail + inline panel |
| Artifacts              | `artifacts`                                     | see below |
| Command palette        | `project_*`, `session_list`, `sessions`, `projects`, `resume` | Bubbles `list`, modes mirror `palette-modes.ts` |
| Stats                  | `stats`                                         | tokens + cost |
| Session lifecycle      | `session_ready`, `session_end`, `session_resumed` | |
| Disconnect handling    | (transport)                                    | banner + 1s-backoff reconnect |

**Artifacts:** the Ink `GenWidget` renderers are stubs (they render placeholder
text). The Go version provides real renderers for `metrics`, `table`, `diff`,
and `terminal`, with a graceful labeled fallback for `bar`, `line`, `filetree`,
`doc`, `research`. This is ≥ parity.

## 5. Server bootstrap

`internal/server/boot.go` mirrors `src/tui/bootstrap.ts`:

1. `GET http://localhost:$PORT/health` — if 200, use the running server.
2. Otherwise spawn:
   - **dev** (`src/server/index.ts` exists at repo root): `tsx src/server/index.ts`
   - **prod**: the `harness-server` binary beside the executable
3. Poll `/health` for ≤10s; error out with a PATH/profile hint on timeout.
4. On exit, `SIGTERM` then `SIGKILL` after 2s if still alive.

`HARNESS_PORT` (default `7337`) and `HARNESS_USER` are honored, matching the Ink
client's `hello` handshake.

## 6. Build / distribution

- Delete `src/tui/`.
- Remove `ink`, `react`, `ink-text-input`, `@inkjs/ui` from `dependencies` and
  the React/Ink `devDependencies` in `package.json`.
- `pnpm dev:tui` → `go run ./tui`.
- `build:bin` → replace the bun-compiled `harness-tui*` targets with `go build`
  cross-compilation producing `bin/harness-tui-{linux,macos}-{x64,arm64}`
  (via `GOOS`/`GOARCH`).
- Update `install.sh` and `scripts/release.mjs` to ship the Go binaries.

**Tradeoff (accepted):** this introduces a Go toolchain build dependency into an
otherwise pnpm/Node repo.

## 7. Error handling

- **WS disconnect:** show a banner, auto-reconnect with 1s backoff (matches Ink).
- **Server spawn failure:** error screen with the same message as `bootstrap.ts`
  (names the command and points at PATH / profile validity).
- **Malformed server message:** ignore (optionally log to a debug sink); never
  crash the render loop.

## 8. Testing

Go tests:

- `protocol` — JSON round-trip against sample `ServerMessage` / `ClientMessage`
  payloads (guards against schema drift from `src/types.ts`).
- `section` — state transitions (queued → running → done/error; collapse/expand).
- `transcript` — golden renders with Lipgloss color disabled.
- `palette` — filtering and mode transitions.
- `server` — health-probe + spawn logic via `httptest`.
- `ui` — Bubble Tea view goldens via `teatest`.

## Open questions

None outstanding. The Go-toolchain build dependency (§6) is acknowledged and
accepted.
