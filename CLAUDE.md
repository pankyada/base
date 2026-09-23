# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Roadmap

Read **[`docs/PRODUCT_STATE.md`](docs/PRODUCT_STATE.md)** before every task. It is the canonical current-state and task tracker: component maturity, feature implementation, acceptance evidence, open gaps, and completed work. **[`docs/ROADMAP.md`](docs/ROADMAP.md)** retains numbered feature scope and sequencing; read it before feature work. Specs retain acceptance requirements. Do not assume an incomplete roadmap item has no implementation.

## Required task closeout

Follow the task-tracking rules in **[`AGENTS.md`](AGENTS.md)** for every feature, fix, review, documentation, test, release, or deployment task:

- Add/reuse a stable tracker task ID before implementation; record scope and completion criteria and mark `in_progress`. Short read-only tasks may be logged at closeout.
- Use [`docs/FEATURES.md`](docs/FEATURES.md) for primary feature IDs and affected clients. Core changes must record shared-contract compatibility, client updates and validation impact, or `none` with a reason.
- Keep affected component/feature state and open gaps updated during work.
- **Before reporting completion, update `docs/PRODUCT_STATE.md`: task status, affected state rows, and a dated completion-log entry with outcome, checks/evidence, and remaining gaps.** Reviews must leave discovered defects open.
- Only mark `done` when the task's stated criteria are met. Keep implementation, automated tests, live/user acceptance, and release/deployment separate; record unknowns honestly.
- Synchronize `docs/ROADMAP.md` when numbered feature scope/status changes and `docs/ADR.md` for load-bearing decisions. Include tracking updates in the task commit/PR when committing; preserve unrelated edits.

Tracker templates and status definitions live in `docs/PRODUCT_STATE.md`. This workflow is instruction-enforced; no automatic tracker synchronization is assumed.

## Architecture decisions

**[`docs/ADR.md`](docs/ADR.md)** records every load-bearing decision and the reason for it. Read the relevant entries before changing an existing subsystem's shape — several designs deliberately reject the obvious alternative, and the register says why.

## Commands

```bash
# Dev (no compile step needed)
pnpm dev                        # start WebSocket server (default profile)
pnpm dev:tui                    # start Go/Bubble Tea TUI
pnpm dev:cli                    # start readline CLI client

# Build
pnpm build                      # tsc → dist/
pnpm build:bin                  # server/CLI + Go TUI release binaries
pnpm typecheck                  # type-check without emitting
cd tui && go test ./...         # Go TUI unit/app-flow tests

# Test
pnpm test                       # vitest run (all)
pnpm test:watch                 # vitest watch
npx vitest run tests/agent-loop.test.ts   # single test file
```

All entry points are in `dist/` after build; binary aliases are `harness`, `harness-server`, `harness-tui`.

## Architecture

This is a **generic agent harness** — a thin WebSocket-based runtime that wires an LLM to tools, skills, memory, MCP servers, and hooks. Everything is profile-driven (YAML).

Canonical operator architecture and usage examples live in
[`docs-site/architecture.md`](docs-site/architecture.md). Keep its system map
current when changing a load-bearing runtime boundary.

### Runtime flow

```
Profile YAML
  ↓ loadProfile()
Server (ws:7337)
  ↓ per-connection
  Session  ←→  FsMemoryProvider (profile-scoped + session-scoped)
  ↓ on user message
  AgentLoop  →  OpenAI-compatible API (streaming)
                  ↓ tool calls
                  ACL check (allow / prompt / deny)
                  ↓ approved
                  runHooks(pre_tool) → execute() → runHooks(post_tool)
                  → telemetry (~/.harness/telemetry.jsonl)
  ↓ session end
  DefaultImprover.reflect() → memory.write() + proposed skills
```

### Key modules

| Path | Role |
|------|------|
| `src/types.ts` | Shared WS protocol types (`ClientMessage` / `ServerMessage`) |
| `src/profiles/schema.ts` | Zod schema for profiles — **start here** when changing config shape |
| `src/loop/agent-loop.ts` | Core streaming agentic loop; handles tool call fan-out, ACL, hooks, telemetry |
| `src/context/` | Append-only ledger projection, estimator calibration, decay ladder, digest, pins, and cache markers |
| `src/server/index.ts` | WS server; one `Session` + `FsMemoryProvider` per connection |
| `src/tools/registry.ts` | Global tool registry; `registerAll()` in `src/tools/builtin/index.ts` registers built-ins |
| `src/tools/acl.ts` | ACL resolution: profile `tools.builtin[name]` for built-ins; `tools.mcp_servers[].acl` for MCP |
| `src/skills/loader.ts` | Auto-discovers `SKILL.md` dirs across 4 path levels; `resolveSkillsDirs()` + `loadAllSkills()`; last-write-wins |
| `src/skills/indexer.ts` | Builds the skill list injected into the system prompt |
| `src/memory/fs-memory.ts` | Two scopes: `session` (in-memory on `Session`) and `profile` (`<artifact_dir>/memory/*.md`) |
| `src/session/store.ts` | Sessions persisted to `~/.harness/sessions/<date>_<id>.json` |
| `src/hooks/runner.ts` | `pre_tool` / `post_tool` / `on_stop` shell hooks from profile; env vars `TOOL_NAME`, `TOOL_OK` |
| `src/mcp/client.ts` | Connects to MCP servers (stdio/streamable-http/sse/websocket); tools exposed as `<serverName>__<toolName>` with real schemas |
| `src/improver/default-improver.ts` | Post-session reflection → memory writes; skill mining every N sessions |
| `src/telemetry/logger.ts` | Appends JSONL events to `~/.harness/telemetry.jsonl` |
| `tui/` | Go/Bubble Tea control surface: transcript, approval/input modals, overlay, rail, skills, and reconnecting WS client |
| `src/models/registry.ts` | Curated model metadata, provider availability, context windows, and cost math |
| `src/safety/` | Static danger rules, verdict cache, and fail-closed classifier |
| `src/skills/manage.ts` | Proposed/installed skill review, safe edit, promote, and recoverable discard |

### Profiles

Profiles live in `profiles/` (project-local) or `~/.harness/profiles/`. Load order for paths in profile YAML: `$CWD` expands to `process.cwd()`, `~` to `homedir()`.

Example profiles in `profiles/` (each demonstrates a distinct harness feature):

| Profile | Feature | Default model |
|---------|---------|-------|
| `coding.yaml` | Baseline dev assistant | gpt-6-luna |
| `data.yaml` | Data analyst — `mode: analyst`, read-only SQL/reports | gpt-6-luna |
| `assistant.yaml` | Personal assistant — `mode: assistant`, read-only + memory | gpt-6-luna |
| `devops.yaml` | Cron trigger + GitHub/log MCP | gpt-6-luna |
| `research.yaml` | `agents:` block — orchestrator + 2 workers | gpt-6-luna |
| `researcher.yaml` | Worker: fetch + brave-search MCP | gpt-6-luna |
| `summariser.yaml` | Worker: synthesis, no MCP | gpt-6-luna |
| `writer.yaml` | Typed I/O contract + `on_stop` git hook | gpt-6-luna |
| `security.yaml` | Webhook trigger + read-only ACL | gpt-6-luna |

Profiles with workflow role models use `gpt-6-sol` for both `frontier` and
`critic`; `cheap` and `balanced` use `gpt-6-luna`.

All shipped profiles use the OpenAI API endpoint and `OPENAI_API_KEY`. Most profiles skip the `mode:` field and use explicit ACLs for full control (`applyModeDefaults` always wins over profile-level overrides when `mode:` is set — see `docs/superpowers/specs/2026-06-05-profile-examples-design.md`); `data.yaml` and `assistant.yaml` use `mode: analyst` / `mode: assistant` instead, since the ACL preset is exactly the read-only shape both want. The web client's profile switcher (`profiles_list`/`profiles` protocol messages, `TopBar`/`Palette`) lets an operator hop between any loaded profile mid-session via `set_profile`.

### Skills

Skills are directories under `.agents/skills/<name>/` containing a `SKILL.md` file with gray-matter frontmatter (`name`, `description`). Optional subdirs: `scripts/`, `references/`, `assets/`.

Four roots are auto-discovered at startup (most-specific wins on name collision):

| Level | Path |
|-------|------|
| User | `~/.agents/skills/` |
| Project | `<git-repo-root>/.agents/skills/` |
| Sub-project | `<CWD>/../.agents/skills/` |
| Folder | `<CWD>/.agents/skills/` |

No profile configuration needed. The `Skill` tool returns `SKILL.md` content; use the `Read` tool for files in subdirectories.

### Workflow & routing

Optional `workflow.enabled` routes a request through bounded stage artifacts:
`recon → plan → design → build → verify → review`. `models.roles` maps the
cheap, balanced, frontier, and critic tiers to model IDs. Playbooks are
`.agents/playbooks/<name>/PLAYBOOK.md` and use the same four discovery levels as
skills. `src/workflow/` owns contracts, triage, routing, escalation, knowledge,
and artifacts; `src/analysis/` owns stratified routing metrics and
`harness stats routing`. Missing `workflow:` preserves the flat loop.

### MCP servers

Configured in `tools.mcp_servers` of the profile YAML. Four transports supported (`transport` defaults to `stdio` if omitted):

```yaml
tools:
  mcp_servers:
    # stdio — local subprocess (default)
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      env: {}
      acl:
        "*": prompt
        read_file: allow

    # Streamable HTTP — modern remote MCP standard
    - name: my-remote
      transport: streamable-http
      url: https://my-mcp-server.com/mcp
      headers:
        Authorization: "Bearer ${MY_TOKEN}"
      acl:
        "*": prompt

    # SSE — legacy remote (still common)
    - name: legacy
      transport: sse
      url: https://legacy.example.com/sse
      headers: {}
      acl:
        "*": prompt

    # WebSocket
    - name: ws-server
      transport: websocket
      url: ws://localhost:8080/mcp
      acl:
        "*": prompt
```

Tools are exposed as `<serverName>__<toolName>` in the agent loop. ACL: `tools.mcp_servers[].acl` with `*` wildcard fallback. Tool parameter schemas are passed through from the MCP server's `listTools` response so the LLM sees real parameter definitions.

### Provider

Uses the OpenAI SDK pointed at any `base_url` — model is fully configurable per profile. API key is read from `process.env[profile.model.api_key_env]`.

### Cost estimation

Model pricing and context windows live in `src/models/registry.ts`; `estimateCost` uses the active model and fallback pricing for unknown ids.

Context management keeps `Session.messages` as an append-only ledger. `src/context/projection.ts` recomputes a budgeted wire projection each turn: tool results elide to restorable handles, whole turns may digest, and tier-3 dropping guarantees termination without rewriting history.
