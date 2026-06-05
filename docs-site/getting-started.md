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
```

Server listens on port `7337`. Override with `HARNESS_PORT`.

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

## What's next?

- [Profiles](./profiles) — configure models, tools, and triggers
- [Built-in Tools](./builtin-tools) — what the agent can do
- [MCP Servers](./mcp-servers) — connect external tools
