# AGENTS.md

Guidance for all AI agents (Claude, Jules, Gemini, etc.) working in this repository.

## First: read the roadmap

**Before starting any feature work, read [`docs/ROADMAP.md`](docs/ROADMAP.md).**

It contains the master feature list with status (✅ done / 🔄 in progress / ❌ not started) and suggested sequencing. Pick up the next `❌` item in sequence unless told otherwise. Do not duplicate work already marked ✅.

## Suggested next feature

**#3 — First-class multi-agent composition** (see ROADMAP.md for full spec).

This is the highest-leverage item remaining. The `Delegate` tool (`src/tools/builtin/delegate.ts`) is a working foundation — build on it rather than around it.

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
