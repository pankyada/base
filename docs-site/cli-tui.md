# CLI & TUI

## Starting the server

```bash
pnpm dev                          # default profile: ~/.harness/profiles/coding.yaml
pnpm dev profiles/devops.yaml     # explicit profile path
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HARNESS_PORT` | `7337` | WebSocket + REST server port |
| `HARNESS_API_KEY` | _(none)_ | Optional bearer token for REST API (`POST /run`, `POST /stream`) |

## TUI

```bash
pnpm tui                         # Go/Bubble Tea TUI; starts/reuses server
pnpm dev:tui                     # development alias
cd tui && go build -o ../bin/harness-tui .
```

Auto-starts the server if one isn't running, waits for health, then opens the terminal UI. Quit with `Ctrl+C` — the server it started shuts down with it. If a server is already running on `HARNESS_PORT`, it is reused and left running on exit.

### TUI environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HARNESS_PORT` | `7337` | Server to connect to |
| `HARNESS_PROFILE` | `coding` | Profile path selected by the server |
| `HARNESS_USER` | system username | User identity (scopes memory + sessions) |

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+C` | Quit |
| `Enter` / `Shift+Enter` | Send / newline |
| `Esc` | Cancel turn or close modal |
| `Ctrl+O` | Expand/collapse tools |
| `Tab` | Accept open completion; otherwise open/cycle Model · Approval · Skills · Tasks overlay |
| `Ctrl+B` | Toggle context rail (100+ columns) |
| `PgUp` / `PgDn` | Scroll transcript |
| `End` | Jump back to the latest output |
| Left click | Toggle a tool block, or press a rail button |
| `?` | Keybinding help |
| `y` / `n` / `a` | Approve / deny / approve + YOLO |
| `Ctrl+X` | Clear queued messages |

### Slash commands

`/model`, `/approval [strict|bash|danger|yolo]`, `/skills`, `/skills mine`,
`/tasks`, `/git`, `/compact`, `/theme [ember|mono|neon]`, `/density`,
`/clear`, `/help`, and `/quit` are intercepted locally. A slash embedded inside normal text is sent unchanged.
Inside the model picker, `/` filters by label or ID; the final `custom id…`
row accepts an arbitrary same-provider-compatible ID. `@path` indexes files
asynchronously from the working directory. `!command` runs locally with a
30-second timeout; `#preference` creates a compact remembered entry and asks
the agent to persist it with `MemoryWrite`.

### Context rail

`Ctrl+B` pins a fixed 34-column panel to the right of the transcript. It keeps
its width and height regardless of what the conversation, notices or composer
are doing — the bars and composer run full-width underneath it. Sections, in
priority order: **active**, **tasks**, **git**, **todos**, **context**,
**session**, **artifacts**. On a short terminal the lowest-priority sections
drop rather than squeezing the controls out.

Rail buttons are clickable. Git offers stage · unstage · commit · push · pull ·
diff · log · refresh; `push` and `pull` arm on the first press and run on the
second. `commit` with no message pre-fills the composer with `/git commit `.
Read-only actions (`diff`, `log`) print into the transcript; the rest report
through notices. Git state is re-read every five seconds and after each action.

### Project tasks

Build, run, serve and test commands live in `<working_dir>/.harness/tasks.json`:

```json
{
  "version": 1,
  "tasks": [
    { "id": "dev",   "label": "dev",   "command": "pnpm dev",   "kind": "serve" },
    { "id": "build", "label": "build", "command": "pnpm build", "kind": "build" }
  ]
}
```

With no config file the TUI detects commands from `package.json` scripts (using
the package manager the lockfile implies), `Makefile` targets, `go.mod`,
`Cargo.toml` and `pyproject.toml`, and marks the list as detected. Nothing is
written to disk until you save.

| Where | Action |
|-------|--------|
| Rail | Click a task to run it, click again to stop it |
| Rail | `[detect]` opens the editor on the detected list · `[ask agent]` has the model write the file · `[edit]` opens the current one |
| Tasks tab | `↑`/`↓` select · `enter` run/stop · `e` edit · `d` detect · `a` ask agent · `r` reload · `^s` saves in the editor |
| Composer | `/tasks [list\|edit\|detect\|ask]`, `/tasks run <id>`, `/tasks stop <id>` |

Output streams into the transcript as a live block and the last 500 lines stay
buffered. Stopping a task signals its whole process group, so a dev server
releases its port. Tasks are shell commands, so `strict` approval mode refuses
to run them — the same gate as `!command`.

### Approval modes

`danger` is default: safe tools run, ambiguous calls are classified, and
destructive calls prompt. `strict` prompts for mutations, `bash` prompts only
for shell/code execution, and `yolo` allows everything except a profile ACL
`deny`. Profile `deny` always wins.

### Flags

`harness-tui --profile profiles/devops.yaml --port 7337 --no-splash
--no-motion --no-notify`.

Model switching is same-provider only. Skills can be reviewed in the overlay;
promotion writes an uncommitted skill under `.agents/skills/` and takes effect
after server restart.

Build release binaries with `GOCACHE=/tmp/harness-go-cache pnpm build:bin`.

## CLI client (readline)

The readline CLI connects to a running server over WebSocket:

```bash
pnpm dev:cli
```

Uses `HARNESS_PORT` (default 7337) and `HARNESS_USER` (default system username).

**In-session commands:**

| Command | Description |
|---------|-------------|
| `/exit` | Disconnect |
| `/cancel` | Cancel the current agent run |
| `/resume <session-id>` | Resume a past session |

## REST API

The server exposes REST endpoints on the same port as the WebSocket server.

**One-shot run:**
```bash
curl -X POST http://localhost:7337/run \
  -H 'Content-Type: application/json' \
  -d '{"input": "Hello", "profile": "coding", "user": "alice"}'
```

**SSE streaming:**
```bash
curl -N http://localhost:7337/stream \
  -H 'Content-Type: application/json' \
  -d '{"input": "Hello"}'
```

**Health check:**
```bash
curl http://localhost:7337/health
```

**Run management:**
```bash
curl http://localhost:7337/runs           # list runs
curl http://localhost:7337/runs/abc123    # get run
curl -X DELETE http://localhost:7337/runs/abc123  # cancel
```

If `HARNESS_API_KEY` is set, include it as a bearer token:
```bash
curl -H 'Authorization: Bearer your-key' http://localhost:7337/run ...
```
