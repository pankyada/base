# Plan: Harness Maturity & Robustness Hardening

**Generated**: 2026-06-19
**Estimated Complexity**: Medium-High

## Overview

The harness is a well-architected, feature-broad agent runtime (~6.2k LOC src, ~10k
passing tests across 50 test files). Architecture is clean and modular: profile-driven
config (Zod-validated), pluggable memory/executor/improver interfaces, per-user isolation,
MCP integration, sandboxed code execution. It is a **strong mid-stage / late-prototype**
solution — feature-mature but not yet operationally hardened for untrusted/multi-tenant or
production use.

This plan closes the gaps between "demos well and is well-tested" and "safe to run as a
shared service." Work is ordered by risk: security first, then reliability, then tooling/hygiene.

## Maturity & Robustness Assessment (baseline)

**Strengths**
- Clean module boundaries; interfaces for Executor/Memory/Improver (swappable backends).
- Zod schema as single source of truth for profile config.
- Strong test coverage breadth (10k tests, unit + contract + protocol).
- `strict: true` TS; zero `@ts-ignore`; zero stray TODO/FIXME.
- Real sandboxing for code exec (docker: `--network none`, mem/cpu caps, non-root, ro mount).
- Parallel tool execution with correct ACL flush ordering (agent-loop Strategy C).
- Context condensation with anchor-preservation heuristic.

**Gaps (addressed below)**
- S1 **WebSocket transport is unauthenticated** — `HARNESS_API_KEY` only guards REST
  (`rest.ts:536`); the WS path (which runs Bash, code-exec, all tools) has no auth check
  (`server/index.ts:125`). Anyone who can reach the port gets arbitrary code execution.
- S2 **Bash tool inherits full `process.env`** (`bash.ts`), leaking provider API keys and
  secrets into every subprocess the model spawns.
- S3 **No provider retry/backoff** — a single transient 429/5xx from the LLM API aborts the
  turn (`agent-loop.ts` has no retry; grep confirms none in repo).
- R1 **Docker/exec output not size-bounded** — stdout/stderr and out-files are read fully
  into memory base64 (`docker.ts:60-72`); a chatty/large-file program can OOM the host process.
- R2 **`spawn('docker', …)` missing `error` handler** (`docker.ts:55`) — if docker binary is
  absent the promise never resolves/rejects cleanly.
- R3 **Test config leaks nested node_modules** — `vitest.config.ts` `exclude: ['node_modules/**']`
  lacks `**/` prefix, so 80 files inside `.claude/worktrees/**/node_modules` get scanned and
  fail. Masks real failures and breaks `pnpm test` exit code.
- T1 **No lint/format tooling** (no eslint/prettier/biome) and **no CI for typecheck/test** —
  only a docs-deploy workflow exists.
- T2 **42 `any` casts** concentrated in the loop/server protocol boundary reduce type safety
  exactly where messages cross trust boundaries.

## Prerequisites
- Node 20+, pnpm 9, Docker (for executor tests).
- Decision on threat model: is the server ever exposed beyond localhost / multi-tenant? (drives S1 scope)

---

## Sprint 1: Security hardening
**Goal**: Close the unauthenticated-RCE and secret-leak paths.
**Demo/Validation**:
- Connect to WS without token → rejected; with token → accepted.
- Run a bash tool, print `env` → no `*_API_KEY` present.
- `pnpm test` green for new auth + env tests.

### Task 1.1: Authenticate the WebSocket transport
- **Location**: `src/server/index.ts` (~line 114-125), `src/types.ts` (hello msg)
- **Description**: When `HARNESS_API_KEY` is set, require it on WS connect — via
  `WebSocketServer({ verifyClient })` checking `Authorization: Bearer` header, or a token field
  on the `hello` message rejected before any tool runs. Mirror the REST 401 behavior. Keep the
  unauthenticated dev path only when the key is unset, and keep/loudly log the existing warning.
- **Dependencies**: none
- **Acceptance Criteria**: WS handshake without valid token is closed with a 4401-style close code;
  with token, proceeds. No tool executes pre-auth.
- **Validation**: New test in `tests/` (extend `server-contract.test.ts` pattern) for both paths.

### Task 1.2: Scrub secrets from Bash/exec subprocess env
- **Location**: `src/tools/builtin/bash.ts` (env: process.env), `src/executor/*`
- **Description**: Replace `env: process.env` with an allowlist/denylist filter (strip
  `*_API_KEY`, `HARNESS_API_KEY`, `*_TOKEN`, `*_SECRET` by default; allow opt-in passthrough via
  profile). Centralize in a small `sanitizeEnv()` helper.
- **Dependencies**: none
- **Acceptance Criteria**: A bash command printing env does not contain filtered keys.
- **Validation**: Unit test asserting filtered vars absent, normal vars (PATH) present.

### Task 1.3: Bind address + origin hardening (if exposed)
- **Location**: `src/server/index.ts` (`httpServer.listen`)
- **Description**: Default-bind to `127.0.0.1`; make host configurable via env. Document that
  exposing requires `HARNESS_API_KEY`. Optionally check WS `Origin` header.
- **Dependencies**: 1.1
- **Acceptance Criteria**: Server binds loopback by default; configurable.
- **Validation**: Manual + a startup-config test.

---

## Sprint 2: Runtime reliability
**Goal**: Survive transient API failures and resource-heavy tool output without crashing.
**Demo/Validation**: Simulated 429 → loop retries and completes; oversized exec output → truncated, host stable.

### Task 2.1: Add provider retry with backoff
- **Location**: `src/loop/agent-loop.ts` (stream create ~line 44), or `src/provider/client.ts`
- **Description**: Wrap the streaming call in bounded exponential backoff (respect `Retry-After`)
  for 429/5xx/network errors. Prefer the OpenAI SDK's `maxRetries` for non-stream, plus an
  explicit retry wrapper for the stream-create. Surface a user-visible "retrying" event.
- **Dependencies**: none
- **Acceptance Criteria**: Injected transient error retries up to N then fails gracefully with a
  clear error event (not an unhandled rejection).
- **Validation**: Test with a mock OpenAI client that throws then succeeds.

### Task 2.2: Bound executor output size
- **Location**: `src/executor/docker.ts` (stdout/stderr handlers + out-file read loop), `wasm.ts`
- **Description**: Cap accumulated stdout/stderr (e.g. 256 KB each) and per-file out size; stop
  reading and mark `[truncated]` past the cap (mirror `bash.ts` MAX_OUTPUT pattern).
- **Dependencies**: none
- **Acceptance Criteria**: A program emitting 10 MB stdout returns truncated output; process RSS stable.
- **Validation**: Extend `executor-docker.test.ts` / `executor-wasm.test.ts`.

### Task 2.3: Handle missing/failed docker binary
- **Location**: `src/executor/docker.ts` (`spawn`, ~line 55)
- **Description**: Add `proc.on('error', …)` to reject/resolve with a clear "docker unavailable"
  result; fall back per `executor/factory.ts` policy.
- **Dependencies**: none
- **Acceptance Criteria**: With docker absent, execute() returns a clean error result, not a hang.
- **Validation**: Test stubbing spawn error.

### Task 2.4: Harden agent-loop JSON/usage edge cases
- **Location**: `src/loop/agent-loop.ts`
- **Description**: Already tolerant of bad tool-arg JSON and artifacts JSON; add guard for empty
  `toolCallMap` entries with blank `id`/`name` (skip + log) and ensure a turn with zero usage
  chunks still logs telemetry without NaN cost.
- **Dependencies**: none
- **Acceptance Criteria**: Malformed/partial tool-call streams don't push invalid messages to the API.
- **Validation**: Extend `agent-loop.test.ts`.

---

## Sprint 3: Engineering hygiene & CI
**Goal**: Make regressions visible automatically; fix the test config leak.
**Demo/Validation**: CI runs typecheck+test on PR; `pnpm test` exit code reflects only real tests.

### Task 3.1: Fix vitest exclude glob
- **Location**: `vitest.config.ts`
- **Description**: Change `exclude: ['dist/**', 'node_modules/**']` to include `**/node_modules/**`
  and `**/.claude/**` (and keep vitest defaults). Verify nested worktree copies no longer scanned.
- **Dependencies**: none
- **Acceptance Criteria**: `pnpm test` reports only `tests/**` files; exit code 0 when they pass.
- **Validation**: Run `pnpm test`; confirm ~50 files, no `.claude/worktrees` entries.

### Task 3.2: Add CI workflow for typecheck + test
- **Location**: `.github/workflows/ci.yml` (new)
- **Description**: On push/PR: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`.
  Optionally a docker job for executor tests (or mark them skip-if-no-docker).
- **Dependencies**: 3.1
- **Acceptance Criteria**: CI green on main; fails on a deliberately broken type.
- **Validation**: Open a draft PR and observe checks.

### Task 3.3: Add linter + formatter
- **Location**: repo root (`biome.json` or eslint+prettier), package scripts
- **Description**: Adopt Biome (single fast tool) or eslint+prettier. Add `pnpm lint` and wire into CI.
  Fix or baseline existing violations.
- **Dependencies**: 3.2
- **Acceptance Criteria**: `pnpm lint` passes; CI enforces it.
- **Validation**: CI step.

### Task 3.4: Tighten protocol types (reduce `any`)
- **Location**: `src/loop/agent-loop.ts`, `src/server/index.ts`, message boundaries (42 `any` sites)
- **Description**: Replace `as any` on OpenAI message arrays and WS payloads with proper typed
  helpers / discriminated unions where feasible. Prioritize trust-boundary parsing.
- **Dependencies**: 3.3
- **Acceptance Criteria**: Measurable drop in `any` count at message boundaries; typecheck clean.
- **Validation**: `grep -rEn ': any|as any' src | wc -l` decreased; tests green.

---

## Sprint 4: Operational maturity (optional / next)
**Goal**: Observability and cost correctness for real deployment.
**Demo/Validation**: Accurate per-model cost; structured logs; graceful shutdown.

### Task 4.1: Per-model cost table
- **Location**: `src/loop/agent-loop.ts::estimateCost` (currently hardcoded, ignores model)
- **Description**: Replace single hardcoded rate with a per-model price map (input/output), default
  fallback + warn on unknown model.
- **Acceptance Criteria**: Cost differs correctly across profiles' models.
- **Validation**: Unit test per model id.

### Task 4.2: Structured logging + graceful shutdown
- **Location**: `src/server/index.ts` (26 `console.*` sites), signal handlers
- **Description**: Introduce a minimal leveled logger; handle SIGTERM/SIGINT to drain sockets and
  flush telemetry. Close MCP clients on exit.
- **Acceptance Criteria**: Clean shutdown closes sockets/MCP; logs are level-tagged.
- **Validation**: Manual SIGTERM test; assert sockets closed.

## Testing Strategy
- Each task ships with a unit/contract test in `tests/` matching existing naming.
- Security tasks (S1/S2) get explicit negative tests (rejected/no-leak).
- After Sprint 3, CI gates typecheck + lint + test on every PR.

## Potential Risks & Gotchas
- S1 may break existing TUI/CLI/web clients that don't send a token — update all three clients
  (`src/cli`, `src/tui`, `web/`) and the `hello` handshake together, behind the "key set" condition.
- 3.1 fix may surface previously-hidden real test failures — triage before merging CI gate.
- 2.1 retry must not double-count tokens/cost on retried turns — only count the successful stream.
- Env scrubbing (1.2) could break tools that legitimately need a token — provide profile opt-in.

## Rollback Plan
- All changes are additive/config; revert per-commit. Auth (S1) gated on `HARNESS_API_KEY`
  presence, so unsetting it restores prior open-dev behavior instantly.
