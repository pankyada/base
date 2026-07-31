# Harness

Generic profile-driven agent runtime with a Go/Bubble Tea terminal control
surface.

```bash
pnpm install
pnpm tui
```

Build TUI locally with `cd tui && go build -o ../bin/harness-tui .`; build
release targets with `GOCACHE=/tmp/harness-go-cache pnpm build:bin`.

Use `pnpm dev:cli` for the readline client, or `pnpm dev` for the server.
TUI flags: `--profile`, `--port`, `--no-splash`, `--no-motion`, and
`--no-notify`. Full client, approval, model, skills, and release docs live in
[`docs-site/cli-tui.md`](docs-site/cli-tui.md).
