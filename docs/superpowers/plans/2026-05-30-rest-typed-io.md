# REST + Typed I/O Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an HTTP layer (`POST /run`, `POST /stream` SSE, `GET /health`) sharing the WS port, plus optional per-profile typed input/output contracts validated with ajv.

**Architecture:** Wrap the existing `WebSocketServer` onto a shared `http.createServer`. A hand-rolled router on plain `http` handles REST. A new `runProfileOnce()` helper centralizes one-shot profile execution (root call, `delegateDepth: 0`, agent tools loaded). A `contract` module compiles/validates JSON-schema I/O; a shared `json-contract` util (also adopted by `runner.ts`) does fence-strip + parse + validate.

**Tech Stack:** TypeScript (NodeNext ESM), Node `http`, `ws`, `ajv` (already installed), `vitest`.

**Spec:** `docs/superpowers/specs/2026-05-30-rest-typed-io-design.md`

---

## Conventions for every task

- ESM imports use `.js` extensions even for `.ts` files (NodeNext). `ajv` uses the **named** import: `import { Ajv } from 'ajv'`.
- Run a single test file with: `npx vitest run tests/<file>.test.ts`
- `pnpm typecheck` must pass after every task.
- Commit at the end of each task.

---

## Task 1: Shared `json-contract` util + refactor `runner.ts`

**Files:**
- Create: `src/shared/json-contract.ts`
- Create: `tests/json-contract.test.ts`
- Modify: `src/agents/runner.ts` (replace inline steps 5–6)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/json-contract.test.ts
import { describe, it, expect } from 'vitest'
import { Ajv } from 'ajv'
import { parseJsonContract } from '../src/shared/json-contract.js'

const ajv = new Ajv()
const OUT = ajv.compile({ type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] })

describe('parseJsonContract', () => {
  it('parses bare JSON', () => {
    expect(parseJsonContract('{"findings":"x"}', OUT)).toEqual({ ok: true, value: { findings: 'x' } })
  })

  it('parses JSON wrapped in markdown fences', () => {
    expect(parseJsonContract('```json\n{"findings":"y"}\n```', OUT)).toEqual({ ok: true, value: { findings: 'y' } })
  })

  it('returns parse error with "non-JSON output" for unparseable text', () => {
    const r = parseJsonContract('plain text', OUT)
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.kind).toBe('parse'); expect(r.error).toContain('non-JSON output') }
  })

  it('returns validation error with "output validation failed" for schema mismatch', () => {
    const r = parseJsonContract('{"wrong":1}', OUT)
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.kind).toBe('validation'); expect(r.error).toContain('output validation failed') }
  })

  it('skips validation when no validator passed', () => {
    expect(parseJsonContract('{"anything":true}')).toEqual({ ok: true, value: { anything: true } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/json-contract.test.ts`
Expected: FAIL — cannot resolve `../src/shared/json-contract.js`.

- [ ] **Step 3: Implement the util**

```typescript
// src/shared/json-contract.ts
import type { ValidateFunction } from 'ajv'

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; kind: 'parse' | 'validation'; error: string }

/** Strip a ```json ...``` fence if present, JSON.parse, then optionally ajv-validate. */
export function parseJsonContract(raw: string, validator?: ValidateFunction): ParseResult {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  const toParse = fenceMatch ? fenceMatch[1] : raw.trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(toParse)
  } catch {
    return { ok: false, kind: 'parse', error: `non-JSON output: ${raw.slice(0, 200)}` }
  }

  if (validator && !validator(parsed)) {
    const errs = (validator.errors ?? []).map(e => `${e.instancePath} ${e.message}`).join('; ')
    return { ok: false, kind: 'validation', error: `output validation failed: ${errs}` }
  }

  return { ok: true, value: parsed }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/json-contract.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Refactor `runner.ts` to use the util**

In `src/agents/runner.ts`, add the import at the top with the other imports:

```typescript
import { parseJsonContract } from '../shared/json-contract.js'
```

Replace the current steps 5 & 6 block (the `const fenceMatch = ...` through the `if (!outputValidator(parsed)) { ... }` block, i.e. lines ~88–105) with:

```typescript
      // 5–6. Output parsing + validation (shared util)
      const messages = subSession.messages as Array<{ role: string; content?: string | null }>
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
      const raw = lastAssistant?.content ?? ''
      const result = parseJsonContract(raw, outputValidator)
      if (!result.ok) {
        return `Error: agent "${agentName}" ${result.error}`
      }

      // 7. Return validated output as JSON string
      return JSON.stringify(result.value)
```

This preserves the substrings the runner tests assert: a parse failure yields `... non-JSON output: ...` and a validation failure yields `... output validation failed: ...`.

- [ ] **Step 6: Verify runner tests still pass**

Run: `npx vitest run tests/agents-runner.test.ts`
Expected: PASS (6 tests, unchanged).

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck
git add src/shared/json-contract.ts tests/json-contract.test.ts src/agents/runner.ts
git commit -m "feat: shared json-contract util; adopt in runner"
```

---

## Task 2: Profile schema — optional `contract` block

**Files:**
- Modify: `src/profiles/schema.ts`
- Create: `tests/contract-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/contract-schema.test.ts
import { describe, it, expect } from 'vitest'
import { ProfileSchema } from '../src/profiles/schema.js'

const BASE = {
  name: 'x',
  model: { base_url: 'https://api.openai.com/v1', api_key_env: 'K', id: 'gpt-4o' },
  system_prompt: '/dev/null',
  artifact_dir: '/tmp',
}

describe('ProfileSchema contract block', () => {
  it('parses with no contract (undefined)', () => {
    const p = ProfileSchema.parse(BASE)
    expect(p.contract).toBeUndefined()
  })

  it('accepts a contract with input and output schemas', () => {
    const p = ProfileSchema.parse({
      ...BASE,
      contract: {
        input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] },
      },
    })
    expect(p.contract?.input).toBeDefined()
    expect(p.contract?.output).toBeDefined()
  })

  it('accepts a contract with only output', () => {
    const p = ProfileSchema.parse({ ...BASE, contract: { output: { type: 'object' } } })
    expect(p.contract?.input).toBeUndefined()
    expect(p.contract?.output).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/contract-schema.test.ts`
Expected: FAIL — `p.contract` typing/parse does not exist yet.

- [ ] **Step 3: Add the field to `ProfileSchema`**

In `src/profiles/schema.ts`, add this field inside the `ProfileSchema` object, immediately after the `agents:` line (the last field before the closing `})`):

```typescript
  contract: z.object({
    input: z.record(z.string(), z.unknown()).optional(),
    output: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/contract-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add src/profiles/schema.ts tests/contract-schema.test.ts
git commit -m "feat: optional contract block in ProfileSchema"
```

---

## Task 3: Contract module (`src/server/contract.ts`)

**Files:**
- Create: `src/server/contract.ts`
- Create: `tests/server-contract.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server-contract.test.ts
import { describe, it, expect } from 'vitest'
import { compileContract, validateAndBuildInput, processOutput } from '../src/server/contract.js'
import type { Profile } from '../src/profiles/schema.js'

function profileWith(contract?: any): Profile {
  return { name: 'p', contract } as unknown as Profile
}

describe('compileContract', () => {
  it('returns empty compiled contract when profile has none', () => {
    expect(compileContract(profileWith())).toEqual({})
  })
})

describe('validateAndBuildInput', () => {
  it('requires a string when there is no input schema and passes it through', () => {
    const c = compileContract(profileWith())
    const r = validateAndBuildInput('hello', c)
    expect(r).toEqual({ ok: true, userMessage: 'hello' })
  })

  it('rejects a non-string when there is no input schema', () => {
    const c = compileContract(profileWith())
    const r = validateAndBuildInput({ a: 1 }, c)
    expect(r.ok).toBe(false)
  })

  it('validates object input against input schema and appends output instruction', () => {
    const c = compileContract(profileWith({
      input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] },
    }))
    const r = validateAndBuildInput({ query: 'hi' }, c)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.userMessage).toContain('"query": "hi"')
      expect(r.userMessage).toContain('Respond with a JSON object matching this schema')
    }
  })

  it('returns details when object input fails the input schema', () => {
    const c = compileContract(profileWith({
      input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    }))
    const r = validateAndBuildInput({ wrong: 1 }, c)
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.error).toContain('input validation failed'); expect(r.details).toBeDefined() }
  })

  it('appends output instruction to a string when only output schema exists', () => {
    const c = compileContract(profileWith({ output: { type: 'object' } }))
    const r = validateAndBuildInput('do it', c)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.userMessage).toContain('do it'); expect(r.userMessage).toContain('Respond with a JSON object') }
  })
})

describe('processOutput', () => {
  it('returns freeform text when no output schema', () => {
    const c = compileContract(profileWith())
    expect(processOutput('just text', c)).toEqual({ ok: true, output: 'just text' })
  })

  it('parses and validates JSON output against output schema', () => {
    const c = compileContract(profileWith({ output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] } }))
    expect(processOutput('{"findings":"ok"}', c)).toEqual({ ok: true, output: { findings: 'ok' } })
  })

  it('fails when output does not match schema', () => {
    const c = compileContract(profileWith({ output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] } }))
    const r = processOutput('{"wrong":1}', c)
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server-contract.test.ts`
Expected: FAIL — cannot resolve `../src/server/contract.js`.

- [ ] **Step 3: Implement the contract module**

```typescript
// src/server/contract.ts
import { Ajv } from 'ajv'
import type { ValidateFunction } from 'ajv'
import type { Profile } from '../profiles/schema.js'
import { parseJsonContract } from '../shared/json-contract.js'

export interface CompiledContract {
  inputValidator?: ValidateFunction
  outputValidator?: ValidateFunction
  outputSchema?: Record<string, unknown>
}

export type InputResult =
  | { ok: true; userMessage: string }
  | { ok: false; error: string; details?: string[] }

export type OutputResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string; kind: 'parse' | 'validation' }

export function compileContract(profile: Profile): CompiledContract {
  const c = profile.contract
  if (!c) return {}
  const ajv = new Ajv()
  return {
    inputValidator: c.input ? ajv.compile(c.input) : undefined,
    outputValidator: c.output ? ajv.compile(c.output) : undefined,
    outputSchema: c.output as Record<string, unknown> | undefined,
  }
}

function withOutputInstruction(base: string, c: CompiledContract): string {
  if (!c.outputSchema) return base
  return `${base}\n\nRespond with a JSON object matching this schema: ${JSON.stringify(c.outputSchema)}`
}

export function validateAndBuildInput(input: unknown, c: CompiledContract): InputResult {
  if (c.inputValidator) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { ok: false, error: 'input must be an object for this profile' }
    }
    if (!c.inputValidator(input)) {
      const details = (c.inputValidator.errors ?? []).map(e => `${e.instancePath} ${e.message}`)
      return { ok: false, error: 'input validation failed', details }
    }
    return { ok: true, userMessage: withOutputInstruction(JSON.stringify(input, null, 2), c) }
  }

  // No input schema → require a plain string user message.
  if (typeof input !== 'string') {
    return { ok: false, error: 'input must be a string for this profile (no input contract)' }
  }
  return { ok: true, userMessage: withOutputInstruction(input, c) }
}

export function processOutput(finalText: string, c: CompiledContract): OutputResult {
  if (!c.outputValidator) return { ok: true, output: finalText }
  const r = parseJsonContract(finalText, c.outputValidator)
  if (r.ok) return { ok: true, output: r.value }
  return { ok: false, error: r.error, kind: r.kind }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server-contract.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add src/server/contract.ts tests/server-contract.test.ts
git commit -m "feat: server contract module (compile/validate/build)"
```

---

## Task 4: Shared run helper (`src/server/run-profile.ts`)

**Files:**
- Create: `src/server/run-profile.ts`
- Create: `tests/run-profile.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/run-profile.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runProfileOnce } from '../src/server/run-profile.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { destroyMcpClients } from '../src/mcp/client.js'
import { recordUsage } from '../src/usage/ledger.js'

vi.mock('../src/loop/agent-loop.js', () => ({ runAgentLoop: vi.fn() }))
vi.mock('../src/mcp/client.js', () => ({
  createMcpClients: vi.fn().mockResolvedValue([]),
  destroyMcpClients: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/skills/loader.js', () => ({
  loadAllSkills: vi.fn().mockReturnValue([]),
  resolveSkillsDirs: vi.fn().mockReturnValue([]),
}))
vi.mock('../src/skills/indexer.js', () => ({ buildSkillIndex: vi.fn().mockReturnValue('') }))
vi.mock('../src/agents/loader.js', () => ({ loadAgentTools: vi.fn().mockResolvedValue([]) }))
vi.mock('../src/provider/client.js', () => ({ createProviderClient: vi.fn().mockReturnValue({}) }))
vi.mock('../src/usage/ledger.js', () => ({ recordUsage: vi.fn() }))
vi.mock('../src/memory/fs-memory.js', () => ({
  FsMemoryProvider: vi.fn().mockImplementation(function () {
    return { buildSystemPromptSection: vi.fn().mockResolvedValue('') }
  }),
}))
vi.mock('../src/memory/graph-memory.js', () => ({
  GraphMemoryProvider: vi.fn().mockImplementation(function () {
    return { buildSystemPromptSection: vi.fn().mockResolvedValue('') }
  }),
}))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# system prompt') }
})

const PROFILE = {
  name: 'p', model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
  memory: { provider: 'fs' }, system_prompt: '/dev/null', artifact_dir: '/tmp',
  working_dir: '/tmp', max_depth: 2, agents: [],
} as any

function noopEvents() {
  return {
    onToken: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn(),
    onToolPrompt: vi.fn().mockResolvedValue(false), onSessionEnd: vi.fn(), onStats: vi.fn(),
  }
}

describe('runProfileOnce', () => {
  beforeEach(() => {
    vi.mocked(runAgentLoop).mockReset()
    vi.mocked(destroyMcpClients).mockReset().mockResolvedValue(undefined)
    vi.mocked(recordUsage).mockReset()
  })

  it('runs the loop and returns final text + usage', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_m, _p, session: any) => {
      session.messages.push({ role: 'assistant', content: 'hello world' })
      session.usage = { input: 10, output: 5, cost_usd: 0.001 }
    })
    const result = await runProfileOnce({ profile: PROFILE, userId: 'alice', userMessage: 'hi', events: noopEvents() })
    expect(result.finalText).toBe('hello world')
    expect(result.usage).toEqual({ tokens_in: 10, tokens_out: 5, cost_usd: 0.001 })
    expect(result.session.id).toBeTruthy()
  })

  it('records usage for the user', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_m, _p, session: any) => {
      session.messages.push({ role: 'assistant', content: 'x' })
      session.usage = { input: 3, output: 4, cost_usd: 0.002 }
    })
    await runProfileOnce({ profile: PROFILE, userId: 'bob', userMessage: 'hi', events: noopEvents() })
    expect(recordUsage).toHaveBeenCalledWith('bob', { input: 3, output: 4, cost_usd: 0.002 })
  })

  it('destroys mcp clients even when the loop throws', async () => {
    vi.mocked(runAgentLoop).mockRejectedValue(new Error('boom'))
    await expect(runProfileOnce({ profile: PROFILE, userId: 'x', userMessage: 'hi', events: noopEvents() }))
      .rejects.toThrow('boom')
    expect(destroyMcpClients).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/run-profile.test.ts`
Expected: FAIL — cannot resolve `../src/server/run-profile.js`.

- [ ] **Step 3: Implement the run helper**

```typescript
// src/server/run-profile.ts
import { readFileSync } from 'fs'
import { createProviderClient } from '../provider/client.js'
import { createMcpClients, destroyMcpClients } from '../mcp/client.js'
import { createSession } from '../session/store.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import { loadAllSkills, resolveSkillsDirs } from '../skills/loader.js'
import { buildSkillIndex } from '../skills/indexer.js'
import { loadAgentTools } from '../agents/loader.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import { recordUsage } from '../usage/ledger.js'
import { sanitizeUserId } from '../session/user-paths.js'
import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { AgentLoopEvents, ToolContext } from '../tools/types.js'

export interface RestUsage { tokens_in: number; tokens_out: number; cost_usd: number }

export interface RunProfileResult {
  finalText: string
  usage: RestUsage
  session: Session
}

export interface RunProfileOptions {
  profile: Profile
  userId: string
  userMessage: string
  events: AgentLoopEvents
  signal?: AbortSignal
}

/** One-shot root run of a profile: build context, run the loop, extract final text + usage. */
export async function runProfileOnce(opts: RunProfileOptions): Promise<RunProfileResult> {
  const { profile, userMessage, events, signal } = opts
  const user = sanitizeUserId(opts.userId)
  const openai = createProviderClient(profile)
  const mcpEntries = await createMcpClients(profile)

  try {
    const session = createSession(profile.name, user)
    const memory = profile.memory?.provider === 'graph'
      ? new GraphMemoryProvider(profile.artifact_dir, session)
      : new FsMemoryProvider(profile.artifact_dir, session)
    const skills = loadAllSkills(resolveSkillsDirs())
    const systemPromptBase = readFileSync(profile.system_prompt, 'utf-8')
    const skillIndex = buildSkillIndex(skills)
    const memSection = await memory.buildSystemPromptSection()
    session.messages.push({ role: 'system', content: systemPromptBase + skillIndex + memSection })

    const agentTools = await loadAgentTools(profile)
    const context: ToolContext = {
      profile, session, workingDir: profile.working_dir, memory, skills, mcpEntries,
      events, openai, signal, delegateDepth: 0, agentTools, maxDepth: profile.max_depth ?? 2,
    }

    await runAgentLoop(userMessage, profile, session, context, events, openai, signal)

    const messages = session.messages as Array<{ role: string; content?: string | null }>
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
    const finalText = lastAssistant?.content ?? ''

    const delta = { input: session.usage.input, output: session.usage.output, cost_usd: session.usage.cost_usd }
    recordUsage(user, delta)

    return {
      finalText,
      usage: { tokens_in: delta.input, tokens_out: delta.output, cost_usd: delta.cost_usd },
      session,
    }
  } finally {
    await destroyMcpClients(mcpEntries).catch(() => {})
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/run-profile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add src/server/run-profile.ts tests/run-profile.test.ts
git commit -m "feat: runProfileOnce shared one-shot run helper"
```

---

## Task 5: REST router — `/health`, `/run`, auth (`src/server/rest.ts`)

**Files:**
- Create: `src/server/rest.ts`
- Create: `tests/rest.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/rest.test.ts
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { createServer, Server } from 'http'
import type { AddressInfo } from 'net'
import { createRestHandler } from '../src/server/rest.js'
import { runProfileOnce } from '../src/server/run-profile.js'

vi.mock('../src/server/run-profile.js', () => ({ runProfileOnce: vi.fn() }))
vi.mock('../src/profiles/loader.js', () => ({
  loadProfile: vi.fn().mockReturnValue({ name: 'named', contract: undefined }),
}))

const FREEFORM_PROFILE = { name: 'default', contract: undefined } as any
const CONTRACT_PROFILE = {
  name: 'typed',
  contract: {
    input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] },
  },
} as any

function startServer(handler: (req: any, res: any) => void): Promise<{ server: Server; base: string }> {
  return new Promise(resolve => {
    const server = createServer((req, res) => handler(req, res))
    server.listen(0, () => {
      const addr = server.address() as AddressInfo
      resolve({ server, base: `http://127.0.0.1:${addr.port}` })
    })
  })
}

describe('REST /health and /run (no auth)', () => {
  let server: Server, base: string
  beforeAll(async () => {
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())
  beforeEach(() => {
    vi.mocked(runProfileOnce).mockReset().mockResolvedValue({
      finalText: 'hello', usage: { tokens_in: 1, tokens_out: 2, cost_usd: 0.0 }, session: { id: 'sess1' } as any,
    })
  })

  it('GET /health returns 200 with profile name', async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', profile: 'default' })
  })

  it('POST /run freeform returns 200 with string output and usage', async () => {
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ input: 'hi' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ output: 'hello', usage: { tokens_in: 1, tokens_out: 2, cost_usd: 0.0 }, session_id: 'sess1' })
  })

  it('POST /run missing input returns 400', async () => {
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ user: 'a' }) })
    expect(res.status).toBe(400)
  })

  it('POST /run malformed JSON returns 400', async () => {
    const res = await fetch(`${base}/run`, { method: 'POST', body: 'not json' })
    expect(res.status).toBe(400)
  })

  it('unknown route returns 404', async () => {
    const res = await fetch(`${base}/nope`)
    expect(res.status).toBe(404)
  })
})

describe('REST /run typed contract', () => {
  let server: Server, base: string
  beforeAll(async () => {
    const handler = createRestHandler({ defaultProfile: CONTRACT_PROFILE, apiKey: undefined })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())

  it('returns 422 when object input violates the input schema', async () => {
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ input: { wrong: 1 } }) })
    expect(res.status).toBe(422)
  })

  it('returns 200 with object output when contract is satisfied', async () => {
    vi.mocked(runProfileOnce).mockResolvedValue({
      finalText: '{"findings":"ok"}', usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 }, session: { id: 's' } as any,
    })
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ input: { query: 'x' } }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ output: { findings: 'ok' } })
  })

  it('returns 422 when the agent output violates the output schema', async () => {
    vi.mocked(runProfileOnce).mockResolvedValue({
      finalText: '{"wrong":1}', usage: { tokens_in: 1, tokens_out: 1, cost_usd: 0 }, session: { id: 's' } as any,
    })
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ input: { query: 'x' } }) })
    expect(res.status).toBe(422)
  })
})

describe('REST auth', () => {
  let server: Server, base: string
  beforeAll(async () => {
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: 'secret' })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())

  it('GET /health is exempt from auth', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200)
  })

  it('POST /run without bearer returns 401', async () => {
    const res = await fetch(`${base}/run`, { method: 'POST', body: JSON.stringify({ input: 'hi' }) })
    expect(res.status).toBe(401)
  })

  it('POST /run with correct bearer returns 200', async () => {
    vi.mocked(runProfileOnce).mockResolvedValue({
      finalText: 'ok', usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 }, session: { id: 's' } as any,
    })
    const res = await fetch(`${base}/run`, {
      method: 'POST', headers: { authorization: 'Bearer secret' }, body: JSON.stringify({ input: 'hi' }),
    })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rest.test.ts`
Expected: FAIL — cannot resolve `../src/server/rest.js`.

- [ ] **Step 3: Implement the router (`/health`, `/run`, auth)**

```typescript
// src/server/rest.ts
import type { IncomingMessage, ServerResponse } from 'http'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { loadProfile } from '../profiles/loader.js'
import { sanitizeUserId } from '../session/user-paths.js'
import { runProfileOnce } from './run-profile.js'
import { compileContract, validateAndBuildInput, processOutput } from './contract.js'
import type { Profile } from '../profiles/schema.js'
import type { AgentLoopEvents } from '../tools/types.js'

const VERSION = '0.1.0'

export interface RestDeps {
  defaultProfile: Profile
  apiKey?: string
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

function findProfilePath(name: string): string | null {
  const candidates = [
    resolve(process.cwd(), 'profiles', `${name}.yaml`),
    resolve(homedir(), '.harness', 'profiles', `${name}.yaml`),
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

function resolveProfile(name: string | undefined, deps: RestDeps): Profile | null {
  if (!name) return deps.defaultProfile
  const path = findProfilePath(name)
  return path ? loadProfile(path) : null
}

function headlessEvents(): AgentLoopEvents {
  return {
    onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {},
    onToolPrompt: async () => false, onSessionEnd: () => {}, onStats: () => {},
  }
}

interface RunRequest { profile?: string; user?: string; input?: unknown }

/**
 * Parse + validate the request shared by /run and /stream.
 * Returns either a ready-to-run payload, or an error with a status code.
 */
function prepareRun(bodyText: string, deps: RestDeps):
  | { ok: true; profile: Profile; userId: string; userMessage: string; compiled: ReturnType<typeof compileContract> }
  | { ok: false; status: number; body: unknown } {
  let body: RunRequest
  try {
    body = JSON.parse(bodyText)
  } catch {
    return { ok: false, status: 400, body: { error: 'malformed JSON body' } }
  }
  if (body.input === undefined) {
    return { ok: false, status: 400, body: { error: 'missing input' } }
  }
  const profile = resolveProfile(body.profile, deps)
  if (!profile) {
    return { ok: false, status: 404, body: { error: `profile "${body.profile}" not found` } }
  }
  const compiled = compileContract(profile)
  const inputCheck = validateAndBuildInput(body.input, compiled)
  if (!inputCheck.ok) {
    const status = inputCheck.details ? 422 : 400
    return { ok: false, status, body: { error: inputCheck.error, details: inputCheck.details } }
  }
  const userId = sanitizeUserId(body.user ?? process.env.HARNESS_USER ?? 'anonymous')
  return { ok: true, profile, userId, userMessage: inputCheck.userMessage, compiled }
}

async function handleRun(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  const prepared = prepareRun(await readBody(req), deps)
  if (!prepared.ok) return sendJson(res, prepared.status, prepared.body)

  let result
  try {
    result = await runProfileOnce({
      profile: prepared.profile, userId: prepared.userId,
      userMessage: prepared.userMessage, events: headlessEvents(),
    })
  } catch (e: any) {
    return sendJson(res, 500, { error: e.message })
  }

  const out = processOutput(result.finalText, prepared.compiled)
  if (!out.ok) return sendJson(res, 422, { error: out.error, kind: out.kind })

  return sendJson(res, 200, { output: out.output, usage: result.usage, session_id: result.session.id })
}

export function createRestHandler(deps: RestDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? '/').split('?')[0]
    const method = req.method ?? 'GET'

    if (method === 'GET' && url === '/health') {
      return sendJson(res, 200, { status: 'ok', profile: deps.defaultProfile.name, version: VERSION })
    }

    if (deps.apiKey && req.headers['authorization'] !== `Bearer ${deps.apiKey}`) {
      return sendJson(res, 401, { error: 'unauthorized' })
    }

    if (method === 'POST' && url === '/run') return handleRun(req, res, deps)

    return sendJson(res, 404, { error: 'not found' })
  }
}
```

Note: `/stream` is added in Task 6. `prepareRun` is written now because `/stream` will reuse it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rest.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add src/server/rest.ts tests/rest.test.ts
git commit -m "feat: REST router with /health, /run, bearer auth"
```

---

## Task 6: `POST /stream` (SSE)

**Files:**
- Modify: `src/server/rest.ts` (add `handleStream` + route)
- Modify: `tests/rest.test.ts` (add a streaming test block)

- [ ] **Step 1: Write the failing test**

Append this describe block to `tests/rest.test.ts`:

```typescript
describe('REST /stream (SSE)', () => {
  let server: Server, base: string
  beforeAll(async () => {
    const handler = createRestHandler({ defaultProfile: FREEFORM_PROFILE, apiKey: undefined })
    ;({ server, base } = await startServer(handler))
  })
  afterAll(() => server.close())

  it('streams a terminal result event with output and usage', async () => {
    vi.mocked(runProfileOnce).mockImplementation(async (opts: any) => {
      opts.events.onToken('hel')
      opts.events.onToken('lo')
      opts.events.onStats(2, 3, 0.001)
      return { finalText: 'hello', usage: { tokens_in: 2, tokens_out: 3, cost_usd: 0.001 }, session: { id: 'sX' } }
    })
    const res = await fetch(`${base}/stream`, { method: 'POST', body: JSON.stringify({ input: 'hi' }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('event: token')
    expect(text).toContain('event: stats')
    expect(text).toContain('event: result')
    expect(text).toContain('"output":"hello"')
    expect(text).toContain('"session_id":"sX"')
  })

  it('returns a normal 422 (not SSE) when pre-run input validation fails', async () => {
    const res = await fetch(`${base}/stream`, { method: 'POST', body: JSON.stringify({}) })
    expect(res.status).toBe(400) // missing input
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rest.test.ts`
Expected: FAIL — `/stream` returns 404 (no route yet).

- [ ] **Step 3: Add `handleStream` and the route**

In `src/server/rest.ts`, add this function (above `createRestHandler`):

```typescript
async function handleStream(req: IncomingMessage, res: ServerResponse, deps: RestDeps): Promise<void> {
  const prepared = prepareRun(await readBody(req), deps)
  if (!prepared.ok) return sendJson(res, prepared.status, prepared.body)

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const abort = new AbortController()
  req.on('close', () => abort.abort())

  const events: AgentLoopEvents = {
    onToken: t => sse('token', { content: t }),
    onToolStart: (n, i) => sse('tool_start', { name: n, input: i }),
    onToolEnd: (n, r) => sse('tool_end', { name: n, result: r }),
    onToolPrompt: async () => false,
    onSessionEnd: () => {},
    onStats: (tokens_in, tokens_out, cost_usd) => sse('stats', { tokens_in, tokens_out, cost_usd }),
  }

  try {
    const result = await runProfileOnce({
      profile: prepared.profile, userId: prepared.userId,
      userMessage: prepared.userMessage, events, signal: abort.signal,
    })
    const out = processOutput(result.finalText, prepared.compiled)
    if (!out.ok) {
      sse('error', { error: out.error })
    } else {
      sse('result', { output: out.output, usage: result.usage, session_id: result.session.id })
    }
  } catch (e: any) {
    sse('error', { error: e.message })
  } finally {
    res.end()
  }
}
```

Then add the route inside `createRestHandler`'s returned `handle`, immediately after the `/run` route line:

```typescript
    if (method === 'POST' && url === '/stream') return handleStream(req, res, deps)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rest.test.ts`
Expected: PASS (all blocks including SSE).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add src/server/rest.ts tests/rest.test.ts
git commit -m "feat: POST /stream SSE endpoint"
```

---

## Task 7: Wire shared `http.Server` into `src/server/index.ts`

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add imports**

At the top of `src/server/index.ts`, add:

```typescript
import { createServer } from 'http'
import { createRestHandler } from './rest.js'
```

- [ ] **Step 2: Replace the WS server construction**

Find:

```typescript
  const wss = new WebSocketServer({ port: PORT })
  console.log(`Harness server on ws://localhost:${PORT} [profile: ${profile.name}]`)
```

Replace with:

```typescript
  const apiKey = process.env.HARNESS_API_KEY
  const restHandler = createRestHandler({ defaultProfile: profile, apiKey })
  const httpServer = createServer((req, res) => { void restHandler(req, res) })
  const wss = new WebSocketServer({ server: httpServer })
  httpServer.listen(PORT, () => {
    console.log(`Harness server on ws://localhost:${PORT} [profile: ${profile.name}]`)
    console.log(`REST endpoints: http://localhost:${PORT} (/run, /stream, /health)`)
    if (!apiKey) {
      console.warn('[rest] HARNESS_API_KEY not set — REST endpoints are UNAUTHENTICATED')
    }
  })
```

- [ ] **Step 3: Close the http server on shutdown**

Find the `SIGINT` handler:

```typescript
  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    for (const ws of openSockets) ws.terminate()  // triggers 'close' event → destroyMcpClients fires
    wss.close()
    process.exit(0)
  })
```

Replace the `wss.close()` line with:

```typescript
    wss.close()
    httpServer.close()
```

- [ ] **Step 4: Typecheck and full test run**

```bash
pnpm typecheck
pnpm test
```

Expected: typecheck clean; all tests pass (existing + new).

- [ ] **Step 5: Manual smoke check (optional but recommended)**

```bash
pnpm build && node dist/server/index.js profiles/<some>.yaml &
sleep 1
curl -s http://localhost:7337/health
curl -s -X POST http://localhost:7337/run -d '{"input":"say hi in 3 words"}'
kill %1
```

Expected: `/health` returns JSON with the profile name; `/run` returns `{ output, usage, session_id }`.

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: serve REST and WS on a shared http server"
```

---

## Task 8: ROADMAP update + final verification

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Mark #4 done**

In `docs/ROADMAP.md`, change the heading `### ❌ 4. Programmatic agent contracts (REST + typed I/O)` to `### ✅ 4. Programmatic agent contracts (REST + typed I/O)`.

Under it, replace the `**To build:**` list with a `**What shipped:**` list:

```markdown
**What shipped:**
- Shared `http.Server` hosts REST + WS on one port (7337)
- `POST /run` — one-shot `{ profile?, user?, input }` → `{ output, usage, session_id }`
- `POST /stream` — SSE: token / tool_start / tool_end / stats / result / error events
- `GET /health` — liveness + profile name + version
- Optional per-profile `contract: { input?, output? }` block; ajv hard-validation (422 on violation)
- Optional bearer auth via `HARNESS_API_KEY`; `user` body field scopes session/memory/usage
- Headless tool safety: REST runs auto-deny `prompt`-ACL tools (no interactive approver)
- `runProfileOnce()` shared one-shot helper; `src/shared/json-contract.ts` shared with `runner.ts`
```

- [ ] **Step 2: Update the sequencing note**

In the "Suggested sequencing" block, the `#4` line is now complete — leave the block as-is (it documents intent) or add `(done)` after the `#4` line. Minor; either is acceptable.

- [ ] **Step 3: Final full build + test**

```bash
pnpm typecheck && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark ROADMAP #4 (REST + typed I/O) done"
```

---

## Self-review notes (for the executor)

- **Type consistency:** `RestUsage` (`tokens_in`/`tokens_out`/`cost_usd`) is the public response shape; `session.usage` uses `input`/`output`/`cost_usd` and `recordUsage` takes the latter. The mapping happens only in `run-profile.ts`.
- **`parseJsonContract` substrings** `non-JSON output` and `output validation failed` are load-bearing — `tests/agents-runner.test.ts` asserts them. Do not reword.
- **`ajv` import** must be `import { Ajv } from 'ajv'` (named) under NodeNext.
- **Auth exemption:** `/health` is checked before the bearer gate so liveness probes never need a token.
- **SSE pre-run errors** return normal HTTP status (handled by `prepareRun` running before `res.writeHead`); post-open errors are `error` events.
