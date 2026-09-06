# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Roadmap

Feature backlog and status live in **[`docs/ROADMAP.md`](docs/ROADMAP.md)**. Read it before starting any feature work. The next item to pick up is marked there.

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

## Mandatory feature completion release loop

After every feature is complete, finish release and deployment before handing
off the work:

1. Run relevant tests plus the full suite, typecheck, build, boundary guard,
   and affected Go/Web validation.
2. Choose the smallest correct version bump automatically: **patch** for
   fixes/docs/tests/internal changes, **minor** for backward-compatible
   user-visible features, and **major** for breaking protocol/config/CLI/
   runtime changes. Ask the user only when the classification is ambiguous or
   the change is major-impacting.
3. Create scoped implementation commit(s). Run
   `pnpm release <patch|minor|major>` afterward. The release script creates
   the version commit, tag, and pushes `main` plus the tag to `origin`.
4. Wait for the GitHub Actions release workflow to build and publish assets.
   Deploy the latest artifact using the documented deployment target:
   `scripts/install.sh --no-init` for local binaries, Docker/Compose for
   containers, or the configured hosting workflow for a hosted client.
5. Inspect the current process/port before restarting. Preserve the existing
   profile, data directory, secrets, CWD, and service boundary. Verify binary
   versions, `/health`, and the relevant live client after deployment.

Separate implementation status, committed/released status, deployed runtime
status, and live/user acceptance status in the final report. Passing tests do
not replace live acceptance. Never claim completion while a required build,
push, deployment, or verification gate is pending.

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

| Profile | Feature | Model |
|---------|---------|-------|
| `coding.yaml` | Baseline dev assistant | gpt-5.4-mini |
| `data.yaml` | Data analyst — `mode: analyst`, read-only SQL/reports | gpt-4o |
| `assistant.yaml` | Personal assistant — `mode: assistant`, read-only + memory | claude-sonnet-4-6 |
| `devops.yaml` | Cron trigger + GitHub/log MCP | claude-sonnet-4-6 |
| `research.yaml` | `agents:` block — orchestrator + 2 workers | claude-opus-4-8 |
| `researcher.yaml` | Worker: fetch + brave-search MCP | claude-sonnet-4-6 |
| `summariser.yaml` | Worker: synthesis, no MCP | claude-sonnet-4-6 |
| `writer.yaml` | Typed I/O contract + `on_stop` git hook | claude-sonnet-4-6 |
| `security.yaml` | Webhook trigger + read-only ACL | claude-opus-4-8 |

All Anthropic profiles use `base_url: https://api.anthropic.com/v1` (OpenAI-compatible endpoint). Most profiles skip the `mode:` field and use explicit ACLs for full control (`applyModeDefaults` always wins over profile-level overrides when `mode:` is set — see `docs/superpowers/specs/2026-06-05-profile-examples-design.md`); `data.yaml` and `assistant.yaml` use `mode: analyst` / `mode: assistant` instead, since the ACL preset is exactly the read-only shape both want. The web client's profile switcher (`profiles_list`/`profiles` protocol messages, `TopBar`/`Palette`) lets an operator hop between any loaded profile mid-session via `set_profile`.

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
