# Multi-Agent Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `agents:` registry to profiles so an orchestrator agent gets per-agent tools and a `DelegateFanout` tool injected at session start, with hard JSON Schema validation on all inputs and outputs.

**Architecture:** Profile declares named sub-agents with JSON Schema contracts. At session init, `loadAgentTools()` compiles validators and builds per-agent `ToolDefinition` objects plus `DelegateFanout`, stored on `ToolContext.agentTools`. The agent loop spreads `agentTools` into its tool list — so profiles without `agents:` see no change whatsoever.

**Tech Stack:** TypeScript, Vitest, `ajv` (new), `zod` (existing), existing `runAgentLoop`, `loadProfile`, `createSession` infra.

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `src/profiles/schema.ts` | Modify | Add `max_depth` + `agents[]` to `ProfileSchema` |
| `src/tools/types.ts` | Modify | Add `agentTools?` + `maxDepth?` to `ToolContext` |
| `src/loop/agent-loop.ts` | Modify | Spread `context.agentTools` into `allTools` |
| `src/agents/runner.ts` | Create | `runSubAgent()` — 7-step execute sequence |
| `src/tools/builtin/delegate-fanout.ts` | Create | `buildDelegateFanoutTool()` — factory for `DelegateFanout` tool |
| `src/agents/loader.ts` | Create | `loadAgentTools()` — builds all per-agent tools + `DelegateFanout` |
| `src/server/index.ts` | Modify | Wire up `loadAgentTools` at session context creation |
| `docs/ROADMAP.md` | Modify | Mark #3 as `🔄 In progress` |
| `tests/profile-schema.test.ts` | Create | Schema parsing tests for new fields |
| `tests/agents-runner.test.ts` | Create | Unit tests for `runSubAgent` |
| `tests/agents-fanout.test.ts` | Create | Unit tests for `buildDelegateFanoutTool` |
| `tests/agents-loader.test.ts` | Create | Unit tests for `loadAgentTools` |

---

## Task 1: Install `ajv`

**Files:**
- Modify: `package.json` (via pnpm)

- [ ] **Step 1: Add ajv to dependencies**

```bash
cd /path/to/project && pnpm add ajv
```

Expected: `ajv` appears in `package.json` under `"dependencies"`. No error.

- [ ] **Step 2: Verify the package resolves**

```bash
node -e "import('ajv').then(m => console.log('ajv ok', typeof m.default))"
```

Expected output: `ajv ok function`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add ajv for JSON Schema validation"
```

---

## Task 2: Profile schema — `max_depth` and `agents` block

**Files:**
- Modify: `src/profiles/schema.ts`
- Create: `tests/profile-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/profile-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { ProfileSchema } from '../src/profiles/schema.js'

const BASE = {
  name: 'test',
  model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'gpt-4o' },
  system_prompt: './prompt.md',
  artifact_dir: '/tmp/test',
}

describe('ProfileSchema – agents + max_depth', () => {
  it('defaults max_depth to 2 and agents to [] when absent', () => {
    const p = ProfileSchema.parse(BASE)
    expect(p.max_depth).toBe(2)
    expect(p.agents).toEqual([])
  })

  it('accepts a custom max_depth', () => {
    const p = ProfileSchema.parse({ ...BASE, max_depth: 3 })
    expect(p.max_depth).toBe(3)
  })

  it('parses a well-formed agents block', () => {
    const p = ProfileSchema.parse({
      ...BASE,
      agents: [
        {
          name: 'researcher',
          profile: './profiles/researcher.yaml',
          input: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
          output: {
            type: 'object',
            properties: { findings: { type: 'string' } },
            required: ['findings'],
          },
        },
      ],
    })
    expect(p.agents).toHaveLength(1)
    expect(p.agents[0].name).toBe('researcher')
    expect(p.agents[0].profile).toBe('./profiles/researcher.yaml')
    expect((p.agents[0].input as any).properties.query.type).toBe('string')
  })

  it('rejects an agent entry missing required input field', () => {
    expect(() =>
      ProfileSchema.parse({
        ...BASE,
        agents: [{ name: 'bad', profile: './p.yaml', output: { type: 'object' } }],
      })
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run tests/profile-schema.test.ts
```

Expected: FAIL — `p.max_depth` and `p.agents` are undefined.

- [ ] **Step 3: Extend `src/profiles/schema.ts`**

Add after the existing `BuiltinToolsSchema` block and before `ProfileSchema`:

```typescript
const AgentEntrySchema = z.object({
  name: z.string(),
  profile: z.string(),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
})

export type AgentEntry = z.infer<typeof AgentEntrySchema>
```

Then inside `ProfileSchema`, add two new fields after the `memory` field:

```typescript
  max_depth: z.number().int().min(1).default(2),
  agents: z.array(AgentEntrySchema).default([]),
```

The final `ProfileSchema` object definition ends like:

```typescript
export const ProfileSchema = z.object({
  name: z.string(),
  model: z.object({ ... }),
  system_prompt: z.string(),
  working_dir: z.string().default('$CWD'),
  artifact_dir: z.string(),
  tools: z.preprocess(...),
  hooks: z.preprocess(...),
  improvement: z.preprocess(...),
  context_window: z.object(...).optional(),
  memory: z.preprocess(...).optional(),
  max_depth: z.number().int().min(1).default(2),   // ← add
  agents: z.array(AgentEntrySchema).default([]),    // ← add
})
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run tests/profile-schema.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Run the full test suite to catch regressions**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/profiles/schema.ts tests/profile-schema.test.ts
git commit -m "feat: add max_depth and agents[] to ProfileSchema"
```

---

## Task 3: `ToolContext` fields + `agent-loop.ts` spread

**Files:**
- Modify: `src/tools/types.ts`
- Modify: `src/loop/agent-loop.ts`

- [ ] **Step 1: Extend `ToolContext` in `src/tools/types.ts`**

Add two optional fields to the `ToolContext` interface:

```typescript
export interface ToolContext {
  profile: Profile
  session: Session
  workingDir: string
  memory: MemoryProvider
  skills: Skill[]
  mcpEntries: McpEntry[]
  events: AgentLoopEvents
  openai: OpenAI
  signal?: AbortSignal
  delegateDepth: number
  agentTools?: ToolDefinition[]   // ← add
  maxDepth?: number               // ← add; undefined = use profile.max_depth (root only)
}
```

- [ ] **Step 2: Spread `agentTools` into `allTools` in `src/loop/agent-loop.ts`**

Change line 32 from:

```typescript
const allTools = [...getAllTools(), ...getMcpToolDefinitions(profile, context.mcpEntries ?? [])]
```

to:

```typescript
const allTools = [
  ...getAllTools(),
  ...getMcpToolDefinitions(profile, context.mcpEntries ?? []),
  ...(context.agentTools ?? []),
]
```

- [ ] **Step 3: Run the full test suite**

```bash
pnpm test
```

Expected: all existing tests still pass (the spread of an empty array is a no-op).

- [ ] **Step 4: Commit**

```bash
git add src/tools/types.ts src/loop/agent-loop.ts
git commit -m "feat: add agentTools and maxDepth to ToolContext; spread into agent loop"
```

---

## Task 4: `src/agents/runner.ts` — sub-agent execution

**Files:**
- Create: `src/agents/runner.ts`
- Create: `tests/agents-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/agents-runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Ajv from 'ajv'
import { runSubAgent, SubAgentParams } from '../src/agents/runner.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { createMcpClients, destroyMcpClients } from '../src/mcp/client.js'

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
vi.mock('../src/memory/fs-memory.js', () => ({
  FsMemoryProvider: vi.fn().mockImplementation(() => ({
    buildSystemPromptSection: vi.fn().mockResolvedValue(''),
  })),
}))
vi.mock('../src/memory/graph-memory.js', () => ({
  GraphMemoryProvider: vi.fn().mockImplementation(() => ({
    buildSystemPromptSection: vi.fn().mockResolvedValue(''),
  })),
}))
vi.mock('../src/provider/client.js', () => ({ createProviderClient: vi.fn().mockReturnValue({}) }))
vi.mock('../src/profiles/loader.js', () => ({
  loadProfile: vi.fn().mockReturnValue({
    name: 'sub',
    model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
    tools: { builtin: {}, mcp_servers: [] },
    hooks: { pre_tool: [], post_tool: [], on_stop: [] },
    improvement: { enabled: false },
    memory: { provider: 'fs' },
    system_prompt: '/dev/null',
    artifact_dir: '/tmp',
    working_dir: '/tmp',
    max_depth: 2,
    agents: [],
  }),
}))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, readFileSync: vi.fn().mockReturnValue('# system prompt') }
})

const ajv = new Ajv()

const INPUT_SCHEMA = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
const OUTPUT_SCHEMA = { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] }

function makeParams(overrides: Partial<SubAgentParams> = {}): SubAgentParams {
  return {
    agentName: 'researcher',
    subProfilePath: '/profiles/researcher.yaml',
    inputValidator: ajv.compile(INPUT_SCHEMA),
    outputValidator: ajv.compile(OUTPUT_SCHEMA),
    outputSchema: OUTPUT_SCHEMA,
    input: { query: 'test query' },
    context: {
      profile: {} as any,
      session: { user: 'testuser', messages: [], tool_calls: [] } as any,
      workingDir: '/tmp',
      memory: {} as any,
      skills: [],
      mcpEntries: [],
      events: {
        onToken: vi.fn(),
        onToolStart: vi.fn(),
        onToolEnd: vi.fn(),
        onToolPrompt: vi.fn().mockResolvedValue(true),
        onSessionEnd: vi.fn(),
        onStats: vi.fn(),
      },
      openai: {} as any,
      delegateDepth: 0,
      maxDepth: 2,
      agentTools: [],
    },
    ...overrides,
  }
}

describe('runSubAgent', () => {
  beforeEach(() => {
    vi.mocked(runAgentLoop).mockReset()
    vi.mocked(destroyMcpClients).mockReset().mockResolvedValue(undefined)
  })

  it('returns error without running loop when input fails schema validation', async () => {
    const params = makeParams({ input: { wrong_field: 123 } })
    const result = await runSubAgent(params)
    expect(result).toContain('input validation failed')
    expect(result).toContain('researcher')
    expect(runAgentLoop).not.toHaveBeenCalled()
  })

  it('returns error without running loop when max depth exceeded', async () => {
    const params = makeParams({ context: { ...makeParams().context, delegateDepth: 2, maxDepth: 2 } })
    const result = await runSubAgent(params)
    expect(result).toContain('max delegation depth')
    expect(runAgentLoop).not.toHaveBeenCalled()
  })

  it('runs sub-agent and returns validated JSON output on success', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_msg, _profile, session: any) => {
      session.messages.push({ role: 'assistant', content: JSON.stringify({ findings: 'Paris is the capital.' }) })
    })
    const result = await runSubAgent(makeParams())
    expect(JSON.parse(result)).toEqual({ findings: 'Paris is the capital.' })
    expect(runAgentLoop).toHaveBeenCalledOnce()
    expect(destroyMcpClients).toHaveBeenCalledOnce()
  })

  it('returns error when sub-agent output is not valid JSON', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_msg, _profile, session: any) => {
      session.messages.push({ role: 'assistant', content: 'This is plain text, not JSON.' })
    })
    const result = await runSubAgent(makeParams())
    expect(result).toContain('non-JSON output')
  })

  it('returns error when sub-agent output fails schema validation', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_msg, _profile, session: any) => {
      session.messages.push({ role: 'assistant', content: JSON.stringify({ wrong_key: 'oops' }) })
    })
    const result = await runSubAgent(makeParams())
    expect(result).toContain('output validation failed')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run tests/agents-runner.test.ts
```

Expected: FAIL — `runSubAgent` does not exist.

- [ ] **Step 3: Create `src/agents/runner.ts`**

```typescript
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import type { ValidateFunction } from 'ajv'
import { loadProfile } from '../profiles/loader.js'
import { createProviderClient } from '../provider/client.js'
import { createMcpClients, destroyMcpClients } from '../mcp/client.js'
import { createSession } from '../session/store.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { GraphMemoryProvider } from '../memory/graph-memory.js'
import { loadAllSkills, resolveSkillsDirs } from '../skills/loader.js'
import { buildSkillIndex } from '../skills/indexer.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import type { ToolContext, AgentLoopEvents } from '../tools/types.js'

export interface SubAgentParams {
  agentName: string
  subProfilePath: string
  inputValidator: ValidateFunction
  outputValidator: ValidateFunction
  outputSchema: Record<string, unknown>
  input: Record<string, unknown>
  context: ToolContext
}

export async function runSubAgent(params: SubAgentParams): Promise<string> {
  const { agentName, subProfilePath, inputValidator, outputValidator, outputSchema, input, context } = params

  // 1. Input validation
  if (!inputValidator(input)) {
    const errs = (inputValidator.errors ?? []).map(e => `${e.instancePath} ${e.message}`).join('; ')
    return `Error: input validation failed for agent "${agentName}": ${errs}`
  }

  // 2. Depth check
  const maxDepth = context.maxDepth ?? 2
  if ((context.delegateDepth ?? 0) >= maxDepth) {
    return `Error: max delegation depth (${maxDepth}) reached, cannot delegate to "${agentName}"`
  }

  // 3. Task serialisation — append output format instruction to user message
  const userMessage =
    `${JSON.stringify(input, null, 2)}\n\n` +
    `Respond with a JSON object matching this schema: ${JSON.stringify(outputSchema)}`

  // 4. Run sub-agent
  try {
    const subProfile = loadProfile(subProfilePath)
    const subOpenai = createProviderClient(subProfile)
    const subMcpEntries = await createMcpClients(subProfile)

    try {
      const subSession = createSession(subProfile.name, context.session.user)
      const subMemory =
        subProfile.memory?.provider === 'graph'
          ? new GraphMemoryProvider(subProfile.artifact_dir, subSession)
          : new FsMemoryProvider(subProfile.artifact_dir, subSession)
      const subSkills = loadAllSkills(resolveSkillsDirs())
      const systemPromptBase = readFileSync(subProfile.system_prompt, 'utf-8')
      const skillIndex = buildSkillIndex(subSkills)
      const memSection = await subMemory.buildSystemPromptSection()
      subSession.messages.push({ role: 'system', content: systemPromptBase + skillIndex + memSection })

      const subEvents: AgentLoopEvents = {
        onToken: t => context.events.onToken(t),
        onToolStart: (n, i) => context.events.onToolStart(n, i),
        onToolEnd: (n, r) => context.events.onToolEnd(n, r),
        onToolPrompt: (id, n, i) => context.events.onToolPrompt(id, n, i),
        onSessionEnd: () => {},
        onStats: context.events.onStats,
      }

      const subContext: ToolContext = {
        profile: subProfile,
        session: subSession,
        workingDir: subProfile.working_dir,
        memory: subMemory,
        skills: subSkills,
        mcpEntries: subMcpEntries,
        events: subEvents,
        openai: subOpenai,
        signal: context.signal,
        delegateDepth: (context.delegateDepth ?? 0) + 1,
        maxDepth,
        agentTools: [], // sub-agents don't inherit parent's agent registry
      }

      await runAgentLoop(userMessage, subProfile, subSession, subContext, subEvents, subOpenai, context.signal)

      // 5. Output parsing
      const messages = subSession.messages as Array<{ role: string; content?: string | null }>
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
      const raw = lastAssistant?.content ?? ''
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return `Error: agent "${agentName}" returned non-JSON output: ${raw.slice(0, 200)}`
      }

      // 6. Output validation
      if (!outputValidator(parsed)) {
        const errs = (outputValidator.errors ?? []).map(e => `${e.instancePath} ${e.message}`).join('; ')
        return `Error: output validation failed for agent "${agentName}": ${errs}`
      }

      // 7. Return validated output as JSON string
      return JSON.stringify(parsed)
    } finally {
      await destroyMcpClients(subMcpEntries).catch(() => {})
    }
  } catch (e: any) {
    return `Error: agent "${agentName}" failed: ${e.message}`
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx vitest run tests/agents-runner.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Run the full suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/agents/runner.ts tests/agents-runner.test.ts
git commit -m "feat: add runSubAgent — 7-step sub-agent execution with schema validation"
```

---

## Task 5: `src/tools/builtin/delegate-fanout.ts`

**Files:**
- Create: `src/tools/builtin/delegate-fanout.ts`
- Create: `tests/agents-fanout.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/agents-fanout.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildDelegateFanoutTool } from '../src/tools/builtin/delegate-fanout.js'
import type { ToolContext } from '../src/tools/types.js'

function makeContext(): ToolContext {
  return {
    profile: {} as any,
    session: {} as any,
    workingDir: '/tmp',
    memory: {} as any,
    skills: [],
    mcpEntries: [],
    events: {
      onToken: vi.fn(),
      onToolStart: vi.fn(),
      onToolEnd: vi.fn(),
      onToolPrompt: vi.fn().mockResolvedValue(true),
      onSessionEnd: vi.fn(),
    },
    openai: {} as any,
    delegateDepth: 0,
    maxDepth: 2,
    agentTools: [],
  }
}

describe('buildDelegateFanoutTool', () => {
  it('returns error result for unknown agent names', async () => {
    const tool = buildDelegateFanoutTool(new Map())
    const result = await tool.execute(
      { tasks: [{ agent: 'unknown', input: {} }] },
      makeContext()
    )
    const parsed = JSON.parse(result)
    expect(parsed.results[0].agent).toBe('unknown')
    expect(parsed.results[0].error).toContain('Unknown agent')
  })

  it('runs known agents in parallel and returns all results', async () => {
    const order: string[] = []
    const executors = new Map<string, (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>>([
      ['researcher', async (input) => {
        order.push('researcher')
        return JSON.stringify({ findings: `found: ${(input as any).query}` })
      }],
      ['writer', async (input) => {
        order.push('writer')
        return JSON.stringify({ content: `wrote: ${(input as any).topic}` })
      }],
    ])

    const tool = buildDelegateFanoutTool(executors)
    const result = await tool.execute(
      {
        tasks: [
          { agent: 'researcher', input: { query: 'climate' } },
          { agent: 'writer', input: { topic: 'climate report' } },
        ],
      },
      makeContext()
    )

    const parsed = JSON.parse(result)
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results.find((r: any) => r.agent === 'researcher').output).toEqual({ findings: 'found: climate' })
    expect(parsed.results.find((r: any) => r.agent === 'writer').output).toEqual({ content: 'wrote: climate report' })
    expect(order).toHaveLength(2)
  })

  it('isolates failures — failed task gets error, successful task gets output', async () => {
    const executors = new Map<string, (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>>([
      ['good', async () => JSON.stringify({ ok: true })],
      ['bad', async () => 'Error: something broke'],
    ])

    const tool = buildDelegateFanoutTool(executors)
    const result = await tool.execute(
      { tasks: [{ agent: 'good', input: {} }, { agent: 'bad', input: {} }] },
      makeContext()
    )

    const parsed = JSON.parse(result)
    expect(parsed.results.find((r: any) => r.agent === 'good').output).toEqual({ ok: true })
    expect(parsed.results.find((r: any) => r.agent === 'bad').error).toContain('something broke')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run tests/agents-fanout.test.ts
```

Expected: FAIL — `buildDelegateFanoutTool` does not exist.

- [ ] **Step 3: Create `src/tools/builtin/delegate-fanout.ts`**

```typescript
import type { ToolDefinition, ToolContext } from '../types.js'

type AgentExecutor = (input: Record<string, unknown>, context: ToolContext) => Promise<string>

export function buildDelegateFanoutTool(
  executors: Map<string, AgentExecutor>
): ToolDefinition {
  const agentList = [...executors.keys()].join(', ')

  return {
    name: 'DelegateFanout',
    description:
      `Run multiple named sub-agents in parallel and collect all results. ` +
      `Available agents: ${agentList || '(none)'}. ` +
      `Failed tasks return an error field; successful tasks return an output field.`,
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'List of sub-agent tasks to run in parallel.',
          items: {
            type: 'object',
            properties: {
              agent: { type: 'string', description: 'Sub-agent name' },
              input: { type: 'object', description: 'Input matching the agent\'s declared input schema' },
            },
            required: ['agent', 'input'],
          },
        },
      },
      required: ['tasks'],
    },
    async execute(rawInput, context) {
      const { tasks } = rawInput as { tasks: Array<{ agent: string; input: Record<string, unknown> }> }

      const results = await Promise.all(
        tasks.map(async ({ agent, input }) => {
          const executor = executors.get(agent)
          if (!executor) {
            return { agent, error: `Unknown agent "${agent}". Available: ${agentList || '(none)'}` }
          }
          try {
            const outputStr = await executor(input, context)
            if (outputStr.startsWith('Error:')) {
              return { agent, error: outputStr }
            }
            return { agent, output: JSON.parse(outputStr) }
          } catch (e: any) {
            return { agent, error: e.message }
          }
        })
      )

      return JSON.stringify({ results })
    },
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx vitest run tests/agents-fanout.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/builtin/delegate-fanout.ts tests/agents-fanout.test.ts
git commit -m "feat: add buildDelegateFanoutTool for parallel sub-agent execution"
```

---

## Task 6: `src/agents/loader.ts`

**Files:**
- Create: `src/agents/loader.ts`
- Create: `tests/agents-loader.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/agents-loader.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { loadAgentTools } from '../src/agents/loader.js'
import type { Profile } from '../src/profiles/schema.js'

vi.mock('../src/agents/runner.js', () => ({ runSubAgent: vi.fn() }))
vi.mock('../src/tools/builtin/delegate-fanout.js', () => ({
  buildDelegateFanoutTool: vi.fn().mockReturnValue({
    name: 'DelegateFanout',
    description: 'fanout',
    parameters: {},
    execute: vi.fn(),
  }),
}))

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    name: 'orchestrator',
    model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'gpt-4o' },
    system_prompt: './prompt.md',
    artifact_dir: '/tmp',
    working_dir: '/tmp',
    tools: { builtin: {} as any, custom: {}, mcp_servers: [] },
    hooks: { pre_tool: [], post_tool: [], on_stop: [], timeout_ms: 5000 },
    improvement: { enabled: false, mine_skills_every_n_sessions: 10 },
    max_depth: 2,
    agents: [],
    ...overrides,
  } as Profile
}

describe('loadAgentTools', () => {
  it('returns empty array when profile has no agents', async () => {
    const tools = await loadAgentTools(makeProfile())
    expect(tools).toEqual([])
  })

  it('returns per-agent tools + DelegateFanout when agents are declared', async () => {
    const profile = makeProfile({
      agents: [
        {
          name: 'researcher',
          profile: './profiles/researcher.yaml',
          input: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] },
        },
        {
          name: 'writer',
          profile: './profiles/writer.yaml',
          input: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
          output: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
        },
      ],
    })

    const tools = await loadAgentTools(profile)

    // 2 per-agent tools + 1 DelegateFanout
    expect(tools).toHaveLength(3)
    expect(tools.map(t => t.name)).toContain('researcher')
    expect(tools.map(t => t.name)).toContain('writer')
    expect(tools.map(t => t.name)).toContain('DelegateFanout')
  })

  it('per-agent tool uses declared input schema as its parameters', async () => {
    const inputSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
    const profile = makeProfile({
      agents: [{
        name: 'researcher',
        profile: './profiles/researcher.yaml',
        input: inputSchema,
        output: { type: 'object', properties: { findings: { type: 'string' } }, required: ['findings'] },
      }],
    })

    const tools = await loadAgentTools(profile)
    const researcherTool = tools.find(t => t.name === 'researcher')!
    expect(researcherTool.parameters).toEqual(inputSchema)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx vitest run tests/agents-loader.test.ts
```

Expected: FAIL — `loadAgentTools` does not exist.

- [ ] **Step 3: Create `src/agents/loader.ts`**

```typescript
import { resolve } from 'path'
import { homedir } from 'os'
import Ajv from 'ajv'
import type { Profile } from '../profiles/schema.js'
import type { ToolDefinition, ToolContext } from '../tools/types.js'
import { runSubAgent } from './runner.js'
import { buildDelegateFanoutTool } from '../tools/builtin/delegate-fanout.js'

function resolvePath(p: string): string {
  if (p.startsWith('~')) return resolve(p.replace('~', homedir()))
  return resolve(p)
}

type AgentExecutor = (input: Record<string, unknown>, context: ToolContext) => Promise<string>

export async function loadAgentTools(profile: Profile): Promise<ToolDefinition[]> {
  if (!profile.agents || profile.agents.length === 0) return []

  const ajv = new Ajv()
  const executors = new Map<string, AgentExecutor>()
  const tools: ToolDefinition[] = []

  for (const entry of profile.agents) {
    const subProfilePath = resolvePath(entry.profile)
    const inputValidator = ajv.compile(entry.input)
    const outputValidator = ajv.compile(entry.output)

    const executor: AgentExecutor = (input, context) =>
      runSubAgent({
        agentName: entry.name,
        subProfilePath,
        inputValidator,
        outputValidator,
        outputSchema: entry.output as Record<string, unknown>,
        input,
        context,
      })

    executors.set(entry.name, executor)

    tools.push({
      name: entry.name,
      description:
        `Sub-agent "${entry.name}". Accepts: ${JSON.stringify(entry.input)}. ` +
        `Returns: ${JSON.stringify(entry.output)}.`,
      parameters: entry.input as Record<string, unknown>,
      execute: executor,
    })
  }

  tools.push(buildDelegateFanoutTool(executors))
  return tools
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx vitest run tests/agents-loader.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Run the full suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/agents/loader.ts tests/agents-loader.test.ts
git commit -m "feat: add loadAgentTools — builds per-agent tools and DelegateFanout from profile"
```

---

## Task 7: Wire up `src/server/index.ts`

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Import `loadAgentTools` at the top of `src/server/index.ts`**

Add this import alongside the existing imports:

```typescript
import { loadAgentTools } from '../agents/loader.js'
```

- [ ] **Step 2: Load agent tools at session init and set on context**

In the `ws.on('message', ...)` handler, find the block where `ToolContext` is built (around line 163). It currently looks like:

```typescript
const context: ToolContext = {
  profile, session, workingDir: profile.working_dir, memory, skills, mcpEntries,
  events, openai, signal: abortController.signal, delegateDepth: 0,
}
```

Change it to load agent tools before the context (outside the loop so it runs once per session message, not once per connection — this keeps existing tool lifecycle clean; validators are already compiled and cached by `loadAgentTools`):

```typescript
const agentTools = await loadAgentTools(profile)
const context: ToolContext = {
  profile, session, workingDir: profile.working_dir, memory, skills, mcpEntries,
  events, openai, signal: abortController.signal, delegateDepth: 0,
  agentTools,
  maxDepth: profile.max_depth,
}
```

The `await` is fine here — the `ws.on('message', ...)` handler is already `async`.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Run the full suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: wire loadAgentTools into server session context"
```

---

## Task 8: Update ROADMAP + final build check

**Files:**
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Mark feature #3 as in progress in `docs/ROADMAP.md`**

Change:

```markdown
### ❌ 3. First-class multi-agent composition
```

to:

```markdown
### 🔄 3. First-class multi-agent composition
```

- [ ] **Step 2: Run typecheck and full test suite one final time**

```bash
pnpm typecheck && pnpm test
```

Expected: 0 type errors, all tests pass.

- [ ] **Step 3: Final commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark multi-agent composition as in progress"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| `agents:` block optional, absent = no tools | Task 6 (loader returns `[]` when empty) + Task 3 (agent-loop no-op on empty spread) |
| Named registry in profile YAML | Task 2 (schema) + Task 6 (loader) |
| Per-agent tool auto-generated | Task 6 (loader builds ToolDefinition per entry) |
| `DelegateFanout` only when agents present | Task 5 (buildDelegateFanoutTool) + Task 6 (only added when agents non-empty) |
| Hard input validation | Task 4 (runner step 1) |
| Hard output validation | Task 4 (runner step 6) |
| Configurable depth, default 2 | Task 2 (schema default) + Task 4 (runner step 2) |
| Root profile's `max_depth` authoritative | Task 4 (runner passes `maxDepth` unchanged) + Task 7 (server sets `maxDepth: profile.max_depth`) |
| Parallel fan-out via `Promise.all` | Task 5 (fanout executor) |
| Partial failure isolation | Task 5 (error per slot, others complete) |
| Sub-agents don't inherit parent agent registry | Task 4 (subContext sets `agentTools: []`) |
| `Delegate` tool unchanged | Not touched in any task ✓ |

**No placeholders:** All steps have complete code. ✓

**Type consistency:**
- `SubAgentParams` defined in `runner.ts` Task 4, used in `loader.ts` Task 6. ✓
- `AgentExecutor` type alias used consistently in both `loader.ts` and `delegate-fanout.ts`. ✓
- `buildDelegateFanoutTool(executors: Map<string, AgentExecutor>)` — Map type matches what `loader.ts` builds. ✓
- `agentTools?: ToolDefinition[]` + `maxDepth?: number` added in Task 3, consumed in Task 7 and Task 4. ✓
