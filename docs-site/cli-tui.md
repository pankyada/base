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
pnpm tui
```

Auto-starts the server if one isn't running, waits for health, then opens the terminal UI. Quit with `Ctrl+C` — the server it started shuts down with it. If a server is already running on `HARNESS_PORT`, it is reused and left running on exit.

### TUI environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HARNESS_PORT` | `7337` | Server to connect to |
| `HARNESS_PROFILE` | `coding` | Profile name sent in the `hello` message |
| `HARNESS_USER` | system username | User identity (scopes memory + sessions) |

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+K` | Open command palette |
| `Ctrl+L` | Clear conversation |
| `Ctrl+O` | Toggle tool calls expanded / collapsed |
| `Tab` | Switch between conversation pane and workspace pane |
| `1`–`9` | Switch to workspace tab N |
| `/` | Focus conversation input |
| `Escape` | Close command palette |
| `y` / `n` | Approve / deny a tool prompt |

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
