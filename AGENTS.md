# AGENTS.md

Guidance for all AI agents (Claude, Jules, Gemini, etc.) working in this repository.

## First: read the roadmap

**Before starting any feature work, read [`docs/ROADMAP.md`](docs/ROADMAP.md).**

It contains the master feature list with status (✅ done / 🔄 in progress / ❌ not started) and suggested sequencing. Pick up the next `❌` item in sequence unless told otherwise. Do not duplicate work already marked ✅.

## Second: read the decision register

**[`docs/ADR.md`](docs/ADR.md)** records every load-bearing decision and why it was made. Several subsystems deliberately reject the obvious approach; the register explains each one. Read the entries covering the subsystem you are about to change, and add an entry when you make a decision of the same weight.

## Current roadmap state

Adaptive workflow routing (#15) and context projection (#16) are implemented. The unattended/ambient track (#17–#23) is specced but unimplemented — the first task there is the boundary CI guard, not a feature. Read `docs/ROADMAP.md` for current status before new work.

## Architecture overview

This is a **generic agent harness** — a WebSocket-based runtime wiring an LLM to tools, skills, memory, MCP servers, and hooks. Everything is profile-driven (YAML).

See `CLAUDE.md` for the full architecture, key module table, commands, and profile/skill/MCP documentation.

## Code conventions

- **TypeScript + ESM** — `.js` extensions in all imports even for `.ts` source files
- **Vitest** for tests — run `pnpm test`; always run full suite before committing
- **TDD** — write failing tests first, then implement
- **YAGNI** — build exactly what the spec says, nothing extra
- **Frequent small commits** — one logical change per commit

## Key files to read before touching anything

| File | Why |
|------|-----|
| `src/types.ts` | WS protocol — change here first if adding messages |
| `src/profiles/schema.ts` | Zod schema — change here first if adding profile config |
| `src/loop/agent-loop.ts` | Core loop — understand before changing tool execution |
| `src/tools/builtin/index.ts` | Register new tools here |
| `src/memory/interface.ts` | Memory contract — all providers must implement this |
| `src/session/user-paths.ts` | All user-scoped paths go through here |

## What not to do

- Do not add authentication/authorization (not in scope)
- Do not restructure files outside the task you're working on
- Do not merge to main with failing tests or typecheck errors
- Do not add npm packages without a clear reason — the stdlib is preferred

## Workflow routing

Adaptive workflow is profile-optional. Playbooks under
`.agents/playbooks/<name>/PLAYBOOK.md` define stage contracts; `src/workflow/`
handles triage, artifact handoff, escalation, and project knowledge; and
`src/analysis/` handles stratified routing statistics. Keep the flat loop
unchanged for profiles without `workflow.enabled`.
