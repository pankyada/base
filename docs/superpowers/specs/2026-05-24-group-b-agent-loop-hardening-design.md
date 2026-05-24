# Group B — Agent Loop Hardening Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the agent loop with parallel tool execution, async hooks with timeout, and smart context window management.

**Architecture:** Three independent improvements to `src/loop/agent-loop.ts` and `src/hooks/runner.ts`. Each is self-contained and can be implemented and tested in isolation.

**Tech Stack:** TypeScript, Node.js `child_process/promises`, OpenAI SDK, Vitest

---

## Feature 1: Parallel Tool Execution

### Overview

When the LLM returns multiple tool calls, `allow`-ACL tools run in parallel; `prompt`/`deny` tools are handled serially. Order in `session.messages` is always preserved (LLM-specified index order, not completion order).

### Strategy (C)

Walk tool calls in original LLM order:

1. Accumulate consecutive `allow` tools into a **pending batch**.
2. When a `prompt` or `deny` tool is encountered:
   - Flush the pending batch first (`Promise.all` all accumulated `allow` tools).
   - Handle the `prompt`/`deny` tool serially.
3. After all tool calls are walked, flush any remaining pending batch.
4. Results are pushed to `session.messages` in **original index order** — each parallel execution writes to a pre-allocated slot, not appended by completion order.

### Pre/post hooks

Each tool in a parallel batch still gets its own `pre_tool` → execute → `post_tool` hook sequence. Hooks for different tools within the same batch may interleave (acceptable — they're independent scripts).

### Constraints

- `prompt` approval dialogs are always serial — the WebSocket protocol is one approval at a time.
- `deny` tools never need approval; they produce an error message immediately.
- Tool result messages must appear in the same order as the `tool_calls` array in the assistant message — OpenAI requires this.

---

## Feature 2: Hook Async + Timeout

### Overview

Replace blocking `execSync` in `src/hooks/runner.ts` with async `exec` from `child_process/promises`. Each hook command gets a configurable timeout; timeouts log a warning and continue without crashing.

### Profile schema addition

```yaml
hooks:
  timeout_ms: 5000   # ms per hook command, default 5000
  pre_tool: [...]
  post_tool: [...]
  on_stop: [...]
```

Schema: `timeout_ms: z.number().default(5000)` added to the hooks object in `ProfileSchema`.

### `runHooks` signature change

```typescript
export async function runHooks(
  hookType: HookType,
  profile: Profile,
  env: Record<string, string>
): Promise<void>
```

- Hooks within a hook type run **sequentially** (order matters for side-effectful scripts).
- Each command is wrapped in `Promise.race([execPromise, timeoutPromise])`.
- On timeout: log `[hook:${hookType}] timed out after ${timeout_ms}ms: ${cmd}` and continue.
- On error: existing behaviour (log stderr, continue).

### Callers

Both `src/loop/agent-loop.ts` and `src/server/index.ts` must `await runHooks(...)`.

---

## Feature 3: Context Window Management

### Overview

Before each LLM call, estimate total token usage. If over threshold, condense older messages via LLM summarisation, preserving "anchor" messages (structured reference documents) verbatim.

### Profile schema addition

```yaml
context_window:
  max_tokens: 100000    # summarise when estimated tokens exceed this
  model_id: ~           # optional model for summarisation (cheaper model ok)
```

Schema:
```typescript
context_window: z.preprocess(
  (val) => val ?? {},
  z.object({
    max_tokens: z.number().default(100000),
    model_id: z.string().optional(),
  })
).optional()
```

### Token estimation

```typescript
function estimateTokens(messages: unknown[]): number {
  const chars = JSON.stringify(messages).length
  return Math.ceil(chars / 4)
}
```

No external dependency — fast, accurate enough for triggering heuristic.

### Anchor detection

A tool result message (role: `'tool'`) is an **anchor** if:
- `content.length >= 400`, AND
- `content.startsWith('#')` OR `content.includes('\n#')`

Anchors are preserved verbatim. They capture: CLAUDE.md reads, plan files, skill files, memory docs.

### Condensation algorithm

Triggered at the top of the `while(true)` loop in `agent-loop.ts` when `estimateTokens(session.messages) > profile.context_window?.max_tokens ?? Infinity`.

1. **Always keep:** `session.messages[0]` (system) + last 6 messages + all anchor tool-result messages.
2. **Summarisable:** all other messages not in the keep set.
3. If no summarisable messages, return early (nothing to condense).
4. Call LLM (using `profile.context_window?.model_id ?? profile.model.id`):
   ```
   Summarise this conversation history concisely. Preserve: key decisions made,
   tasks completed, current goals, important values or file contents mentioned.
   Output plain text, no JSON.
   ```
5. Replace summarisable messages with a single injected message:
   ```
   { role: 'user', content: '[Earlier conversation summary: <summary>]' }
   ```
6. Mutate `session.messages` in place.

### New file

`src/loop/context-manager.ts` — exports one function:

```typescript
export async function maybeCondenseMessages(
  session: Session,
  profile: Profile,
  openai: OpenAI
): Promise<void>
```

Called at the top of the `while(true)` loop in `agent-loop.ts` before each LLM call.

---

## Files Changed

| File | Change |
|------|--------|
| `src/profiles/schema.ts` | Add `hooks.timeout_ms`, `context_window` fields |
| `src/hooks/runner.ts` | Replace `execSync` with async `exec` + timeout |
| `src/loop/agent-loop.ts` | Parallel tool execution + await hooks + call context manager |
| `src/loop/context-manager.ts` | New — `maybeCondenseMessages()` |
| `src/server/index.ts` | `await runHooks(...)` for `on_stop` |
| `tests/hooks.test.ts` | Test timeout behaviour |
| `tests/context-manager.test.ts` | Test anchor detection, condensation trigger |
| `tests/agent-loop.test.ts` | Test parallel execution order |
