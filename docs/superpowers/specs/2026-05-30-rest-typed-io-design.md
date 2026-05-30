# Programmatic Agent Contracts (REST + Typed I/O) — Design Spec

**Date:** 2026-05-30
**Feature:** ROADMAP #4 — Programmatic agent contracts (REST + typed I/O)
**Status:** Approved, pending implementation

---

## Overview

Today the only interface to the harness is WebSocket streaming chat. This feature adds an HTTP layer so the harness is usable as a backend building block: a one-shot `POST /run` endpoint and a streaming `POST /stream` (SSE) endpoint, plus optional per-profile typed input/output contracts validated with `ajv`.

The HTTP server shares the existing port with the WS server. Profiles without a `contract` block remain fully usable over REST — they accept a plain string and return freeform text. The WS chat path is unchanged.

This is also the shared HTTP foundation that #5 (triggered + durable agents) and #6 (A2A + ACP) build on.

---

## Architecture

The existing `WebSocketServer` is wrapped onto a shared `http.createServer`. The HTTP server owns port 7337; WS attaches via the `upgrade` event. No new framework — a small hand-rolled router on plain `http`, consistent with the lean codebase.

```
http.Server (:7337)
 ├─ upgrade → WebSocketServer (existing chat, unchanged)
 └─ request → REST router
      POST /run     → runProfileOnce → { output, usage }
      POST /stream  → runProfileOnce + SSE event adapter
      GET  /health  → { status, profile, version }
```

### New modules

| File | Role |
|------|------|
| `src/server/rest.ts` | Route dispatch, auth check, body parse, error→status mapping |
| `src/server/run-profile.ts` | `runProfileOnce()` — shared one-shot run: build session/memory/mcp/context, run loop, extract final text + usage, cleanup |
| `src/server/contract.ts` | Compile profile `contract` schemas, build output instruction, parse + validate output |
| `src/shared/json-contract.ts` | Fence-strip + `JSON.parse` + ajv validate (shared with `runner.ts`) |

`runProfileOnce()` centralizes the load-profile → session → memory → loop → extract-text logic currently duplicated across `delegate.ts` and `runner.ts`. A REST run is a **root** call: `delegateDepth: 0`, `agentTools` loaded via `loadAgentTools(profile)` — so a `/run` can itself fan out to registered sub-agents and honors `max_depth`.

`src/shared/json-contract.ts` extracts the markdown-fence-strip + parse + validate logic that currently lives inline in `runner.ts`. `runner.ts` is refactored to call the shared util so the two paths cannot drift.

---

## Profile Schema — optional `contract` block

A new optional top-level field on `ProfileSchema`:

```yaml
contract:
  input:                      # JSON Schema; validated on /run input
    type: object
    properties:
      query: { type: string }
    required: [query]
  output:                     # JSON Schema; agent instructed + output hard-validated
    type: object
    properties:
      findings: { type: string }
    required: [findings]
```

```typescript
contract: z.object({
  input:  z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
}).optional()
```

- `input` and `output` are independently optional standard JSON Schema objects (draft-07 compatible).
- No `contract` block → freeform passthrough (string in, text out).
- `contract.input` without `contract.output` → input validated, output freeform.
- `contract.output` without `contract.input` → input is a plain string, output hard-validated.

---

## `POST /run`

One-shot synchronous run.

**Request body:**

```json
{ "profile": "researcher", "user": "alice", "input": { "query": "..." } }
```

- `profile` (optional) — target profile name. Omitted → the server's default (boot) profile. Resolved via the same discovery as the `Delegate` tool: `profiles/<name>.yaml`, then `~/.harness/profiles/<name>.yaml`.
- `user` (optional) — passed through `sanitizeUserId`; scopes session, memory, and usage. Defaults to `HARNESS_USER` env or `"anonymous"`.
- `input` (required):
  - If the target profile has `contract.input`: `input` must be a JSON **object**, validated with `ajv`. The user message sent to the loop is `JSON.stringify(input, null, 2)` followed by an output-schema instruction when `contract.output` is present (the same serialization `runner.ts` uses).
  - If the profile has **no** `contract.input`: `input` must be a **string**, used verbatim as the user message.

**Response 200:**

```json
{
  "output": { "findings": "..." },
  "usage": { "tokens_in": 1234, "tokens_out": 567, "cost_usd": 0.012 },
  "session_id": "2026-05-30_ab12cd"
}
```

- `output` is the validated JSON object when `contract.output` is set, otherwise the freeform final assistant text (string).
- `usage` is the session usage delta (a fresh session starts at zero, so this equals the run's usage). `recordUsage(user, usage)` is also called server-side.

**Error responses:**

| Status | Condition | Body |
|--------|-----------|------|
| `400` | Malformed JSON body, missing `input`, or wrong `input` type for the profile | `{ "error": "..." }` |
| `401` | `HARNESS_API_KEY` set and bearer token missing/wrong | `{ "error": "unauthorized" }` |
| `404` | Named profile not found | `{ "error": "profile \"x\" not found" }` |
| `422` | Input or output failed schema validation | `{ "error": "...", "details": [...] }` |
| `500` | Agent loop threw (provider error, etc.) | `{ "error": "..." }` |

---

## `POST /stream` (SSE)

Same request body as `/run`. Returns `Content-Type: text/event-stream`.

Pre-run failures (auth, body parse, profile-not-found, input validation) return a normal HTTP error status — the SSE stream never opens. Once the run has started, all subsequent errors (including output validation) are emitted as an SSE `error` event.

**Event sequence:**

```
event: token      data: {"content":"..."}
event: tool_start data: {"name":"...","input":{...}}
event: tool_end   data: {"name":"...","result":"..."}
event: stats      data: {"tokens_in":N,"tokens_out":N,"cost_usd":N}
event: result     data: {"output":...,"usage":{...},"session_id":"..."}   ← terminal, success
event: error      data: {"error":"..."}                                    ← terminal, failure
```

- `token` / `tool_start` / `tool_end` / `stats` map directly onto the existing `AgentLoopEvents` callbacks.
- `result` is the terminal success event, carrying the same `{ output, usage, session_id }` payload as a `/run` 200 response.
- Client disconnect (request `close` event) triggers `abortController.abort()`, which stops the loop.

---

## Auth, Identity & Headless Tool Safety

### Auth

- If `HARNESS_API_KEY` env var is set, all REST routes (except `GET /health`) require `Authorization: Bearer <key>`; a missing or mismatched token returns `401`.
- If `HARNESS_API_KEY` is unset, REST is open and the server logs a one-line startup warning that the REST surface is unauthenticated.
- The WS path is unaffected by `HARNESS_API_KEY`.

### Identity

The `user` field flows through `sanitizeUserId` and scopes session, memory provider, and usage ledger exactly as the WS `hello` message does. Default: `HARNESS_USER` env or `"anonymous"`.

### Headless tool ACL

There is no interactive approver over an HTTP request, so a REST run supplies an `onToolPrompt` callback that resolves **`false`**. Effect: any tool whose ACL resolves to `prompt` is auto-denied — the agent receives a denial result string and continues. Only `allow` tools execute over REST.

This is the safe default: destructive defaults like `Bash` (`prompt`) stay denied over REST unless a profile explicitly sets the tool to `allow`. This `onToolPrompt`-returns-false seam is where #9 (instance modes) will later layer mode-specific policy. No change to `agent-loop.ts` ACL logic is required — the behavior falls out of the provided events object.

---

## Shared Run Helper

```typescript
interface Usage { tokens_in: number; tokens_out: number; cost_usd: number }

interface RunProfileResult {
  finalText: string
  usage: Usage
  session: Session
}

interface RunProfileOptions {
  profile: Profile
  userId: string
  userMessage: string
  events: AgentLoopEvents
  signal?: AbortSignal
}

async function runProfileOnce(opts: RunProfileOptions): Promise<RunProfileResult>
```

Responsibilities (mirrors the setup already in `server/index.ts` and `runner.ts`):

1. Create provider client and MCP clients for the profile.
2. Create a fresh session scoped to `userId`; select memory provider (`fs` / `graph`).
3. Build the system prompt (`system_prompt` file + skill index + memory section).
4. Load `agentTools` via `loadAgentTools(profile)`; build a root `ToolContext` (`delegateDepth: 0`, `maxDepth: profile.max_depth ?? 2`).
5. Run `runAgentLoop(userMessage, ...)`.
6. Extract the final assistant message (reverse-scan, same pattern as `delegate.ts`/`runner.ts`).
7. Compute usage from `session.usage`; call `recordUsage(userId, usage)`.
8. `destroyMcpClients` in a `finally`.
9. Return `{ finalText, usage, session }`.

`stats` reach the caller through the passed-in `events.onStats`; `/run` ignores them and reads `session.usage` at the end, while `/stream` forwards them as SSE `stats` events.

---

## Contract Module

```typescript
interface CompiledContract {
  inputValidator?: ValidateFunction
  outputValidator?: ValidateFunction
  outputSchema?: Record<string, unknown>
}

function compileContract(profile: Profile): CompiledContract
function buildUserMessage(input: unknown, contract: CompiledContract, rawProfileContract): string
function parseAndValidateOutput(rawText: string, contract: CompiledContract): { ok: true; value: unknown } | { ok: false; details: string[] }
```

- `compileContract` compiles whichever of `input` / `output` are present into `ajv` validators (once per request; profiles are loaded per request).
- `buildUserMessage` produces the loop input: object → `JSON.stringify` + output instruction when `contract.output` exists; string → verbatim.
- `parseAndValidateOutput` delegates fence-strip + parse to `src/shared/json-contract.ts`, then validates against `outputValidator` if present, else returns the raw text as the value.

---

## `src/shared/json-contract.ts`

```typescript
import type { ValidateFunction } from 'ajv'

// Strip a ```json ... ``` fence if present, JSON.parse, optionally validate.
export function parseJsonContract(
  raw: string,
  validator?: ValidateFunction
): { ok: true; value: unknown } | { ok: false; error: string }
```

Extracted from the inline logic in `runner.ts` (steps 5–6). `runner.ts` is refactored to call `parseJsonContract` so REST and sub-agent paths share one implementation and cannot drift.

---

## Files Changed

| File | Change |
|------|--------|
| `src/profiles/schema.ts` | Add optional `contract: { input?, output? }` block to `ProfileSchema` |
| `src/server/index.ts` | Replace bare `WebSocketServer({ port })` with a shared `http.createServer`; attach WS via `upgrade`; mount REST router; log auth-status warning at startup |
| `src/server/rest.ts` | **New** — HTTP router: `/health`, `/run`, `/stream`; auth; body parse; error→status mapping |
| `src/server/run-profile.ts` | **New** — `runProfileOnce()` shared one-shot run helper |
| `src/server/contract.ts` | **New** — compile contract schemas, build user message, parse + validate output |
| `src/shared/json-contract.ts` | **New** — fence-strip + parse + validate util |
| `src/agents/runner.ts` | Refactor steps 5–6 to use `parseJsonContract` |
| `docs/ROADMAP.md` | Mark #4 as `🔄 In progress`, then `✅` on completion |

---

## Testing

- **`json-contract` util:** fenced JSON, bare JSON, non-JSON (error), schema pass, schema fail.
- **`contract.ts`:** compile with neither / input-only / output-only / both; input validation pass and fail; user-message build for object vs string.
- **`run-profile.ts`:** mock `runAgentLoop` to push an assistant message; assert final-text extraction, usage from `session.usage`, `recordUsage` called, `destroyMcpClients` called in `finally`.
- **`rest.ts` integration:** boot the http server on an ephemeral port with a stub profile and a mocked provider; assert:
  - `GET /health` → 200 with profile name
  - `POST /run` freeform (no contract) → 200 string output
  - `POST /run` with contract → 200 object output
  - bad input type / missing input → 400
  - input schema violation → 422
  - `HARNESS_API_KEY` set + missing bearer → 401
  - unknown profile → 404
- **`/stream`:** connect, assert event ordering ends with a `result` event carrying `output` + `usage`.

---

## Out of Scope

- Cron / webhook triggers and durable, resumable runs (ROADMAP #5)
- A2A / ACP agent cards and interop endpoints (ROADMAP #6)
- Interactive tool approval over SSE (a REST run auto-denies `prompt` tools)
- Authentication beyond a single shared bearer token (no per-user keys, OAuth, etc.)
- Concurrency/throughput optimization (MCP clients are created and torn down per request, matching the current sub-agent behavior)
