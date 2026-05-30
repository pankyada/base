# Pluggable Code Execution — Design Spec

> **Status:** Approved for implementation
> **Date:** 2026-05-30
> **Roadmap item:** #11

---

## Goal

Let agents execute code inside a safe sandbox. Two backends for MVP: **WASM** (Pyodide in the browser — zero server-side risk, Python only) and **Docker** (any language, server-side subprocess, automatic fallback for TUI and non-Python). Future backends (E2B, Daytona) drop in without touching existing code.

---

## Architecture

The `ExecuteCode` built-in tool delegates to an `Executor` interface. An `ExecutorFactory` resolves which implementation to use at call time based on profile config and whether the connected client supports WASM. The server relays `code_execute` / `code_result` WS messages to bridge the WASM path between tool and browser.

```
Agent calls ExecuteCode(code, language, data)
  → ExecutorFactory.resolve(profile, context)
      → WasmExecutor   if client is browser + profile.executor.default = wasm
      → DockerExecutor otherwise (TUI, non-Python, or profile forces docker)
  → Executor.execute(req) → ExecutionResult
  → Tool formats result → returned to agent
```

---

## Data Model

### `ExecutionRequest`
```typescript
interface ExecutionRequest {
  id: string
  code: string
  language: string                 // 'python', 'javascript', 'bash', etc.
  data?: Record<string, unknown>   // serializable blobs passed to executor
  timeout_ms?: number              // default: profile.executor.timeout_ms ?? 30000
}
```

### `ExecutionResult`
```typescript
interface ExecutionResult {
  stdout: string
  stderr: string
  exit_code: number
  files: Record<string, string>    // filename → base64-encoded content
  duration_ms: number
}
```

---

## WS Protocol Extensions

### `src/types.ts` + `web/lib/types.ts`

**`hello` gains optional field:**
```typescript
{ type: 'hello'; user_id: string; wasm_supported?: boolean }
```

**New `ServerMessage` variant:**
```typescript
{ type: 'code_execute'; id: string; code: string; language: string; data?: Record<string, unknown> }
```

**New `ClientMessage` variant:**
```typescript
{ type: 'code_result'; id: string; stdout: string; stderr: string; exit_code: number; files: Record<string, string> }
```

---

## Profile Schema

New optional `executor` block in `src/profiles/schema.ts`:

```yaml
executor:
  default: wasm              # wasm | docker — used when client signals capability
  fallback: docker           # used when default unavailable (always docker for now)
  docker_image: python:3.12-slim
  timeout_ms: 30000
  allowed_packages:          # pre-installed in Pyodide on client boot
    - pandas
    - numpy
    - matplotlib
```

If `executor:` is absent from the profile, `ExecuteCode` returns `"Code execution not enabled in this profile"` and exits cleanly.

---

## Executor Interface + Backends

### Interface (`src/executor/interface.ts`)
```typescript
interface Executor {
  execute(req: ExecutionRequest): Promise<ExecutionResult>
}
```

### `DockerExecutor` (`src/executor/docker.ts`)
- Runs: `docker run --rm --network none --memory 512m --cpus 1 --user 1000:1000 -i <image>`
- Pipes `req.data` serialized as JSON to stdin; agent-authored code reads it via `import sys, json; data = json.load(sys.stdin)` (Python) or `JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))` (Node)
- Mounts a temp output dir (`/out`) read-write; code writes files there; executor reads and base64-encodes them after completion
- Captures stdout + stderr via `spawn`
- Kills container on timeout; returns `exit_code: 124` (standard timeout convention)
- Works for any language — image is configurable per profile

### `WasmExecutor` (`src/executor/wasm.ts`)
- Calls `context.events.onCodeExecute(id, code, language, data)` → `Promise<ExecutionResult>`
- Server sends `code_execute` WS message; browser `HarnessPython` component runs Pyodide and sends back `code_result`
- **Non-Python languages:** `WasmExecutor` checks `language !== 'python'` and throws `UnsupportedLanguageError`; `ExecutorFactory` catches this and retries with `DockerExecutor`

### `ExecutorFactory` (`src/executor/factory.ts`)
```typescript
async function executeWithFallback(profile: Profile, context: ToolContext, req: ExecutionRequest): Promise<ExecutionResult> {
  const cfg = profile.executor
  const canWasm = context.wasmSupported === true && cfg?.default === 'wasm'
  if (canWasm) {
    try {
      return await new WasmExecutor(context).execute(req)
    } catch (e) {
      if (!(e instanceof UnsupportedLanguageError)) throw e
      // non-Python: fall through to Docker
    }
  }
  return new DockerExecutor(cfg).execute(req)
}
```

`UnsupportedLanguageError` is exported from `src/executor/interface.ts` alongside the `Executor` interface.

---

## `ExecuteCode` Tool (`src/tools/builtin/execute-code.ts`)

**Parameters:**
```typescript
{
  code: string
  language: string
  data?: Record<string, unknown>
  timeout_ms?: number
}
```

**Execution:**
1. If `profile.executor` absent → return `"Code execution not enabled in this profile"`
2. Resolve executor via `ExecutorFactory`
3. Call `executor.execute(req)`
4. Format result:
   ```
   exit_code: 0
   stdout: <stdout>
   stderr: <stderr>
   files: output.csv (1.2 KB), plot.png (45 KB)
   duration: 1234ms
   ```
5. On error: return `"Error: <message>"`

---

## Server Wiring (`src/server/index.ts`)

- `hello` handler stores `wasm_supported` on session
- `pendingCodeExecutions: Map<string, (result: ExecutionResult) => void>` — same pattern as `pendingApprovals`
- `code_result` handler resolves pending promise
- `onCodeExecute` event: sends `code_execute` WS message + registers in `pendingCodeExecutions`
- `wasmSupported` passed into `ToolContext`

**`AgentLoopEvents` addition** (`src/tools/types.ts`):
```typescript
onCodeExecute?(id: string, code: string, language: string, data?: Record<string, unknown>): Promise<ExecutionResult>
```

**`ToolContext` addition** (`src/tools/types.ts`):
```typescript
wasmSupported?: boolean
```

---

## `HarnessPython` Web Component (`web/components/HarnessPython.tsx`)

- Mounted invisibly in `HarnessApp` when `profile.executor` is present
- Receives `allowedPackages` as prop
- Boots Pyodide lazily on first `code_execute` message (not on mount — avoids 10MB load if never used)
- Installs `allowedPackages` after boot
- On `code_execute`: runs code via `pyodide.runPythonAsync`, captures stdout/stderr, sends `code_result`
- Files: code writes to a virtual `/out` FS inside Pyodide; component reads and base64-encodes them after execution
- Non-Python `code_execute` messages: component ignores them (server should have routed to Docker)

---

## Security (Docker)

| Constraint | Value |
|-----------|-------|
| Network | `--network none` |
| Memory | `--memory 512m` |
| CPU | `--cpus 1` |
| User | `--user 1000:1000` (non-root) |
| Container lifecycle | `--rm` always |
| Filesystem | temp output dir mounted at `/out`; nothing else writable |
| Timeout | killed after `timeout_ms`; exit code 124 |

---

## Files Created / Modified

| Status | Path | Change |
|--------|------|--------|
| Create | `src/executor/interface.ts` | `Executor` interface + `ExecutionRequest` / `ExecutionResult` types |
| Create | `src/executor/docker.ts` | `DockerExecutor` |
| Create | `src/executor/wasm.ts` | `WasmExecutor` |
| Create | `src/executor/factory.ts` | `resolveExecutor()` |
| Create | `src/tools/builtin/execute-code.ts` | `ExecuteCode` tool |
| Create | `web/components/HarnessPython.tsx` | Pyodide bootstrap + WS relay |
| Modify | `src/types.ts` | `code_execute`, `code_result`, `wasm_supported` |
| Modify | `web/lib/types.ts` | Same |
| Modify | `src/profiles/schema.ts` | `executor:` block |
| Modify | `src/tools/types.ts` | `onCodeExecute`, `wasmSupported` |
| Modify | `src/tools/builtin/index.ts` | Register `executeCodeTool` |
| Modify | `src/server/index.ts` | Wire `code_result`, `onCodeExecute`, `wasmSupported` |
| Modify | `web/components/HarnessApp.tsx` | Mount `HarnessPython` |

---

## Testing Strategy

- **`tests/executor-docker.test.ts`** — unit tests for `DockerExecutor`: stdout capture, stderr capture, timeout, non-zero exit code, file output, data passing via stdin. Uses real Docker (integration-style — no mocks).
- **`tests/executor-wasm.test.ts`** — unit tests for `WasmExecutor`: verifies `onCodeExecute` is called with correct args, promise resolves with injected result, non-Python throws `UnsupportedLanguageError`.
- **`tests/execute-code-tool.test.ts`** — unit tests for `ExecuteCode` tool: no `executor` config returns graceful message, routes to correct executor, formats result correctly.
- **`tests/executor-factory.test.ts`** — factory routing: WASM when `wasmSupported=true` + config `default: wasm`; Docker otherwise; Docker when language unsupported by WASM.
