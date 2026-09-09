# AGENTS.md

Guidance for all AI agents (Claude, Jules, Gemini, etc.) working in this repository.

## First: read the product tracker and roadmap

**Before starting any task, read [`docs/PRODUCT_STATE.md`](docs/PRODUCT_STATE.md). Before feature work, also read [`docs/ROADMAP.md`](docs/ROADMAP.md).**

`PRODUCT_STATE.md` is the canonical current-state and task tracker. `ROADMAP.md` defines numbered feature scope and suggested sequencing; specs define acceptance requirements. Check the tracker before choosing work: an incomplete roadmap item may already have substantial implementation. Follow the user's requested scope; otherwise use the tracker's next priorities and roadmap sequence. Do not duplicate implemented work.

## Required task tracking — every task

- Before implementation, add or reuse a stable task ID in `docs/PRODUCT_STATE.md`; record scope, component/feature, status, and completion criteria. Mark active work `in_progress`.
- Classify new tasks using [`docs/FEATURES.md`](docs/FEATURES.md): primary feature ID and affected clients. For Core changes, record protocol/API/schema/prompt compatibility and required client changes/checks, or `none` with a reason.
- Keep affected component state, feature state, open gaps, and task status current as work changes. Record blockers and remaining acceptance explicitly; never silently drop unfinished scope.
- **Before claiming any task complete, update `docs/PRODUCT_STATE.md`.** This applies to features, fixes, reviews, documentation, tests, releases, and deployments. For a short read-only task, one completed entry at closeout is sufficient.
- Every completed task needs a dated completion-log entry with task ID, outcome, evidence/checks (or why not run), and remaining gaps. Update its task row and affected state rows in the same change. A completed review does not close the defects it found.
- Distinguish implementation, automated validation, live/user acceptance, and release/deployment. A local pass is not a deployment or a fully accepted feature. Mark a task `done` only when its stated scope and criteria are met; track remaining work separately with linked IDs.
- Update `docs/ROADMAP.md` too when numbered feature status/scope changes, and `docs/ADR.md` for load-bearing decisions. Resolve contradictions using current evidence, preserving dated historical evidence.
- Include tracker changes with the task's commit/PR when committing; do not create a separate tracking-only commit unless requested. Never invent a commit SHA, test result, or release state. Preserve unrelated work.

See the tracker for status definitions, evidence rules, and entry templates. This is a required repository workflow, not an automated enforcement mechanism.

## Second: read the decision register

**[`docs/ADR.md`](docs/ADR.md)** records every load-bearing decision and why it was made. Several subsystems deliberately reject the obvious approach; the register explains each one. Read the entries covering the subsystem you are about to change, and add an entry when you make a decision of the same weight.

## Current product state

Read [`docs/PRODUCT_STATE.md`](docs/PRODUCT_STATE.md) for current implementation, acceptance gaps, and next tasks. Do not duplicate volatile status summaries in agent instruction files.

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
