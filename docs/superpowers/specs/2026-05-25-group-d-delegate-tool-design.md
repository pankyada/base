# Group D — Delegate Tool Design

**Goal:** Implement the `Delegate` tool so the agent can spin up a sub-agent using a different profile, run it to completion, and return the result.

**Architecture:** Expand `ToolContext` with four new fields (`events`, `openai`, `signal`, `delegateDepth`). Implement `delegate.ts` to discover the target profile, create an isolated sub-agent, forward its output to the parent's WebSocket, and return the final reply plus a tool summary. Max delegation depth is 1 — sub-agents cannot delegate further.

**Tech Stack:** TypeScript, Node.js, OpenAI SDK, Vitest

---

## Architecture

Four files change:

| File | Change |
|------|--------|
| `src/tools/types.ts` | Add `events`, `openai`, `signal`, `delegateDepth` to `ToolContext` |
| `src/tools/builtin/delegate.ts` | Full implementation (currently a stub) |
| `src/server/index.ts` | Pass new fields in context; `delegateDepth: 0` at top level |
| `src/loop/agent-loop.ts` | No changes — already passes `context` through to tools |

---

## `ToolContext` additions

```typescript
// src/tools/types.ts
import type OpenAI from 'openai'
import type { AgentLoopEvents } from '../loop/agent-loop.js'

export interface ToolContext {
  profile: Profile
  session: Session
  workingDir: string
  memory: MemoryProvider
  skills: Skill[]
  mcpEntries: McpEntry[]
  events: AgentLoopEvents      // forward sub-agent output to parent WS
  openai: OpenAI               // LLM client for this agent's profile
  signal?: AbortSignal         // propagate cancellation into sub-agent
  delegateDepth: number        // 0 = top-level; sub-agent gets 1; tool blocks ≥ 1
}
```

---

## `delegate.ts` — Execution Flow

### Inputs
```typescript
{ profile: string, task: string }
```

### Steps

1. **Depth check** — if `context.delegateDepth >= 1`, return:
   ```
   Error: cannot delegate from within a sub-agent (max depth is 1).
   ```

2. **Profile discovery** — search in order:
   - `profiles/<name>.yaml` (relative to `process.cwd()`)
   - `~/.harness/profiles/<name>.yaml`

   If neither exists, return:
   ```
   Error: profile "<name>" not found. Searched: profiles/<name>.yaml, ~/.harness/profiles/<name>.yaml
   ```

3. **Sub-agent setup**:
   ```typescript
   const subProfile = loadProfile(profilePath)
   const subOpenai = createProviderClient(subProfile)
   const subMcpEntries = await createMcpClients(subProfile)
   const subSession = createSession(subProfile.name)
   const subMemory = new FsMemoryProvider(subProfile.artifact_dir, subSession)
   const subSkills = loadAllSkills(resolveSkillsDirs())
   ```

4. **Sub-context**:
   ```typescript
   const subContext: ToolContext = {
     profile: subProfile,
     session: subSession,
     workingDir: subProfile.working_dir,
     memory: subMemory,
     skills: subSkills,
     mcpEntries: subMcpEntries,
     events: context.events,   // forward to parent WS
     openai: subOpenai,
     signal: context.signal,
     delegateDepth: 1,         // blocks further delegation
   }
   ```

5. **Event forwarding** — sub-agent events call parent events directly:
   - `onToken` → `context.events.onToken`
   - `onToolStart` → `context.events.onToolStart`
   - `onToolEnd` → `context.events.onToolEnd`
   - `onToolPrompt` → `context.events.onToolPrompt`
   - `onSessionEnd` → no-op (parent manages its own session end)
   - `onStats` → `context.events.onStats` (if present)

6. **Run loop**:
   ```typescript
   await runAgentLoop(task, subProfile, subSession, subContext, subEvents, subOpenai, context.signal)
   ```

7. **Cleanup** — always, even on error:
   ```typescript
   await destroyMcpClients(subMcpEntries).catch(() => {})
   ```

8. **Return value** — final assistant message + tool summary:
   ```
   [Delegate: <profile-name>]
   <final assistant text>

   Tools used: Read ×3, Bash ×2, Write ×1
   ```
   Tool summary built from `subSession.tool_calls`. If no tools were called: `Tools used: (none)`.
   If sub-agent produces no assistant text (e.g., only tool calls with no final reply): use last tool result.

### Error handling

All errors are caught and returned as error strings — never thrown. The parent agent gets a readable error message it can report or retry.

---

## `src/server/index.ts` changes

In `wss.on('connection', ...)`, the context object gains three new fields:

```typescript
const context = {
  profile, session, workingDir: profile.working_dir,
  memory, skills, mcpEntries,
  events,          // the AgentLoopEvents object already constructed for runAgentLoop
  openai,          // already in scope
  signal: abortController.signal,
  delegateDepth: 0,
}
```

`events` is the object literal already passed to `runAgentLoop` — extract it into a `const events = { ... }` variable first, then pass it both to `runAgentLoop` and into `context`.

---

## Testing

File: `tests/delegate.test.ts`

Three tests, all using `vi.mock('../src/loop/agent-loop.js')` to avoid real LLM calls:

### Test 1: Depth limit
```typescript
it('returns error when delegateDepth >= 1', async () => {
  const context = makeContext({ delegateDepth: 1 })
  const result = await delegateTool.execute({ profile: 'coding', task: 'do something' }, context)
  expect(result).toContain('cannot delegate')
})
```

### Test 2: Profile not found
```typescript
it('returns error when profile does not exist', async () => {
  const context = makeContext({ delegateDepth: 0 })
  const result = await delegateTool.execute({ profile: 'nonexistent-xyz', task: 'do something' }, context)
  expect(result).toContain('not found')
  expect(result).toContain('nonexistent-xyz')
})
```

### Test 3: Successful delegation
```typescript
it('returns final assistant text and tool summary on success', async () => {
  // Write a minimal test profile to a temp dir, mock runAgentLoop to
  // push one assistant message into the session, verify return format.
  vi.mocked(runAgentLoop).mockImplementation(async (_msg, _profile, session) => {
    session.messages.push({ role: 'assistant', content: 'Task complete.' })
    session.tool_calls.push({ name: 'Read', input: {}, result: 'ok', ok: true, ts: new Date().toISOString() })
  })
  // ... set up temp profile YAML ...
  const result = await delegateTool.execute({ profile: 'test-delegate', task: 'read a file' }, context)
  expect(result).toContain('[Delegate: test-delegate]')
  expect(result).toContain('Task complete.')
  expect(result).toContain('Read ×1')
})
```

`makeContext` is a test helper that builds a minimal `ToolContext` with mocked `events`, `openai`, and `signal`.
