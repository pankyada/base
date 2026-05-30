# Pluggable Code Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `ExecuteCode` built-in tool that runs code in a WASM sandbox (Pyodide, browser-only, Python) or Docker subprocess (any language, server-side), with raw data passing and file output support.

**Architecture:** An `Executor` interface with `DockerExecutor` and `WasmExecutor` implementations; an `ExecutorFactory` that picks the right one based on profile config and client capability (`wasm_supported` flag on `hello`). The server relays `code_execute`/`code_result` WS messages to bridge the WASM path between the tool and the browser. `HarnessPython` mounts invisibly in the web client, boots Pyodide lazily, and handles the round-trip.

**Tech Stack:** TypeScript, Node.js `child_process.spawn` (Docker), Pyodide npm package (WASM), Zod (profile schema), Vitest (tests), Next.js App Router (web component)

---

## File Map

| Status | Path | Responsibility |
|--------|------|---------------|
| Create | `src/executor/interface.ts` | `Executor` interface, `ExecutionRequest`, `ExecutionResult`, `UnsupportedLanguageError` |
| Create | `src/executor/docker.ts` | `DockerExecutor` — spawns `docker run`, captures output, handles files + timeout |
| Create | `src/executor/wasm.ts` | `WasmExecutor` — relays to browser via `onCodeExecute` event |
| Create | `src/executor/factory.ts` | `executeWithFallback()` — routes to WASM or Docker, retries on `UnsupportedLanguageError` |
| Create | `src/tools/builtin/execute-code.ts` | `ExecuteCode` tool — validates config, delegates to factory, formats result |
| Create | `web/components/HarnessPython.tsx` | Pyodide bootstrap, `/out` FS, `code_execute` handler, `code_result` sender |
| Modify | `src/types.ts` | Add `code_execute` ServerMessage, `code_result` ClientMessage, `wasm_supported` to `hello` |
| Modify | `web/lib/types.ts` | Same additions |
| Modify | `src/profiles/schema.ts` | Add optional `executor` Zod block |
| Modify | `src/tools/types.ts` | Add `onCodeExecute` to `AgentLoopEvents`, `wasmSupported` to `ToolContext` |
| Modify | `src/tools/builtin/index.ts` | Register `executeCodeTool` |
| Modify | `src/server/index.ts` | Handle `code_result`, wire `onCodeExecute` event, pass `wasmSupported` to context |
| Modify | `web/components/HarnessApp.tsx` | Add `pendingCodeExecution` state, mount `HarnessPython` |
| Create | `tests/executor-wasm.test.ts` | Unit tests for `WasmExecutor` |
| Create | `tests/executor-factory.test.ts` | Unit tests for `executeWithFallback` routing |
| Create | `tests/execute-code-tool.test.ts` | Unit tests for `ExecuteCode` tool |
| Create | `tests/executor-docker.test.ts` | Integration tests for `DockerExecutor` (requires Docker) |

---

## Task 1: Protocol types + profile schema

**Files:**
- Modify: `src/types.ts`
- Modify: `web/lib/types.ts`
- Modify: `src/profiles/schema.ts`

- [ ] **Step 1: Update `src/types.ts`**

Add to the `ClientMessage` union (after the existing `tool_deny` variant):
```typescript
| { type: 'code_result'; id: string; stdout: string; stderr: string; exit_code: number; files: Record<string, string> }
```

Change the `hello` variant to:
```typescript
| { type: 'hello'; user_id: string; wasm_supported?: boolean }
```

Add to the `ServerMessage` union:
```typescript
| { type: 'code_execute'; id: string; code: string; language: string; data?: Record<string, unknown> }
```

- [ ] **Step 2: Mirror same changes in `web/lib/types.ts`**

Identical additions — `code_result` ClientMessage, `wasm_supported` on `hello`, `code_execute` ServerMessage.

- [ ] **Step 3: Add `executor` block to `ProfileSchema` in `src/profiles/schema.ts`**

Add this schema definition before the `ProfileSchema` export:
```typescript
const ExecutorSchema = z.object({
  default: z.enum(['wasm', 'docker']).default('docker'),
  fallback: z.literal('docker').default('docker'),
  docker_image: z.string().default('python:3.12-slim'),
  timeout_ms: z.number().default(30000),
  allowed_packages: z.array(z.string()).default([]),
})

export type ExecutorConfig = z.infer<typeof ExecutorSchema>
```

Add as an optional field inside `ProfileSchema`:
```typescript
executor: ExecutorSchema.optional(),
```

- [ ] **Step 4: Type-check**

```bash
pnpm typecheck
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/types.ts web/lib/types.ts src/profiles/schema.ts
git commit -m "feat: add code_execute/code_result protocol + executor profile schema"
```

---

## Task 2: Executor interface

**Files:**
- Create: `src/executor/interface.ts`

- [ ] **Step 1: Create `src/executor/interface.ts`**

```typescript
export interface ExecutionRequest {
  id: string
  code: string
  language: string
  data?: Record<string, unknown>
  timeout_ms?: number
}

export interface ExecutionResult {
  id: string
  stdout: string
  stderr: string
  exit_code: number
  files: Record<string, string>   // filename → base64-encoded content
  duration_ms: number
}

export interface Executor {
  execute(req: ExecutionRequest): Promise<ExecutionResult>
}

export class UnsupportedLanguageError extends Error {
  constructor(language: string) {
    super(`Language "${language}" is not supported by this executor`)
    this.name = 'UnsupportedLanguageError'
  }
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/executor/interface.ts
git commit -m "feat: add Executor interface, ExecutionRequest/Result types, UnsupportedLanguageError"
```

---

## Task 3: AgentLoopEvents + ToolContext extension

**Files:**
- Modify: `src/tools/types.ts`

- [ ] **Step 1: Add `onCodeExecute` and `wasmSupported` to `src/tools/types.ts`**

Add the import at the top:
```typescript
import type { ExecutionResult } from '../executor/interface.js'
```

Add to the `AgentLoopEvents` interface:
```typescript
onCodeExecute?(id: string, code: string, language: string, data?: Record<string, unknown>): Promise<ExecutionResult>
```

Add to the `ToolContext` interface:
```typescript
wasmSupported?: boolean
```

- [ ] **Step 2: Type-check**

```bash
pnpm typecheck
```
Expected: no errors — existing callers use optional fields so backward-compatible.

- [ ] **Step 3: Commit**

```bash
git add src/tools/types.ts
git commit -m "feat: add onCodeExecute event and wasmSupported flag to agent types"
```

---

## Task 4: WasmExecutor

**Files:**
- Create: `src/executor/wasm.ts`
- Create: `tests/executor-wasm.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/executor-wasm.test.ts
import { describe, it, expect, vi } from 'vitest'
import { WasmExecutor } from '../src/executor/wasm.js'
import { UnsupportedLanguageError } from '../src/executor/interface.js'

function makeCtx(onCodeExecute?: (...args: any[]) => any): any {
  return { events: { onCodeExecute } }
}

describe('WasmExecutor', () => {
  it('calls onCodeExecute and returns the result', async () => {
    const fakeResult = { id: 'abc', stdout: 'hello\n', stderr: '', exit_code: 0, files: {}, duration_ms: 100 }
    const onCodeExecute = vi.fn().mockResolvedValue(fakeResult)
    const executor = new WasmExecutor(makeCtx(onCodeExecute))

    const result = await executor.execute({ id: 'abc', code: 'print("hello")', language: 'python' })

    expect(onCodeExecute).toHaveBeenCalledWith('abc', 'print("hello")', 'python', undefined)
    expect(result).toEqual(fakeResult)
  })

  it('passes data to onCodeExecute', async () => {
    const fakeResult = { id: 'x', stdout: '', stderr: '', exit_code: 0, files: {}, duration_ms: 10 }
    const onCodeExecute = vi.fn().mockResolvedValue(fakeResult)
    const executor = new WasmExecutor(makeCtx(onCodeExecute))
    const data = { x: 1, y: [2, 3] }

    await executor.execute({ id: 'x', code: 'pass', language: 'python', data })

    expect(onCodeExecute).toHaveBeenCalledWith('x', 'pass', 'python', data)
  })

  it('throws UnsupportedLanguageError for non-python languages', async () => {
    const executor = new WasmExecutor(makeCtx())

    await expect(executor.execute({ id: 'y', code: 'console.log(1)', language: 'javascript' }))
      .rejects.toBeInstanceOf(UnsupportedLanguageError)
  })

  it('throws if onCodeExecute is not wired', async () => {
    const executor = new WasmExecutor(makeCtx(undefined))

    await expect(executor.execute({ id: 'z', code: 'pass', language: 'python' }))
      .rejects.toThrow('onCodeExecute is not wired')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/executor-wasm.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/executor/wasm.ts`**

```typescript
import type { Executor, ExecutionRequest, ExecutionResult } from './interface.js'
import { UnsupportedLanguageError } from './interface.js'
import type { ToolContext } from '../tools/types.js'

export class WasmExecutor implements Executor {
  constructor(private context: ToolContext) {}

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    if (req.language !== 'python') {
      throw new UnsupportedLanguageError(req.language)
    }
    if (!this.context.events.onCodeExecute) {
      throw new Error('onCodeExecute is not wired — WasmExecutor requires a browser client')
    }
    return this.context.events.onCodeExecute(req.id, req.code, req.language, req.data)
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/executor-wasm.test.ts
```
Expected: 4/4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/executor/wasm.ts tests/executor-wasm.test.ts
git commit -m "feat: add WasmExecutor with Python-only guard and onCodeExecute relay"
```

---

## Task 5: DockerExecutor

**Files:**
- Create: `src/executor/docker.ts`
- Create: `tests/executor-docker.test.ts`

- [ ] **Step 1: Write failing tests**

These tests mock `child_process.spawn` — no real Docker needed.

```typescript
// tests/executor-docker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DockerExecutor } from '../src/executor/docker.js'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const defaultCfg: any = {
  docker_image: 'python:3.12-slim',
  timeout_ms: 5000,
}

function makeSpawnResult(stdout: string, stderr: string, exitCode: number) {
  const EventEmitter = require('events')
  const proc: any = new EventEmitter()
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  setTimeout(() => {
    proc.stdout.emit('data', Buffer.from(stdout))
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr))
    proc.emit('close', exitCode)
  }, 10)
  return proc
}

describe('DockerExecutor', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('runs code and captures stdout', async () => {
    const spawn = vi.spyOn(await import('child_process'), 'spawn')
      .mockReturnValue(makeSpawnResult('hello\n', '', 0) as any)

    const executor = new DockerExecutor(defaultCfg)
    const result = await executor.execute({ id: '1', code: 'print("hello")', language: 'python' })

    expect(result.stdout).toBe('hello\n')
    expect(result.stderr).toBe('')
    expect(result.exit_code).toBe(0)
    expect(result.id).toBe('1')
    expect(spawn).toHaveBeenCalledWith('docker', expect.arrayContaining(['run', '--rm']), expect.any(Object))
  })

  it('captures stderr', async () => {
    vi.spyOn(await import('child_process'), 'spawn')
      .mockReturnValue(makeSpawnResult('', 'SyntaxError\n', 1) as any)

    const executor = new DockerExecutor(defaultCfg)
    const result = await executor.execute({ id: '2', code: 'bad(', language: 'python' })

    expect(result.stderr).toBe('SyntaxError\n')
    expect(result.exit_code).toBe(1)
  })

  it('returns exit_code 124 on timeout', async () => {
    const EventEmitter = require('events')
    const proc: any = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn(() => { setTimeout(() => proc.emit('close', 137), 5) })

    vi.spyOn(await import('child_process'), 'spawn').mockReturnValue(proc as any)

    const executor = new DockerExecutor({ ...defaultCfg, timeout_ms: 50 })
    const result = await executor.execute({ id: '3', code: 'import time; time.sleep(99)', language: 'python' })

    expect(result.exit_code).toBe(124)
    expect(proc.kill).toHaveBeenCalled()
  })

  it('includes duration_ms in result', async () => {
    vi.spyOn(await import('child_process'), 'spawn')
      .mockReturnValue(makeSpawnResult('ok', '', 0) as any)

    const executor = new DockerExecutor(defaultCfg)
    const result = await executor.execute({ id: '4', code: 'pass', language: 'python' })

    expect(typeof result.duration_ms).toBe('number')
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/executor-docker.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/executor/docker.ts`**

```typescript
import { spawn } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Executor, ExecutionRequest, ExecutionResult } from './interface.js'
import type { ExecutorConfig } from '../profiles/schema.js'

const EXTENSIONS: Record<string, string> = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  bash: 'sh',
  ruby: 'rb',
  go: 'go',
  rust: 'rs',
}

const INTERPRETERS: Record<string, string[]> = {
  python: ['python3', '/work/code.py'],
  javascript: ['node', '/work/code.js'],
  typescript: ['ts-node', '/work/code.ts'],
  bash: ['bash', '/work/code.sh'],
  ruby: ['ruby', '/work/code.rb'],
}

export class DockerExecutor implements Executor {
  constructor(private cfg: ExecutorConfig) {}

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const workDir = mkdtempSync(join(tmpdir(), 'harness-exec-'))
    const outDir = join(workDir, 'out')
    mkdirSync(outDir, { mode: 0o777 })

    const ext = EXTENSIONS[req.language] ?? 'txt'
    writeFileSync(join(workDir, `code.${ext}`), req.code, 'utf-8')
    writeFileSync(join(workDir, 'data.json'), JSON.stringify(req.data ?? {}), 'utf-8')

    const interpreter = INTERPRETERS[req.language] ?? ['bash', `/work/code.${ext}`]
    const timeout = req.timeout_ms ?? this.cfg.timeout_ms ?? 30000

    const dockerArgs = [
      'run', '--rm',
      '--network', 'none',
      '--memory', '512m',
      '--cpus', '1',
      '--user', '1000:1000',
      '-v', `${workDir}:/work:ro`,
      '-v', `${outDir}:/out`,
      this.cfg.docker_image,
      ...interpreter,
    ]

    const start = Date.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false

    try {
      const exitCode = await new Promise<number>((resolve) => {
        const proc = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] })

        const timer = setTimeout(() => {
          timedOut = true
          proc.kill('SIGKILL')
        }, timeout)

        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('close', (code) => {
          clearTimeout(timer)
          resolve(timedOut ? 124 : (code ?? 1))
        })
      })

      const files: Record<string, string> = {}
      for (const entry of readdirSync(outDir)) {
        const content = readFileSync(join(outDir, entry))
        files[entry] = Buffer.from(content).toString('base64')
      }

      return { id: req.id, stdout, stderr, exit_code: exitCode, files, duration_ms: Date.now() - start }
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/executor-docker.test.ts
```
Expected: 4/4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/executor/docker.ts tests/executor-docker.test.ts
git commit -m "feat: add DockerExecutor with file I/O, timeout, and any-language support"
```

---

## Task 6: ExecutorFactory

**Files:**
- Create: `src/executor/factory.ts`
- Create: `tests/executor-factory.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/executor-factory.test.ts
import { describe, it, expect, vi } from 'vitest'
import { executeWithFallback } from '../src/executor/factory.js'
import { UnsupportedLanguageError } from '../src/executor/interface.js'

const fakeResult = { id: '1', stdout: 'ok', stderr: '', exit_code: 0, files: {}, duration_ms: 10 }

function makeCtx(wasmSupported = false): any {
  return {
    wasmSupported,
    events: {
      onCodeExecute: vi.fn().mockResolvedValue(fakeResult),
    },
  }
}

function makeProfile(executorDefault: 'wasm' | 'docker' = 'docker'): any {
  return {
    executor: {
      default: executorDefault,
      fallback: 'docker',
      docker_image: 'python:3.12-slim',
      timeout_ms: 5000,
    },
  }
}

describe('executeWithFallback', () => {
  it('uses WasmExecutor when client supports WASM and profile default is wasm', async () => {
    const ctx = makeCtx(true)
    const result = await executeWithFallback(makeProfile('wasm'), ctx, { id: '1', code: 'pass', language: 'python' })

    expect(ctx.events.onCodeExecute).toHaveBeenCalledWith('1', 'pass', 'python', undefined)
    expect(result).toEqual(fakeResult)
  })

  it('uses DockerExecutor when client does not support WASM', async () => {
    const spawnSpy = vi.spyOn(await import('child_process'), 'spawn')
    const EventEmitter = require('events')
    const proc: any = new EventEmitter()
    proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = vi.fn()
    setTimeout(() => { proc.stdout.emit('data', Buffer.from('docker-out')); proc.emit('close', 0) }, 10)
    spawnSpy.mockReturnValue(proc as any)

    const ctx = makeCtx(false)
    const result = await executeWithFallback(makeProfile('wasm'), ctx, { id: '2', code: 'pass', language: 'python' })

    expect(ctx.events.onCodeExecute).not.toHaveBeenCalled()
    expect(result.stdout).toBe('docker-out')
    spawnSpy.mockRestore()
  })

  it('falls back to Docker when WASM throws UnsupportedLanguageError (non-python)', async () => {
    const spawnSpy = vi.spyOn(await import('child_process'), 'spawn')
    const EventEmitter = require('events')
    const proc: any = new EventEmitter()
    proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = vi.fn()
    setTimeout(() => { proc.stdout.emit('data', Buffer.from('node-out')); proc.emit('close', 0) }, 10)
    spawnSpy.mockReturnValue(proc as any)

    const ctx = makeCtx(true)
    const result = await executeWithFallback(makeProfile('wasm'), ctx, { id: '3', code: 'console.log(1)', language: 'javascript' })

    // WASM threw UnsupportedLanguageError → fell back to Docker
    expect(result.stdout).toBe('node-out')
    spawnSpy.mockRestore()
  })

  it('uses DockerExecutor directly when profile default is docker', async () => {
    const spawnSpy = vi.spyOn(await import('child_process'), 'spawn')
    const EventEmitter = require('events')
    const proc: any = new EventEmitter()
    proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = vi.fn()
    setTimeout(() => { proc.emit('close', 0) }, 10)
    spawnSpy.mockReturnValue(proc as any)

    const ctx = makeCtx(true)  // even if WASM capable, profile says docker
    await executeWithFallback(makeProfile('docker'), ctx, { id: '4', code: 'pass', language: 'python' })

    expect(ctx.events.onCodeExecute).not.toHaveBeenCalled()
    spawnSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/executor-factory.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/executor/factory.ts`**

```typescript
import type { ExecutionRequest, ExecutionResult } from './interface.js'
import { UnsupportedLanguageError } from './interface.js'
import { WasmExecutor } from './wasm.js'
import { DockerExecutor } from './docker.js'
import type { Profile } from '../profiles/schema.js'
import type { ToolContext } from '../tools/types.js'

export async function executeWithFallback(
  profile: Profile,
  context: ToolContext,
  req: ExecutionRequest
): Promise<ExecutionResult> {
  const cfg = profile.executor!
  const canWasm = context.wasmSupported === true && cfg.default === 'wasm'

  if (canWasm) {
    try {
      return await new WasmExecutor(context).execute(req)
    } catch (e) {
      if (!(e instanceof UnsupportedLanguageError)) throw e
      // non-python: fall through to Docker
    }
  }

  return new DockerExecutor(cfg).execute(req)
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/executor-factory.test.ts
```
Expected: 4/4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/executor/factory.ts tests/executor-factory.test.ts
git commit -m "feat: add ExecutorFactory with WASM-first routing and UnsupportedLanguage fallback"
```

---

## Task 7: ExecuteCode tool

**Files:**
- Create: `src/tools/builtin/execute-code.ts`
- Modify: `src/tools/builtin/index.ts`
- Create: `tests/execute-code-tool.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/execute-code-tool.test.ts
import { describe, it, expect, vi } from 'vitest'
import { executeCodeTool } from '../src/tools/builtin/execute-code.js'

const fakeResult = { id: 'r1', stdout: 'hello\n', stderr: '', exit_code: 0, files: { 'out.csv': 'aGVsbG8=' }, duration_ms: 250 }

function makeCtx(hasExecutor = true, wasmSupported = false): any {
  return {
    wasmSupported,
    profile: hasExecutor
      ? { executor: { default: 'docker', fallback: 'docker', docker_image: 'python:3.12-slim', timeout_ms: 5000 } }
      : { /* no executor */ },
    session: {},
    events: {
      onCodeExecute: vi.fn().mockResolvedValue(fakeResult),
    },
  }
}

describe('ExecuteCode tool', () => {
  it('returns graceful message when executor not configured', async () => {
    const result = await executeCodeTool.execute({ code: 'pass', language: 'python' }, makeCtx(false))
    expect(result).toBe('Code execution not enabled in this profile — add an executor: block to enable it')
  })

  it('returns formatted output on success', async () => {
    vi.spyOn(await import('../../src/executor/factory.js'), 'executeWithFallback').mockResolvedValue(fakeResult)

    const result = await executeCodeTool.execute({ code: 'print("hello")', language: 'python' }, makeCtx(true))

    expect(result).toContain('exit_code: 0')
    expect(result).toContain('hello\n')
    expect(result).toContain('out.csv')
    expect(result).toContain('250ms')
  })

  it('includes stderr in output when present', async () => {
    vi.spyOn(await import('../../src/executor/factory.js'), 'executeWithFallback')
      .mockResolvedValue({ ...fakeResult, stderr: 'warning: deprecated\n', exit_code: 0 })

    const result = await executeCodeTool.execute({ code: 'pass', language: 'python' }, makeCtx(true))

    expect(result).toContain('warning: deprecated')
  })

  it('catches errors and returns Error: message', async () => {
    vi.spyOn(await import('../../src/executor/factory.js'), 'executeWithFallback')
      .mockRejectedValue(new Error('Docker not found'))

    const result = await executeCodeTool.execute({ code: 'pass', language: 'python' }, makeCtx(true))

    expect(result).toBe('Error: Docker not found')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/execute-code-tool.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/tools/builtin/execute-code.ts`**

```typescript
import { randomUUID } from 'crypto'
import type { ToolDefinition } from '../types.js'
import { executeWithFallback } from '../../executor/factory.js'

export const executeCodeTool: ToolDefinition = {
  name: 'ExecuteCode',
  description: 'Execute code in a sandbox. Use language="python" for WASM (browser) or any language for Docker. Code can read input data via `/work/data.json` and write output files to `/out/`. Returns stdout, stderr, exit code, and any files written to /out.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Source code to execute' },
      language: { type: 'string', description: 'Language: python, javascript, bash, ruby, typescript, etc.' },
      data: { type: 'object', description: 'Optional data object passed to executor as /work/data.json' },
      timeout_ms: { type: 'number', description: 'Execution timeout in ms (default: profile executor.timeout_ms)' },
    },
    required: ['code', 'language'],
  },
  async execute(input, context) {
    if (!context.profile.executor) {
      return 'Code execution not enabled in this profile — add an executor: block to enable it'
    }

    const { code, language, data, timeout_ms } = input as {
      code: string; language: string; data?: Record<string, unknown>; timeout_ms?: number
    }

    try {
      const result = await executeWithFallback(context.profile, context, {
        id: randomUUID().replace(/-/g, '').slice(0, 8),
        code, language, data, timeout_ms,
      })

      const fileList = Object.entries(result.files)
        .map(([name, b64]) => `  ${name} (${Math.round(Buffer.from(b64, 'base64').length / 1024 * 10) / 10} KB)`)
        .join('\n')

      return [
        `exit_code: ${result.exit_code}`,
        `duration: ${result.duration_ms}ms`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
        fileList ? `files:\n${fileList}` : '',
      ].filter(Boolean).join('\n')
    } catch (e: any) {
      return `Error: ${e.message}`
    }
  },
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/execute-code-tool.test.ts
```
Expected: 4/4 PASS

- [ ] **Step 5: Register in `src/tools/builtin/index.ts`**

Add import:
```typescript
import { executeCodeTool } from './execute-code.js'
```

Add to `registerAll()`:
```typescript
registerTool(executeCodeTool)
```

Also add `ExecuteCode` to `BuiltinToolsSchema` in `src/profiles/schema.ts` with a default of `'allow'`:
```typescript
ExecuteCode: AclValue.default('allow'),
```

- [ ] **Step 6: Type-check + full test run**

```bash
pnpm typecheck && pnpm test
```
Expected: 0 type errors, all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/tools/builtin/execute-code.ts src/tools/builtin/index.ts src/profiles/schema.ts tests/execute-code-tool.test.ts
git commit -m "feat: add ExecuteCode built-in tool with factory delegation and formatted output"
```

---

## Task 8: Server wiring

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add `pendingCodeExecutions` map after `pendingInputRequests`**

In the `wss.on('connection', ...)` block, after `const pendingInputRequests`:
```typescript
const pendingCodeExecutions = new Map<string, (result: any) => void>()
```

- [ ] **Step 2: Store `wasmSupported` on the connection**

After `let mcpEntries: McpEntry[] = []`, add:
```typescript
let wasmSupported = false
```

In the `hello` handler, read the flag:
```typescript
if (msg.type === 'hello') {
  if (session.messages.length === 0) {
    userId = sanitizeUserId(msg.user_id)
    wasmSupported = msg.wasm_supported ?? false   // ← add this line
    session = createSession(profile.name, userId)
    // ... rest of hello handler unchanged
  }
  return
}
```

- [ ] **Step 3: Handle `code_result` ClientMessage**

After the `input_response` handler block, add:
```typescript
if (msg.type === 'code_result') {
  const cb = pendingCodeExecutions.get(msg.id)
  if (cb) {
    pendingCodeExecutions.delete(msg.id)
    cb({ id: msg.id, stdout: msg.stdout, stderr: msg.stderr, exit_code: msg.exit_code, files: msg.files, duration_ms: 0 })
  }
  return
}
```

- [ ] **Step 4: Wire `onCodeExecute` event and `wasmSupported` in context**

In the `events: AgentLoopEvents = { ... }` block, add:
```typescript
onCodeExecute: (id, code, language, data) => new Promise(resolve => {
  pendingCodeExecutions.set(id, resolve)
  send({ type: 'code_execute', id, code, language, data })
}),
```

In the `context: ToolContext = { ... }` block, add:
```typescript
wasmSupported,
```

- [ ] **Step 5: Build and verify server starts**

```bash
pnpm build && node dist/server/index.js 2>&1 | head -5
```
Expected: `Harness server on ws://localhost:7337` (then Ctrl-C)

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: wire code_execute/code_result and wasmSupported flag in WS server"
```

---

## Task 9: HarnessPython web component

**Files:**
- Create: `web/components/HarnessPython.tsx`
- Modify: `web/package.json` (add pyodide)

- [ ] **Step 1: Install Pyodide in the web package**

```bash
cd web && pnpm add pyodide && cd ..
```

- [ ] **Step 2: Implement `web/components/HarnessPython.tsx`**

```tsx
'use client'
import { useEffect, useRef } from 'react'
import type { ExecutionResult } from '../lib/types.js'

interface PendingExecution {
  id: string
  code: string
  language: string
  data?: Record<string, unknown>
}

interface Props {
  pendingExecution: PendingExecution | null
  allowedPackages: string[]
  onResult: (result: ExecutionResult) => void
}

export function HarnessPython({ pendingExecution, allowedPackages, onResult }: Props) {
  const pyodideRef = useRef<any>(null)
  const loadingRef = useRef(false)
  const packagesInstalledRef = useRef(false)

  useEffect(() => {
    if (!pendingExecution) return

    const run = async () => {
      // Boot Pyodide lazily on first execution
      if (!pyodideRef.current && !loadingRef.current) {
        loadingRef.current = true
        try {
          const { loadPyodide } = await import('pyodide')
          let stdout = ''
          let stderr = ''
          pyodideRef.current = await loadPyodide({
            stdout: (text: string) => { stdout += text + '\n' },
            stderr: (text: string) => { stderr += text + '\n' },
          })
          pyodideRef.current.FS.mkdir('/out')
          // reset stdout/stderr accumulators — these were for boot output, not user code
          void stdout; void stderr
        } finally {
          loadingRef.current = false
        }
      }
      // Wait if still loading (race: two executions queued before boot finishes)
      while (loadingRef.current) {
        await new Promise(r => setTimeout(r, 50))
      }

      const py = pyodideRef.current
      if (!py) {
        onResult({ id: pendingExecution.id, stdout: '', stderr: 'Pyodide failed to load', exit_code: 1, files: {}, duration_ms: 0 })
        return
      }

      // Install allowed packages once
      if (!packagesInstalledRef.current && allowedPackages.length > 0) {
        packagesInstalledRef.current = true
        try {
          await py.loadPackagesFromImports(`import ${allowedPackages.join('; import ')}`)
        } catch { /* non-fatal — code may work without them */ }
      }

      // Write data.json to Pyodide FS
      py.FS.writeFile('/data.json', JSON.stringify(pendingExecution.data ?? {}))

      let stdout = ''
      let stderr = ''
      const origStdout = py.setStdout({ batched: (s: string) => { stdout += s + '\n' } })
      const origStderr = py.setStderr({ batched: (s: string) => { stderr += s + '\n' } })

      const start = Date.now()
      let exit_code = 0

      try {
        await py.runPythonAsync(pendingExecution.code)
      } catch (e: any) {
        stderr += e.message + '\n'
        exit_code = 1
      } finally {
        py.setStdout(origStdout)
        py.setStderr(origStderr)
      }

      // Collect output files from /out
      const files: Record<string, string> = {}
      try {
        const entries: string[] = py.FS.readdir('/out')
        for (const entry of entries) {
          if (entry === '.' || entry === '..') continue
          const content: Uint8Array = py.FS.readFile(`/out/${entry}`)
          files[entry] = btoa(String.fromCharCode(...content))
        }
      } catch { /* /out may be empty */ }

      onResult({
        id: pendingExecution.id,
        stdout, stderr, exit_code, files,
        duration_ms: Date.now() - start,
      })
    }

    run().catch(e => {
      onResult({ id: pendingExecution.id, stdout: '', stderr: e.message, exit_code: 1, files: {}, duration_ms: 0 })
    })
  }, [pendingExecution, allowedPackages, onResult])

  return null  // invisible component
}
```

- [ ] **Step 3: Add `ExecutionResult` to `web/lib/types.ts`**

```typescript
export interface ExecutionResult {
  id: string
  stdout: string
  stderr: string
  exit_code: number
  files: Record<string, string>
  duration_ms: number
}
```

- [ ] **Step 4: Type-check web**

```bash
cd web && npx tsc --noEmit && cd ..
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add web/components/HarnessPython.tsx web/lib/types.ts web/package.json web/pnpm-lock.yaml 2>/dev/null || true
git add web/components/HarnessPython.tsx web/lib/types.ts
git commit -m "feat: add HarnessPython component with lazy Pyodide boot and /out file collection"
```

---

## Task 10: HarnessApp integration

**Files:**
- Modify: `web/components/HarnessApp.tsx`

- [ ] **Step 1: Add import and types**

At the top of `HarnessApp.tsx`, add:
```tsx
import { HarnessPython } from './HarnessPython.js'
import type { ExecutionResult } from '../lib/types.js'
```

Add new field to the `State` interface:
```typescript
pendingCodeExecution: { id: string; code: string; language: string; data?: Record<string, unknown> } | null
```

Initialize in the initial state:
```typescript
pendingCodeExecution: null,
```

- [ ] **Step 2: Add Action types**

```typescript
| { type: 'RESOLVE_CODE_EXECUTION' }
```

- [ ] **Step 3: Add reducer cases**

```typescript
case 'RESOLVE_CODE_EXECUTION':
  return { ...state, pendingCodeExecution: null }
```

In the `SERVER_MSG` case, add:
```typescript
if (msg.type === 'code_execute') {
  return { ...state, pendingCodeExecution: { id: msg.id, code: msg.code, language: msg.language, data: msg.data } }
}
```

- [ ] **Step 4: Add `handleCodeResult` and mount `HarnessPython`**

In `HarnessApp`, add:
```tsx
const handleCodeResult = (result: ExecutionResult) => {
  send({ type: 'code_result', id: result.id, stdout: result.stdout, stderr: result.stderr, exit_code: result.exit_code, files: result.files })
  dispatch({ type: 'RESOLVE_CODE_EXECUTION' })
}
```

In the returned JSX, just before the closing `</div>` of the app, add:
```tsx
<HarnessPython
  pendingExecution={state.pendingCodeExecution}
  allowedPackages={[]}
  onResult={handleCodeResult}
/>
```

Also add `wasm_supported: true` to the `hello` message sent on WS connect. Find where `hello` is sent in `useHarnessWS` or in `HarnessApp` and add the flag. In `useHarnessWS.ts`, update the `onopen` handler:

```typescript
sock.onopen = () => {
  setStatus('open')
  backoff.current = 1000
  // Announce WASM capability so server can route python to Pyodide
  sock.send(JSON.stringify({ type: 'hello', user_id: 'web-user', wasm_supported: true }))
}
```

- [ ] **Step 5: Type-check web**

```bash
cd web && npx tsc --noEmit && cd ..
```

- [ ] **Step 6: Run all tests**

```bash
pnpm test
```
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add web/components/HarnessApp.tsx web/hooks/useHarnessWS.ts
git commit -m "feat: integrate HarnessPython into web client with code_execute routing"
```

---

## Task 11: End-to-end smoke test

- [ ] **Step 1: Build everything**

```bash
pnpm build
```
Expected: no errors

- [ ] **Step 2: Verify Docker path works**

```bash
pnpm dev &
sleep 2
# In a second terminal, send a test message via the CLI
pnpm dev:cli
```
Type: `Use ExecuteCode to run python code that prints the sum of 1 to 100`

Expected: agent calls `ExecuteCode`, Docker runs `python3`, result shows `stdout: 5050\n exit_code: 0`

- [ ] **Step 3: Verify no-executor graceful fallback**

In a profile without `executor:` block, type the same prompt.

Expected: agent receives `"Code execution not enabled in this profile"` and responds accordingly.

- [ ] **Step 4: Verify file output**

Type: `Use ExecuteCode with python to write a CSV file with 3 rows to /out/data.csv`

Expected: result includes `files:\n  data.csv (X KB)`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: pluggable code execution — WASM + Docker backends, ExecuteCode tool (#11)"
```
