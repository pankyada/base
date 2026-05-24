# Group B — Agent Loop Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the agent loop with parallel tool execution, async hooks with timeout, and smart LLM-based context window management.

**Architecture:** Five sequential tasks — schema first, then async hooks, then context manager, then wire both into the agent loop, then update the server close handler. Each task is independently testable.

**Tech Stack:** TypeScript, Node.js `child_process` + `util.promisify`, OpenAI SDK, Vitest

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/profiles/schema.ts` | Modify | Add `hooks.timeout_ms` and `context_window` fields |
| `src/hooks/runner.ts` | Rewrite | Replace `execSync` with async `exec` + per-command timeout |
| `src/loop/context-manager.ts` | Create | `maybeCondenseMessages()` — token estimation + LLM summarisation |
| `src/loop/agent-loop.ts` | Modify | Parallel tool execution + await hooks + call context manager |
| `src/server/index.ts` | Modify | Fire-and-forget `runHooks` for `on_stop` with error logging |
| `tests/profile-loader.test.ts` | Modify | Add tests for new schema fields |
| `tests/hooks.test.ts` | Create | Tests for async execution, timeout, error handling |
| `tests/context-manager.test.ts` | Create | Tests for token estimate, anchor detection, condensation |
| `tests/agent-loop.test.ts` | Modify | Add test for parallel execution order |

---

## Task 1: Schema — Add `hooks.timeout_ms` and `context_window`

**Files:**
- Modify: `src/profiles/schema.ts`
- Modify: `tests/profile-loader.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/profile-loader.test.ts` inside the existing `describe('loadProfile', ...)` block:

```typescript
  it('defaults hooks.timeout_ms to 5000', () => {
    const yaml = `
name: test
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
system_prompt: ${tmp}/prompt.md
artifact_dir: ${tmp}/artifacts
`
    writeFileSync(join(tmp, 'timeout-profile.yaml'), yaml)
    const profile = loadProfile(join(tmp, 'timeout-profile.yaml'))
    expect((profile.hooks as any).timeout_ms).toBe(5000)
  })

  it('parses context_window when present', () => {
    const yaml = `
name: test
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
system_prompt: ${tmp}/prompt.md
artifact_dir: ${tmp}/artifacts
context_window:
  max_tokens: 50000
`
    writeFileSync(join(tmp, 'cw-profile.yaml'), yaml)
    const profile = loadProfile(join(tmp, 'cw-profile.yaml'))
    expect(profile.context_window?.max_tokens).toBe(50000)
  })

  it('context_window is undefined when not present', () => {
    const profile = loadProfile(join(tmp, 'profile.yaml'))
    expect(profile.context_window).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/profile-loader.test.ts
```

Expected: 3 new tests FAIL (property does not exist on type)

- [ ] **Step 3: Update `src/profiles/schema.ts`**

Replace the `hooks` block (lines 93–100) with:

```typescript
  hooks: z.preprocess(
    (val) => val ?? {},
    z.object({
      pre_tool: z.array(z.string()).default([]),
      post_tool: z.array(z.string()).default([]),
      on_stop: z.array(z.string()).default([]),
      timeout_ms: z.number().default(5000),
    })
  ),
```

Add `context_window` after `improvement` (after line 108, before line 109 `})`):

```typescript
  context_window: z.object({
    max_tokens: z.number().default(100000),
    model_id: z.string().optional(),
  }).optional(),
```

The full `ProfileSchema` object should now end with:

```typescript
  improvement: z.preprocess(
    (val) => val ?? {},
    z.object({
      enabled: z.boolean().default(true),
      model_id: z.string().optional(),
      mine_skills_every_n_sessions: z.number().default(10),
    })
  ),
  context_window: z.object({
    max_tokens: z.number().default(100000),
    model_id: z.string().optional(),
  }).optional(),
})
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/profile-loader.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Run full suite to check no regressions**

```bash
pnpm test
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/profiles/schema.ts tests/profile-loader.test.ts
git commit -m "feat: add hooks.timeout_ms and context_window to profile schema"
```

---

## Task 2: Async Hooks with Timeout

**Files:**
- Rewrite: `src/hooks/runner.ts`
- Create: `tests/hooks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/hooks.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { runHooks } from '../src/hooks/runner.js'

function makeProfile(hookCmds: string[], timeout_ms = 5000): any {
  return {
    name: 'test',
    hooks: {
      pre_tool: hookCmds,
      post_tool: [],
      on_stop: [],
      timeout_ms,
    },
  }
}

describe('runHooks', () => {
  it('runs a hook command successfully without error logging', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runHooks('pre_tool', makeProfile(['echo hello']), {})
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('logs error when hook exits with non-zero status', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runHooks('pre_tool', makeProfile(['false']), {})
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[hook:pre_tool] failed'))
    spy.mockRestore()
  })

  it('logs timeout warning when hook exceeds timeout_ms', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runHooks('pre_tool', makeProfile(['sleep 5'], 100), {})
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('timed out'))
    spy.mockRestore()
  }, 5000)

  it('passes env vars to hook command', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // This would fail if MY_VAR is not set — we just verify no error
    await runHooks('post_tool', makeProfile(['echo $MY_VAR']), { MY_VAR: 'hello' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('is a no-op when hook list is empty', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runHooks('on_stop', makeProfile([]), {})
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/hooks.test.ts
```

Expected: tests FAIL — `runHooks` returns `void` (not a Promise)

- [ ] **Step 3: Rewrite `src/hooks/runner.ts`**

Replace the entire file contents with:

```typescript
import { exec } from 'child_process'
import { promisify } from 'util'
import { Profile } from '../profiles/schema.js'

const execAsync = promisify(exec)

export type HookType = 'pre_tool' | 'post_tool' | 'on_stop'

export async function runHooks(
  hookType: HookType,
  profile: Profile,
  env: Record<string, string> = {}
): Promise<void> {
  const hooks = profile.hooks?.[hookType] ?? []
  const timeout_ms = profile.hooks?.timeout_ms ?? 5000
  for (const cmd of hooks) {
    try {
      await execAsync(cmd, {
        env: { ...(process.env as Record<string, string>), ...env },
        timeout: timeout_ms,
      })
    } catch (e: any) {
      if (e.killed) {
        console.error(`[hook:${hookType}] timed out after ${timeout_ms}ms: ${cmd}`)
      } else {
        console.error(`[hook:${hookType}] failed: ${cmd}\n${e.stderr?.toString() ?? e.message}`)
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/hooks.test.ts
```

Expected: all 5 tests PASS

- [ ] **Step 5: Run full suite**

```bash
pnpm test
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/runner.ts tests/hooks.test.ts
git commit -m "feat: async hooks with per-command timeout"
```

---

## Task 3: Context Window Manager

**Files:**
- Create: `src/loop/context-manager.ts`
- Create: `tests/context-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/context-manager.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { maybeCondenseMessages } from '../src/loop/context-manager.js'
import { createSession } from '../src/session/store.js'

function makeProfile(maxTokens = 100_000, modelId?: string): any {
  return {
    name: 'test',
    model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
    context_window: { max_tokens: maxTokens, model_id: modelId },
    hooks: { pre_tool: [], post_tool: [], on_stop: [], timeout_ms: 5000 },
  }
}

function makeOpenAI(summary: string): any {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: summary } }],
        }),
      },
    },
  }
}

describe('maybeCondenseMessages', () => {
  it('does nothing when under token limit', async () => {
    const session = createSession('test')
    session.messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]
    const openai = makeOpenAI('summary')
    await maybeCondenseMessages(session, makeProfile(1_000_000), openai)
    expect(session.messages).toHaveLength(2)
    expect(openai.chat.completions.create).not.toHaveBeenCalled()
  })

  it('condenses when over token limit, inserts summary after system message', async () => {
    const session = createSession('test')
    session.messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'old-1' },
      { role: 'assistant', content: 'old-2' },
      { role: 'user', content: 'old-3' },
      { role: 'assistant', content: 'old-4' },
      { role: 'user', content: 'old-5' },
      { role: 'assistant', content: 'old-6' },
      { role: 'user', content: 'old-7' },
      { role: 'assistant', content: 'old-8' },
      { role: 'user', content: 'recent' },
    ]
    const openai = makeOpenAI('the conversation summary')
    await maybeCondenseMessages(session, makeProfile(10), openai)
    expect(openai.chat.completions.create).toHaveBeenCalled()
    const msgs = session.messages as any[]
    expect(msgs[0].role).toBe('system')
    expect(msgs[1].content).toContain('[Earlier conversation summary:')
    expect(msgs[1].content).toContain('the conversation summary')
  })

  it('preserves last 6 messages verbatim', async () => {
    const session = createSession('test')
    session.messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'drop-me' },
      { role: 'assistant', content: 'drop-me-too' },
      { role: 'user', content: 'keep-6' },
      { role: 'assistant', content: 'keep-5' },
      { role: 'user', content: 'keep-4' },
      { role: 'assistant', content: 'keep-3' },
      { role: 'user', content: 'keep-2' },
      { role: 'assistant', content: 'keep-1' },
    ]
    const openai = makeOpenAI('summary')
    await maybeCondenseMessages(session, makeProfile(10), openai)
    const contents = (session.messages as any[]).map((m: any) => m.content)
    expect(contents).toContain('keep-6')
    expect(contents).toContain('keep-1')
    expect(contents).not.toContain('drop-me')
  })

  it('preserves anchor tool messages (long markdown content)', async () => {
    const session = createSession('test')
    const anchorContent = '# CLAUDE.md\n' + 'x'.repeat(400)
    session.messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'read file' },
      { role: 'tool', tool_call_id: 'tc1', content: anchorContent },
      { role: 'user', content: 'old-1' },
      { role: 'assistant', content: 'old-2' },
      { role: 'user', content: 'old-3' },
      { role: 'assistant', content: 'old-4' },
      { role: 'user', content: 'old-5' },
      { role: 'assistant', content: 'old-6' },
      { role: 'user', content: 'recent' },
    ]
    const openai = makeOpenAI('summary')
    await maybeCondenseMessages(session, makeProfile(10), openai)
    const contents = (session.messages as any[]).map((m: any) => m.content)
    expect(contents).toContain(anchorContent)
  })

  it('does not anchor short tool messages', async () => {
    const session = createSession('test')
    session.messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'run cmd' },
      { role: 'tool', tool_call_id: 'tc1', content: 'ok' },
      { role: 'user', content: 'old-1' },
      { role: 'assistant', content: 'old-2' },
      { role: 'user', content: 'old-3' },
      { role: 'assistant', content: 'old-4' },
      { role: 'user', content: 'old-5' },
      { role: 'assistant', content: 'old-6' },
      { role: 'user', content: 'recent' },
    ]
    const openai = makeOpenAI('summary')
    await maybeCondenseMessages(session, makeProfile(10), openai)
    const contents = (session.messages as any[]).map((m: any) => m.content)
    expect(contents).not.toContain('ok') // short tool result dropped
  })

  it('survives summarisation failure gracefully (leaves messages unchanged)', async () => {
    const session = createSession('test')
    const original = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'old-1' },
      { role: 'assistant', content: 'old-2' },
      { role: 'user', content: 'recent' },
    ]
    session.messages = [...original]
    const openai = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error('API error')) } },
    }
    await maybeCondenseMessages(session, makeProfile(10), openai as any)
    expect(session.messages).toHaveLength(original.length)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/context-manager.test.ts
```

Expected: all tests FAIL — module does not exist

- [ ] **Step 3: Create `src/loop/context-manager.ts`**

```typescript
import OpenAI from 'openai'
import { Session } from '../session/types.js'
import { Profile } from '../profiles/schema.js'

function estimateTokens(messages: unknown[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4)
}

function isAnchor(msg: unknown): boolean {
  const m = msg as any
  if (m.role !== 'tool') return false
  const content: string = m.content ?? ''
  return content.length >= 400 && (content.startsWith('#') || content.includes('\n#'))
}

export async function maybeCondenseMessages(
  session: Session,
  profile: Profile,
  openai: OpenAI
): Promise<void> {
  const maxTokens = profile.context_window?.max_tokens ?? Infinity
  if (estimateTokens(session.messages) <= maxTokens) return

  const messages = session.messages as any[]
  const keepSet = new Set<number>()

  // Always keep: system message (index 0)
  keepSet.add(0)

  // Always keep: last 6 messages
  for (let i = Math.max(1, messages.length - 6); i < messages.length; i++) {
    keepSet.add(i)
  }

  // Always keep: anchor tool messages (long markdown content)
  for (let i = 1; i < messages.length; i++) {
    if (isAnchor(messages[i])) keepSet.add(i)
  }

  const summarisable = messages.filter((_, i) => !keepSet.has(i))
  if (summarisable.length === 0) return

  const modelId = profile.context_window?.model_id ?? profile.model.id
  let summary: string
  try {
    const resp = await (openai.chat.completions as any).create({
      model: modelId,
      messages: [{
        role: 'user',
        content: `Summarise this conversation history concisely. Preserve: key decisions made, tasks completed, current goals, important values or file contents mentioned. Output plain text, no JSON.\n\n${JSON.stringify(summarisable)}`,
      }],
    })
    summary = resp.choices[0].message.content ?? 'No summary available.'
  } catch {
    return // leave messages unchanged on failure
  }

  const summaryMsg = { role: 'user', content: `[Earlier conversation summary: ${summary}]` }
  const kept = messages.filter((_, i) => keepSet.has(i))
  // system message first, summary second, then rest of kept messages
  session.messages = [kept[0], summaryMsg, ...kept.slice(1)] as unknown[]
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/context-manager.test.ts
```

Expected: all 6 tests PASS

- [ ] **Step 5: Run full suite**

```bash
pnpm test
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/loop/context-manager.ts tests/context-manager.test.ts
git commit -m "feat: context window manager with LLM summarisation and anchor preservation"
```

---

## Task 4: Agent Loop — Parallel Execution + Wire Context Manager + Await Hooks

**Files:**
- Modify: `src/loop/agent-loop.ts`
- Modify: `tests/agent-loop.test.ts`

- [ ] **Step 1: Write the failing test for parallel execution**

Add to `tests/agent-loop.test.ts` inside the existing `describe('runAgentLoop', ...)` block:

```typescript
  it('executes multiple allow-ACL tool calls in parallel and preserves order', async () => {
    const session = createSession('test')
    const profile: any = {
      name: 'test',
      model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
      tools: { builtin: { Echo: 'allow' }, mcp_servers: [] },
      hooks: { pre_tool: [], post_tool: [], on_stop: [], timeout_ms: 5000 },
      improvement: { enabled: false },
    }

    // Register a slow Echo tool that tracks call order by start time
    const callLog: string[] = []
    registerTool({
      name: 'Echo',
      description: 'echo',
      parameters: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
      execute: async (input: any) => {
        callLog.push(`start:${input.msg}`)
        await new Promise(r => setTimeout(r, 30))
        callLog.push(`end:${input.msg}`)
        return input.msg
      },
    })

    const memory = new FsMemoryProvider(tmp, session)
    const ctx: any = { profile, session, workingDir: tmp, memory, skills: [] }

    // Two LLM turns: first returns 2 tool calls, second returns text.
    // Use mockReturnValueOnce per turn — makeFakeOpenAI always returns the same stream,
    // which causes an infinite loop when there are multiple turns.
    const openai = {
      chat: {
        completions: {
          create: vi.fn()
            .mockReturnValueOnce(makeStream([
              { choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc1', function: { name: 'Echo', arguments: '{"msg":"A"}' } }] } }] },
              { choices: [{ delta: { tool_calls: [{ index: 1, id: 'tc2', function: { name: 'Echo', arguments: '{"msg":"B"}' } }] } }] },
              { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
            ]))
            .mockReturnValueOnce(makeStream([
              { choices: [{ delta: { content: 'done' } }] },
              { choices: [{ delta: {} }], usage: { prompt_tokens: 20, completion_tokens: 2 } },
            ])),
        },
      },
    }

    const toolEnds: string[] = []
    await runAgentLoop('go', profile, session, ctx, {
      onToken: vi.fn(),
      onToolStart: vi.fn(),
      onToolEnd: (n, r) => toolEnds.push(r),
      onToolPrompt: vi.fn(),
      onSessionEnd: vi.fn(),
    }, openai)

    // Both tools ran
    expect(toolEnds).toContain('A')
    expect(toolEnds).toContain('B')

    // They started before either ended (proving parallelism)
    expect(callLog[0]).toBe('start:A')
    expect(callLog[1]).toBe('start:B')

    // Session messages have tool results in original order (tc1 then tc2)
    const toolMsgs = (session.messages as any[]).filter(m => m.role === 'tool')
    expect(toolMsgs[0].tool_call_id).toBe('tc1')
    expect(toolMsgs[1].tool_call_id).toBe('tc2')
  })
```

Also add the `registerTool` import at the top of `tests/agent-loop.test.ts`:

```typescript
import { clearRegistry, registerTool } from '../src/tools/registry.js'
```

(Replace the existing `import { clearRegistry } from '../src/tools/registry.js'`)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/agent-loop.test.ts
```

Expected: new test FAILS — tools still execute sequentially (start:A, end:A, start:B, end:B order)

- [ ] **Step 3: Rewrite `src/loop/agent-loop.ts`**

Replace the entire file with:

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

interface ToolResult {
  tool_call_id: string
  content: string
  name: string
  input: Record<string, unknown>
  ok: boolean
  isMcp: boolean
}

export async function runAgentLoop(
  userMessage: string,
  profile: Profile,
  session: Session,
  context: ToolContext,
  events: AgentLoopEvents,
  openai: OpenAI,
  signal?: AbortSignal
): Promise<void> {
  session.messages.push({ role: 'user', content: userMessage })

  const allTools = [...getAllTools(), ...getMcpToolDefinitions(profile)]
  const openaiTools = toOpenAITools(allTools)

  while (true) {
    if (signal?.aborted) return

    await maybeCondenseMessages(session, profile, openai)

    const stream = await (openai.chat.completions as any).create({
      model: profile.model.id,
      messages: session.messages as OpenAI.ChatCompletionMessageParam[],
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      stream: true,
    }, { signal })

    let assistantContent = ''
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>()
    let tokensIn = 0
    let tokensOut = 0

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      if (delta?.content) {
        assistantContent += delta.content
        events.onToken(delta.content)
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallMap.get(tc.index)
          if (!existing) {
            toolCallMap.set(tc.index, {
              id: tc.id ?? '',
              name: tc.function?.name ?? '',
              args: tc.function?.arguments ?? '',
            })
          } else {
            existing.args += tc.function?.arguments ?? ''
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name = tc.function.name
          }
        }
      }
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens ?? 0
        tokensOut = chunk.usage.completion_tokens ?? 0
      }
    }

    const cost = estimateCost(profile.model.id, tokensIn, tokensOut)
    session.usage.input += tokensIn
    session.usage.output += tokensOut
    session.usage.cost_usd += cost
    events.onStats?.(session.usage.input, session.usage.output, session.usage.cost_usd)
    logEvent({
      session: session.id, profile: profile.name, kind: 'llm',
      model: profile.model.id, tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: cost,
    })

    const toolCalls = [...toolCallMap.values()]

    if (toolCalls.length === 0) {
      session.messages.push({ role: 'assistant', content: assistantContent })
      events.onSessionEnd(session.id)
      return
    }

    const assistantMsg: any = {
      role: 'assistant',
      content: assistantContent || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.args },
      })),
    }
    session.messages.push(assistantMsg)

    // --- Parallel tool execution (Strategy C) ---
    // allow tools batch in parallel; prompt/deny tools flush batch first then run serially

    const executeAllowTool = async (
      tc: { id: string; name: string; args: string },
      input: Record<string, unknown>,
      isMcp: boolean
    ): Promise<ToolResult> => {
      await runHooks('pre_tool', profile, { TOOL_NAME: tc.name })
      events.onToolStart(tc.name, input)

      const toolDef = allTools.find(t => t.name === tc.name)
      const toolStart = Date.now()
      let result: string
      let ok = true
      try {
        if (!toolDef) throw new Error(`Tool "${tc.name}" not found in registry`)
        result = await toolDef.execute(input, context)
      } catch (e: any) {
        result = `Error: ${e.message}`
        ok = false
      }
      const duration_ms = Date.now() - toolStart

      logEvent({
        session: session.id, profile: profile.name,
        kind: isMcp ? 'mcp' : 'tool',
        name: tc.name, duration_ms, ok,
      })
      await runHooks('post_tool', profile, { TOOL_NAME: tc.name, TOOL_OK: String(ok) })
      events.onToolEnd(tc.name, result)

      return { tool_call_id: tc.id, content: result, name: tc.name, input, ok, isMcp }
    }

    const toolResults: ToolResult[] = new Array(toolCalls.length)
    let pendingBatch: Array<{ tc: { id: string; name: string; args: string }; input: Record<string, unknown>; isMcp: boolean; idx: number }> = []

    const flushBatch = async () => {
      if (pendingBatch.length === 0) return
      const batchResults = await Promise.all(
        pendingBatch.map(({ tc, input, isMcp }) => executeAllowTool(tc, input, isMcp))
      )
      for (let b = 0; b < pendingBatch.length; b++) {
        toolResults[pendingBatch[b].idx] = batchResults[b]
      }
      pendingBatch = []
    }

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      let input: Record<string, unknown>
      try { input = JSON.parse(tc.args || '{}') } catch { input = {} }
      const isMcp = tc.name.includes('__')
      const acl = isMcp
        ? getMcpAcl(tc.name.split('__', 2)[0], tc.name.split('__', 2)[1], profile)
        : getAcl(tc.name, profile)

      if (acl === 'deny') {
        await flushBatch()
        toolResults[i] = {
          tool_call_id: tc.id,
          content: `Tool "${tc.name}" is denied by profile ACL.`,
          name: tc.name, input, ok: false, isMcp,
        }
      } else if (acl === 'prompt') {
        await flushBatch()
        const approved = await events.onToolPrompt(tc.id, tc.name, input)
        if (!approved) {
          toolResults[i] = {
            tool_call_id: tc.id,
            content: `User denied tool "${tc.name}".`,
            name: tc.name, input, ok: false, isMcp,
          }
        } else {
          toolResults[i] = await executeAllowTool(tc, input, isMcp)
        }
      } else {
        // allow — add to pending batch
        pendingBatch.push({ tc, input, isMcp, idx: i })
      }
    }
    await flushBatch()

    // Push results in original LLM-specified order
    for (const r of toolResults) {
      session.messages.push({
        role: 'tool', tool_call_id: r.tool_call_id, content: r.content,
      } as any)
      session.tool_calls.push({
        name: r.name, input: r.input, result: r.content, ok: r.ok, ts: new Date().toISOString(),
      })
    }
  }
}

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  void model
  return (tokensIn * 0.000003) + (tokensOut * 0.000015)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/agent-loop.test.ts
```

Expected: all tests PASS (including the new parallel execution test)

- [ ] **Step 5: Run full suite**

```bash
pnpm test
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/loop/agent-loop.ts tests/agent-loop.test.ts
git commit -m "feat: parallel tool execution and context window management in agent loop"
```

---

## Task 5: Server — Fire-and-Forget `runHooks` for `on_stop`

**Files:**
- Modify: `src/server/index.ts`

The server's WS `close` handler cannot be async (the close event is fire-and-forget by nature). `runHooks` is now async, so the `on_stop` call must use the fire-and-forget pattern with explicit error logging.

- [ ] **Step 1: Update `src/server/index.ts`**

Find the `ws.on('close', ...)` handler (lines 136–159). Replace the `runHooks` call:

**Before:**
```typescript
    ws.on('close', () => {
      saveSession(session)

      // on_stop hooks
      runHooks('on_stop', profile, { SESSION_ID: session.id, PROFILE: profile.name })
```

**After:**
```typescript
    ws.on('close', () => {
      saveSession(session)

      // on_stop hooks (fire-and-forget — close handler cannot be async)
      void runHooks('on_stop', profile, { SESSION_ID: session.id, PROFILE: profile.name })
        .catch(e => console.error('[on_stop hook] error:', e.message))
```

- [ ] **Step 2: Run full suite**

```bash
pnpm test
```

Expected: all tests PASS

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "fix: fire-and-forget runHooks on_stop in ws close handler"
```

---

## Final Verification

- [ ] **Run full test suite one more time**

```bash
pnpm test
```

Expected: all tests PASS (71+ tests)

- [ ] **Typecheck**

```bash
pnpm typecheck
```

Expected: no errors
