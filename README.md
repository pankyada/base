# Base

Profile-driven agent runtime for building guarded, observable AI systems.
Base provides durable runs, tool ACLs, profiles, MCP, memory, multi-agent
composition, channels, voice primitives, REST/WebSocket APIs, and a Go/Bubble
Tea control surface. It is infrastructure, not a vertical product.

Licensed under the [MIT License](LICENSE).

Architecture, features, and usage examples: [docs-site/architecture.md](docs-site/architecture.md).

```bash
pnpm install
pnpm tui
```

Requires Node.js 22+ and pnpm 9.15.9. Copy `.env.example` to `.env`, then set
only the provider variables required by the profile you plan to run.

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

## What it is for

- Build one runtime, then define agents as reviewable profile bundles.
- Keep tool access explicit: allow, prompt, or deny.
- Run interactive, headless, scheduled, or channel-backed work from the same
  core.
- Keep sessions, audit records, memory, and telemetry inspectable on disk.

## Start here

- [Architecture and runnable examples](docs-site/architecture.md)
- [CLI and TUI guide](docs-site/cli-tui.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
