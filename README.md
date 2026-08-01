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

## Workflow routing

Profiles may enable the staged workflow with `workflow.enabled: true`. A run
then hands artifacts through `recon`, `plan`, `design`, `build`, `verify`, and
`review`; `models.roles` maps cheap, balanced, frontier, and critic tiers to
concrete model IDs. Playbooks live in `.agents/playbooks/<name>/PLAYBOOK.md`
and use the same user, repository, parent, and current-directory precedence as
skills.

Routing telemetry is grouped by task class and blast radius. Inspect it with a
stratified command such as `harness stats routing --stage build`; the command
refuses unstratified tier comparisons and marks cells with fewer than eight
runs as insufficient data.
