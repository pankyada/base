# Group D — Delegate Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `Delegate` tool so an agent can spin up a sub-agent under a different profile, forward its output live to the parent WebSocket, and return the final reply plus a tool summary.

**Architecture:** Two sequential tasks. Task 1 expands `ToolContext` with `events`, `openai`, `signal`, and `delegateDepth` — moving `AgentLoopEvents` from `agent-loop.ts` to `types.ts` to avoid circular imports, then wiring the server. Task 2 is TDD: failing tests first, then implement `delegate.ts` with profile discovery, sub-agent lifecycle, event forwarding, and result formatting.

**Tech Stack:** TypeScript, Node.js, OpenAI SDK, Vitest

---

## File Map

| File | Task | Change |
|------|------|--------|
| `src/tools/types.ts` | 1 | Move `AgentLoopEvents` here; add `events`, `openai`, `signal?`, `delegateDepth` to `ToolContext` |
| `src/loop/agent-loop.ts` | 1 | Import `AgentLoopEvents` from `../tools/types.js` instead of defining it |
| `src/server/index.ts` | 1 | Extract events to `const events: AgentLoopEvents`; add to context |
| `tests/delegate.test.ts` | 2 | Three tests: depth limit, profile not found, successful delegation |
| `src/tools/builtin/delegate.ts` | 2 | Full implementation replacing the stub |

---

## Task 1: Expand ToolContext + Wire Server

**Files:**
- Modify: `src/tools/types.ts`
- Modify: `src/loop/agent-loop.ts`
- Modify: `src/server/index.ts`

No new tests — existing tests use `ctx: any` which bypasses interface checks, and typecheck enforces correctness.

- [ ] **Step 1: Rewrite `src/tools/types.ts`**

Replace the entire file with:

```typescript
import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { MemoryProvider } from '../memory/interface.js'
import type { McpEntry } from '../mcp/client.js'
import type OpenAI from 'openai'

export interface AgentLoopEvents {
  onToken(token: string): void
  onToolStart(name: string, input: Record<string, unknown>): void
  onToolEnd(name: string, result: string): void
  onToolPrompt(id: string, name: string, input: Record<string, unknown>): Promise<boolean>
  onSessionEnd(sessionId: string): void
  onStats?(tokens_in: number, tokens_out: number, cost_usd: number): void
}

export interface Skill {
  name: string
  description: string
  content: string
  filePath: string
}

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
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(input: Record<string, unknown>, context: ToolContext): Promise<string>
}
```

Key changes: `AgentLoopEvents` is now defined here (avoids circular import), `ToolContext` gains `events`, `openai`, `signal?`, `delegateDepth`.

- [ ] **Step 2: Update `src/loop/agent-loop.ts`**

The file currently exports `AgentLoopEvents`. After moving it to `types.ts`, update the import and remove the definition.

Find and replace the existing `AgentLoopEvents` import/definition block. The current file starts:

```typescript
import OpenAI from 'openai'
import { Profile } from '../profiles/schema.js'
import { Session } from '../session/types.js'
import { ToolContext } from '../tools/types.js'
import { getAllTools, toOpenAITools } from '../tools/registry.js'
import { getMcpToolDefinitions } from '../mcp/client.js'
import { getAcl, getMcpAcl } from '../tools/acl.js'
import { logEvent } from '../telemetry/logger.js'
import { runHooks } from '../hooks/runner.js'
import { maybeCondenseMessages } from './context-manager.js'

export interface AgentLoopEvents {
  onToken(token: string): void
  onToolStart(name: string, input: Record<string, unknown>): void
  onToolEnd(name: string, result: string): void
  onToolPrompt(id: string, name: string, input: Record<string, unknown>): Promise<boolean>
  onSessionEnd(sessionId: string): void
  onStats?(tokens_in: number, tokens_out: number, cost_usd: number): void
}
```

Replace with (import `AgentLoopEvents` from types, remove the interface definition):

```typescript
import OpenAI from 'openai'
import { Profile } from '../profiles/schema.js'
import { Session } from '../session/types.js'
import { ToolContext, AgentLoopEvents } from '../tools/types.js'
import { getAllTools, toOpenAITools } from '../tools/registry.js'
import { getMcpToolDefinitions } from '../mcp/client.js'
import { getAcl, getMcpAcl } from '../tools/acl.js'
import { logEvent } from '../telemetry/logger.js'
import { runHooks } from '../hooks/runner.js'
import { maybeCondenseMessages } from './context-manager.js'
```

`AgentLoopEvents` is still re-exported from agent-loop.ts because `runAgentLoop` function signature uses it — no explicit re-export needed since it's used in the function signature and TypeScript infers it. The server and delegate.ts will import it from `../tools/types.js`.

- [ ] **Step 3: Update `src/server/index.ts`**

**3a.** Add `AgentLoopEvents` to the tools/types import. Currently the server doesn't import from tools/types. Add a new import line after the existing imports:

```typescript
import { AgentLoopEvents } from '../tools/types.js'
```

**3b.** In the `ws.on('message', ...)` handler, extract the events object literal into a named const, and add the new context fields. Find:

```typescript
        const context = {
          profile, session, workingDir: profile.working_dir, memory, skills, mcpEntries,
        }

        try {
          await runAgentLoop(msg.content, profile, session, context, {
            onToken: t => send({ type: 'token', content: t }),
            onToolStart: (n, i) => send({ type: 'tool_start', name: n, input: i }),
            onToolEnd: (n, r) => send({ type: 'tool_end', name: n, result: r }),
            onToolPrompt: (id, n, i) => new Promise<boolean>(res => {
              pendingApprovals.set(id, res)
              send({ type: 'tool_prompt', id, name: n, input: i })
            }),
            onSessionEnd: (id) => {
              saveSession(session)
              send({ type: 'session_end', sessionId: id })
            },
            onStats: (tokens_in, tokens_out, cost_usd) => {
              send({ type: 'stats', tokens_in, tokens_out, cost_usd })
            },
          }, openai, abortController.signal)
```

Replace with:

```typescript
        const events: AgentLoopEvents = {
          onToken: t => send({ type: 'token', content: t }),
          onToolStart: (n, i) => send({ type: 'tool_start', name: n, input: i }),
          onToolEnd: (n, r) => send({ type: 'tool_end', name: n, result: r }),
          onToolPrompt: (id, n, i) => new Promise<boolean>(res => {
            pendingApprovals.set(id, res)
            send({ type: 'tool_prompt', id, name: n, input: i })
          }),
          onSessionEnd: (id) => {
            saveSession(session)
            send({ type: 'session_end', sessionId: id })
          },
          onStats: (tokens_in, tokens_out, cost_usd) => {
            send({ type: 'stats', tokens_in, tokens_out, cost_usd })
          },
        }
        const context = {
          profile, session, workingDir: profile.working_dir, memory, skills, mcpEntries,
          events, openai, signal: abortController.signal, delegateDepth: 0,
        }

        try {
          await runAgentLoop(msg.content, profile, session, context, events, openai, abortController.signal)
```

- [ ] **Step 4: Run full test suite**

```bash
pnpm test
```

Expected: all 93 tests PASS (no logic changed, only types restructured)

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/tools/types.ts src/loop/agent-loop.ts src/server/index.ts
git commit -m "feat: expand ToolContext with events, openai, signal, delegateDepth"
```

---

## Task 2: TDD Delegate Implementation

**Files:**
- Create: `tests/delegate.test.ts`
- Modify: `src/tools/builtin/delegate.ts`

The test also creates two temp files (cleaned up in `afterAll`):
- `profiles/test-delegate.yaml` — minimal profile for success test
- `prompts/test-delegate-prompt.md` — system prompt for the test profile

- [ ] **Step 1: Write failing tests in `tests/delegate.test.ts`**

Create the file:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { delegateTool } from '../src/tools/builtin/delegate.js'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import type { ToolContext } from '../src/tools/types.js'

// vi.mock is hoisted by Vitest before imports — runAgentLoop above resolves to the mock
vi.mock('../src/loop/agent-loop.js', () => ({
  runAgentLoop: vi.fn(),
}))

vi.mock('../src/mcp/client.js', () => ({
  createMcpClients: vi.fn().mockResolvedValue([]),
  destroyMcpClients: vi.fn().mockResolvedValue(undefined),
}))

const TEST_PROFILE_NAME = 'test-delegate'
const TEST_PROFILE_PATH = join(process.cwd(), 'profiles', `${TEST_PROFILE_NAME}.yaml`)
const TEST_PROMPT_PATH = join(process.cwd(), 'prompts', 'test-delegate-prompt.md')
const TEST_ARTIFACT_DIR = join(process.cwd(), '.harness', 'test-delegate')

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    profile: {} as any,
    session: {} as any,
    workingDir: process.cwd(),
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
    signal: undefined,
    delegateDepth: 0,
    ...overrides,
  }
}

describe('Delegate tool', () => {
  beforeAll(() => {
    // Create test profile YAML
    mkdirSync(join(process.cwd(), 'profiles'), { recursive: true })
    mkdirSync(join(process.cwd(), 'prompts'), { recursive: true })
    writeFileSync(TEST_PROMPT_PATH, '# Test delegate prompt\nYou are a test sub-agent.')
    writeFileSync(TEST_PROFILE_PATH, `
name: ${TEST_PROFILE_NAME}
model:
  base_url: https://api.openai.com/v1
  api_key_env: TEST_DELEGATE_API_KEY
  id: gpt-4o-mini
system_prompt: ./prompts/test-delegate-prompt.md
working_dir: $CWD
artifact_dir: ${TEST_ARTIFACT_DIR}
tools:
  builtin: {}
  mcp_servers: []
`.trim())
    process.env.TEST_DELEGATE_API_KEY = 'test-key-xxx'
  })

  afterAll(() => {
    rmSync(TEST_PROFILE_PATH, { force: true })
    rmSync(TEST_PROMPT_PATH, { force: true })
    delete process.env.TEST_DELEGATE_API_KEY
  })

  beforeEach(() => {
    vi.mocked(runAgentLoop).mockReset()
  })

  it('returns error when delegateDepth >= 1 (max depth exceeded)', async () => {
    const context = makeContext({ delegateDepth: 1 })
    const result = await delegateTool.execute(
      { profile: 'coding', task: 'do something' },
      context
    )
    expect(result).toContain('cannot delegate')
    expect(runAgentLoop).not.toHaveBeenCalled()
  })

  it('returns error when profile does not exist', async () => {
    const context = makeContext({ delegateDepth: 0 })
    const result = await delegateTool.execute(
      { profile: 'nonexistent-profile-xyz', task: 'do something' },
      context
    )
    expect(result).toContain('not found')
    expect(result).toContain('nonexistent-profile-xyz')
    expect(runAgentLoop).not.toHaveBeenCalled()
  })

  it('runs sub-agent and returns final text with tool summary', async () => {
    vi.mocked(runAgentLoop).mockImplementation(async (_task, _profile, session) => {
      session.messages.push({ role: 'assistant', content: 'Task complete.' })
      session.tool_calls.push({ name: 'Read', input: {}, result: 'ok', ok: true, ts: new Date().toISOString() })
      session.tool_calls.push({ name: 'Read', input: {}, result: 'ok', ok: true, ts: new Date().toISOString() })
      session.tool_calls.push({ name: 'Bash', input: {}, result: 'done', ok: true, ts: new Date().toISOString() })
    })

    const context = makeContext({ delegateDepth: 0 })
    const result = await delegateTool.execute(
      { profile: TEST_PROFILE_NAME, task: 'read a file and run a command' },
      context
    )

    expect(result).toContain(`[Delegate: ${TEST_PROFILE_NAME}]`)
    expect(result).toContain('Task complete.')
    expect(result).toContain('Read ×2')
    expect(result).toContain('Bash ×1')
    expect(runAgentLoop).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/delegate.test.ts
```

Expected: 3 tests FAIL — the stub currently returns a placeholder string, not the expected error messages or delegation result.

- [ ] **Step 3: Implement `src/tools/builtin/delegate.ts`**

Replace the entire file with:

```typescript
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { ToolDefinition, ToolContext, AgentLoopEvents } from '../types.js'
import { loadProfile } from '../../profiles/loader.js'
import { createProviderClient } from '../../provider/client.js'
import { createMcpClients, destroyMcpClients } from '../../mcp/client.js'
import { createSession } from '../../session/store.js'
import { FsMemoryProvider } from '../../memory/fs-memory.js'
import { loadAllSkills, resolveSkillsDirs } from '../../skills/loader.js'
import { buildSkillIndex } from '../../skills/indexer.js'
import { runAgentLoop } from '../../loop/agent-loop.js'

function findProfilePath(name: string): string | null {
  const candidates = [
    resolve(process.cwd(), 'profiles', `${name}.yaml`),
    resolve(homedir(), '.harness', 'profiles', `${name}.yaml`),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

export const delegateTool: ToolDefinition = {
  name: 'Delegate',
  description: 'Delegate a task to a sub-agent running under a different profile. Returns the final reply and a summary of tools used.',
  parameters: {
    type: 'object',
    properties: {
      profile: { type: 'string', description: 'Target profile name (e.g. "data" or "coding")' },
      task: { type: 'string', description: 'Task description for the sub-agent' },
    },
    required: ['profile', 'task'],
  },
  async execute(input, context) {
    const { profile: profileName, task } = input as { profile: string; task: string }

    // Depth limit — sub-agents cannot delegate further
    if ((context.delegateDepth ?? 0) >= 1) {
      return 'Error: cannot delegate from within a sub-agent (max depth is 1).'
    }

    // Profile discovery
    const profilePath = findProfilePath(profileName)
    if (!profilePath) {
      return (
        `Error: profile "${profileName}" not found. ` +
        `Searched: profiles/${profileName}.yaml, ~/.harness/profiles/${profileName}.yaml`
      )
    }

    try {
      const subProfile = loadProfile(profilePath)
      const subOpenai = createProviderClient(subProfile)
      const subMcpEntries = await createMcpClients(subProfile)
      const subSession = createSession(subProfile.name)
      const subMemory = new FsMemoryProvider(subProfile.artifact_dir, subSession)
      const subSkills = loadAllSkills(resolveSkillsDirs())

      // Build system prompt for sub-agent (same as server does before calling runAgentLoop)
      const systemPromptBase = readFileSync(subProfile.system_prompt, 'utf-8')
      const skillIndex = buildSkillIndex(subSkills)
      const memSection = await subMemory.buildSystemPromptSection()
      subSession.messages.push({
        role: 'system',
        content: systemPromptBase + skillIndex + memSection,
      })

      // Sub-context: same parent events, delegateDepth = 1 blocks further delegation
      const subContext: ToolContext = {
        profile: subProfile,
        session: subSession,
        workingDir: subProfile.working_dir,
        memory: subMemory,
        skills: subSkills,
        mcpEntries: subMcpEntries,
        events: context.events,
        openai: subOpenai,
        signal: context.signal,
        delegateDepth: 1,
      }

      // Forward all sub-agent events to parent WebSocket
      const subEvents: AgentLoopEvents = {
        onToken: t => context.events.onToken(t),
        onToolStart: (n, i) => context.events.onToolStart(n, i),
        onToolEnd: (n, r) => context.events.onToolEnd(n, r),
        onToolPrompt: (id, n, i) => context.events.onToolPrompt(id, n, i),
        onSessionEnd: () => { /* no-op — parent manages its own session end */ },
        onStats: (a, b, c) => context.events.onStats?.(a, b, c),
      }

      try {
        await runAgentLoop(task, subProfile, subSession, subContext, subEvents, subOpenai, context.signal)
      } finally {
        await destroyMcpClients(subMcpEntries).catch(() => {})
      }

      // Extract final assistant text
      const messages = subSession.messages as Array<{ role: string; content?: string | null }>
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content)
      const finalText = lastAssistant?.content ?? '(no response)'

      // Build tool summary
      const toolCounts = new Map<string, number>()
      for (const tc of subSession.tool_calls) {
        toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1)
      }
      const toolSummary = toolCounts.size === 0
        ? 'Tools used: (none)'
        : 'Tools used: ' + [...toolCounts.entries()].map(([n, c]) => `${n} ×${c}`).join(', ')

      return `[Delegate: ${profileName}]\n${finalText}\n\n${toolSummary}`
    } catch (e: any) {
      return `Error: delegate to "${profileName}" failed: ${e.message}`
    }
  },
}
```

- [ ] **Step 4: Run delegate tests to verify they pass**

```bash
npx vitest run tests/delegate.test.ts
```

Expected: all 3 tests PASS

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: all tests PASS (96+ total)

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/tools/builtin/delegate.ts tests/delegate.test.ts
git commit -m "feat: implement Delegate tool with sub-agent lifecycle and event forwarding"
```
