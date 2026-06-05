# Hooks

Hooks are shell commands that run at agent lifecycle points. They let you integrate the agent loop with external systems — git, logging, alerting, etc.

## Configuration

```yaml
hooks:
  pre_tool: []       # runs before each tool call
  post_tool: []      # runs after each tool call (whether it succeeded or failed)
  on_stop: []        # runs once when the agent loop ends
  timeout_ms: 5000   # max time for any single hook command (default 5000)
```

## Hook points

### `pre_tool`

Runs before each tool call. Receives `TOOL_NAME` env var. Hook failures are logged but do not prevent the tool call.

```yaml
hooks:
  pre_tool:
    - "echo '[pre] About to run $TOOL_NAME' >> .harness/audit.log"
```

### `post_tool`

Runs after each tool call, whether it succeeded or failed. Receives both `TOOL_NAME` and `TOOL_OK` (`true` or `false`).

```yaml
hooks:
  post_tool:
    - "echo '[post] $TOOL_NAME ok=$TOOL_OK' >> .harness/audit.log"
```

### `on_stop`

Runs once when the agent loop terminates (user disconnect, error, or natural end). No tool env vars injected.

```yaml
hooks:
  on_stop:
    - "git add .harness/writer/drafts 2>/dev/null || true"
    - "echo 'Session ended' | slack-notify '#ops' 2>/dev/null || true"
```

## Environment variables

| Variable | Available in | Value |
|----------|-------------|-------|
| `TOOL_NAME` | `pre_tool`, `post_tool` | Name of the tool being called (e.g. `Bash`, `Write`) |
| `TOOL_OK` | `post_tool` only | `true` if the tool succeeded, `false` if it threw |

All other environment variables from the server process are also available (`ANTHROPIC_API_KEY`, `PATH`, etc.).

## Timeout

Each hook command runs with a timeout of `hooks.timeout_ms` (default 5000 ms). If a hook times out, it's treated as a failure and logged.

## Failure behaviour

| Hook | Exit non-zero | Timeout |
|------|--------------|---------|
| `pre_tool` | Logged as warning, tool still runs | Logged as warning, tool still runs |
| `post_tool` | Logged as warning, loop continues | Logged as warning |
| `on_stop` | Logged as warning | Logged as warning |

## Example — `profiles/writer.yaml`

The writer profile uses `on_stop` to stage drafts so nothing is lost if the session ends unexpectedly:

```yaml
hooks:
  on_stop:
    - "git add .harness/writer/drafts 2>/dev/null || true"
```

The `|| true` ensures the hook always exits 0 (even if no drafts exist), preventing a spurious hook-failure warning.

## Tips

- Keep hook commands short and fast — they run on every tool call for `pre_tool`/`post_tool`
- Always use `|| true` for non-critical hooks to avoid spurious failures
- Use `>>` (append) not `>` (overwrite) for log files to avoid losing history
- Hooks run in the server process's working directory, not `profile.working_dir`
