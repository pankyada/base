# Getting Started

## Prerequisites

- [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io) 9+
- An API key for your model provider (Anthropic or OpenAI-compatible)

## Installation

```bash
git clone https://github.com/pankyada/base.git
cd base
pnpm install
```

For a release install, use the installer. It installs binaries and a
self-contained default profile bundle under `~/.harness/profiles/`; existing
profile files are kept unchanged.

```bash
curl -fsSL https://raw.githubusercontent.com/pankyada/base/main/scripts/install.sh | sh
```

## Configuration

```bash
cp .env.example .env
```

Edit `.env` and set your API key:

```
ANTHROPIC_API_KEY=sk-ant-...
# or OPENAI_API_KEY=sk-...
```

## Start the TUI (recommended)

```bash
pnpm tui
```

`pnpm tui` auto-starts the server in the background, waits until it's healthy, then launches the terminal UI. Quit with `Ctrl+C` — the server shuts down with it.

Use a specific profile:

```bash
HARNESS_PROFILE=devops pnpm tui
```

## Start the server only

```bash
pnpm dev                          # default profile (~/.harness/profiles/coding.yaml)
pnpm dev profiles/devops.yaml     # path to a profile YAML
pnpm dev --profiles ~/.harness/profiles --default-profile coding
```

Server listens on port `7337`. Override with `HARNESS_PORT`.

With `--profiles`, one server handles all valid YAML profiles in that directory.
Clients select one through `hello.profile`; REST callers send `profile` in the
request body. Unknown names return an error rather than falling back silently.

## Connect the web client

With the server running:

```bash
cd web && pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## One-shot REST call

```bash
curl -X POST http://localhost:7337/run \
  -H 'Content-Type: application/json' \
  -d '{"input": "What is 2 + 2?"}'
```

Response:

```json
{
  "output": "4",
  "usage": { "input_tokens": 12, "output_tokens": 1 },
  "session_id": "abc123"
}
```

## Docker Compose (full stack)

```bash
docker compose up
```

Web client: [http://localhost:3000](http://localhost:3000)
Backend: [http://localhost:7337](http://localhost:7337)

Session data, memory, and telemetry are persisted to `.harness-data/` on the host.

## Reviewing what the agent did

Every effectful tool call is journaled with the reason it was permitted:

```bash
harness audit --since 2026-08-01
harness audit --undo <entry_id>   # best-effort reverse, where a tool supplied one
```

See [Safety & Governance](./safety#audit-journal-undo).

## Setting up for your use case

Not every profile is an interactive chat session sitting in front of a
human. [Use Cases](./use-cases) walks through four complete, runnable
profiles end to end — a coding assistant, a personal assistant with voice
and SMS-style paging, a production data-analysis agent called over REST,
and an unattended ops agent that watches infrastructure and pages you
through a channel — each with the full YAML and a line-by-line explanation
of why every field is set the way it is.

## What's next?

- [Use Cases](./use-cases) — four worked setups: coding, personal assistant with voice, production data analysis, unattended ops
- [Profiles](./profiles) — every field: models, tools, triggers, channels, safety
- [Built-in Tools](./builtin-tools) — what the agent can do, including `Notify`, `AskUser`, and `Recall`
- [Safety & Governance](./safety) — conditional ACL, the provenance gate, autonomy budgets, and the audit journal
- [Automation](./automation) — cron/watch/poll triggers, durable deferred asks, and channels
- [Memory](./memory) — scopes, providers, and temporal facts with `Recall`
- [Voice](./voice) — streaming STT/TTS, endpointing, and barge-in
- [MCP Servers](./mcp-servers) — connect external tools
- [Multi-Agent](./multi-agent) — orchestrators, workers, and fan-out
- [Architecture](./architecture) — the full system map and the [interactive explorer](https://github.com/pankyada/base/blob/main/docs/architecture-site/index.html) behind it
