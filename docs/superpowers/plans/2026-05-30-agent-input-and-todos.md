# Agent Input Requests + Todo Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent pause its loop and ask the user a question (free-text, single-select, or multi-select), and give agents a built-in TodoWrite/TodoRead tool with live display in both TUI and web clients.

**Architecture:** `AskUser` is a built-in tool that suspends the agent loop via a new `onInputRequest` event (mirrors existing `onToolPrompt`). Todos are stored on the `Session` object and broadcast via a new `todos` ServerMessage whenever `TodoWrite` fires; both UIs react to this message to render a live panel.

**Tech Stack:** TypeScript, Ink (TUI), Next.js/React (web), Vitest (tests), existing WS protocol

---

## File Map

| Status | Path | Change |
|--------|------|--------|
| Modify | `src/types.ts` | Add `TodoItem`, `input_request` ServerMessage, `input_response` ClientMessage, `todos` ServerMessage |
| Modify | `web/lib/types.ts` | Same additions (web-side copy) |
| Modify | `src/session/types.ts` | Add `todos: TodoItem[]` field |
| Modify | `src/session/store.ts` | Init `todos: []` in `createSession` |
| Modify | `src/tools/types.ts` | Add `onInputRequest` and `onTodosUpdate` to `AgentLoopEvents` |
| Create | `src/tools/builtin/ask-user.ts` | `AskUser` tool |
| Create | `src/tools/builtin/todo-write.ts` | `TodoWrite` tool |
| Create | `src/tools/builtin/todo-read.ts` | `TodoRead` tool |
| Modify | `src/tools/builtin/index.ts` | Register all three new tools |
| Modify | `src/server/index.ts` | Handle `input_response`, wire `onInputRequest` + `onTodosUpdate` events |
| Create | `src/tui/components/InputRequestModal.tsx` | TUI modal for text/select/multi-select |
| Create | `src/tui/components/TodoPanel.tsx` | TUI todo list panel |
| Modify | `src/tui/app.tsx` | Integrate InputRequestModal + TodoPanel |
| Create | `web/components/InputRequestModal.tsx` | Web modal for text/select/multi-select |
| Create | `web/components/TodoPanel.tsx` | Web todo panel |
| Modify | `web/components/HarnessApp.tsx` | Integrate both new components into state machine |
| Create | `tests/ask-user-tool.test.ts` | Unit tests for AskUser tool |
| Create | `tests/todo-tools.test.ts` | Unit tests for TodoWrite + TodoRead |

---

## Task 1: Protocol types

**Files:**
- Modify: `src/types.ts`
- Modify: `web/lib/types.ts`

- [ ] **Step 1: Add `TodoItem`, `input_request`, `input_response`, and `todos` to `src/types.ts`**

```typescript
// Add after the existing AclValue export at line 1

export type InputRequestKind = 'text' | 'select' | 'multi_select'

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
}
```

In the `ServerMessage` union, add two new variants:
```typescript
  | { type: 'input_request'; id: string; prompt: string; kind: InputRequestKind; options?: string[] }
  | { type: 'todos'; todos: TodoItem[] }
```

In the `ClientMessage` union, add:
```typescript
  | { type: 'input_response'; id: string; value: string }
```

- [ ] **Step 2: Mirror the same changes in `web/lib/types.ts`**

Identical additions — `InputRequestKind`, `TodoItem`, two new `ServerMessage` variants, one new `ClientMessage` variant.

- [ ] **Step 3: Type-check**

```bash
pnpm typecheck
```
Expected: no errors (new types are purely additive)

- [ ] **Step 4: Commit**

```bash
git add src/types.ts web/lib/types.ts
git commit -m "feat: add TodoItem, input_request/response, todos to WS protocol types"
```

---

## Task 2: Session and AgentLoopEvents extensions

**Files:**
- Modify: `src/session/types.ts`
- Modify: `src/session/store.ts`
- Modify: `src/tools/types.ts`

- [ ] **Step 1: Add `todos` to the `Session` interface in `src/session/types.ts`**

```typescript
import type { TodoItem } from '../types.js'

export interface Session {
  id: string
  user: string
  profile: string
  created_at: string
  messages: unknown[]
  tool_calls: SessionToolCall[]
  usage: { input: number; output: number; cost_usd: number }
  session_memory: Record<string, string>
  todos: TodoItem[]   // ← add this
}
```

- [ ] **Step 2: Init `todos: []` in `createSession` in `src/session/store.ts`**

```typescript
export function createSession(profileName: string, user: string): Session {
  return {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    user: sanitizeUserId(user),
    profile: profileName,
    created_at: new Date().toISOString(),
    messages: [],
    tool_calls: [],
    usage: { input: 0, output: 0, cost_usd: 0 },
    session_memory: {},
    todos: [],   // ← add this
  }
}
```

- [ ] **Step 3: Add `onInputRequest` and `onTodosUpdate` to `AgentLoopEvents` in `src/tools/types.ts`**

```typescript
import type { TodoItem, InputRequestKind } from '../types.js'

export interface AgentLoopEvents {
  onToken(token: string): void
  onToolStart(name: string, input: Record<string, unknown>): void
  onToolEnd(name: string, result: string): void
  onToolPrompt(id: string, name: string, input: Record<string, unknown>): Promise<boolean>
  onSessionEnd(sessionId: string): void
  onStats?(tokens_in: number, tokens_out: number, cost_usd: number): void
  onArtifacts?(sessionId: string, artifacts: any[]): void
  onInputRequest?(id: string, prompt: string, kind: InputRequestKind, options?: string[]): Promise<string>
  onTodosUpdate?(todos: TodoItem[]): void
}
```

- [ ] **Step 4: Type-check**

```bash
pnpm typecheck
```
Expected: no errors — existing callers of `AgentLoopEvents` use optional fields so they are backward-compatible.

- [ ] **Step 5: Commit**

```bash
git add src/session/types.ts src/session/store.ts src/tools/types.ts
git commit -m "feat: add todos to Session, onInputRequest+onTodosUpdate to AgentLoopEvents"
```

---

## Task 3: AskUser built-in tool

**Files:**
- Create: `src/tools/builtin/ask-user.ts`
- Modify: `src/tools/builtin/index.ts`
- Create: `tests/ask-user-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ask-user-tool.test.ts
import { describe, it, expect, vi } from 'vitest'
import { askUserTool } from '../src/tools/builtin/ask-user.js'

describe('AskUser tool', () => {
  it('calls onInputRequest with text kind and returns the response', async () => {
    const onInputRequest = vi.fn().mockResolvedValue('Paris')
    const ctx: any = { events: { onInputRequest } }

    const result = await askUserTool.execute(
      { prompt: 'What city?', kind: 'text' },
      ctx
    )

    expect(onInputRequest).toHaveBeenCalledWith(
      expect.any(String), 'What city?', 'text', undefined
    )
    expect(result).toBe('Paris')
  })

  it('calls onInputRequest with select kind and options', async () => {
    const onInputRequest = vi.fn().mockResolvedValue('red')
    const ctx: any = { events: { onInputRequest } }

    const result = await askUserTool.execute(
      { prompt: 'Pick a color', kind: 'select', options: ['red', 'blue', 'green'] },
      ctx
    )

    expect(onInputRequest).toHaveBeenCalledWith(
      expect.any(String), 'Pick a color', 'select', ['red', 'blue', 'green']
    )
    expect(result).toBe('red')
  })

  it('falls back to prompt text when onInputRequest not wired', async () => {
    const ctx: any = { events: {} }

    const result = await askUserTool.execute(
      { prompt: 'What city?', kind: 'text' },
      ctx
    )

    expect(result).toBe('[input_request not supported in this environment]')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/ask-user-tool.test.ts
```
Expected: FAIL — `askUserTool` not found

- [ ] **Step 3: Implement `src/tools/builtin/ask-user.ts`**

```typescript
import { randomUUID } from 'crypto'
import type { ToolDefinition } from '../types.js'
import type { InputRequestKind } from '../../types.js'

export const askUserTool: ToolDefinition = {
  name: 'AskUser',
  description: 'Pause and ask the user a question. Use kind="text" for free text, "select" for one choice from options, "multi_select" for multiple choices from options.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Question to ask the user' },
      kind: {
        type: 'string',
        enum: ['text', 'select', 'multi_select'],
        description: 'Input type',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required for select and multi_select kinds',
      },
    },
    required: ['prompt', 'kind'],
  },
  async execute(input, context) {
    const { prompt, kind, options } = input as {
      prompt: string
      kind: InputRequestKind
      options?: string[]
    }

    if (!context.events.onInputRequest) {
      return '[input_request not supported in this environment]'
    }

    const id = randomUUID().replace(/-/g, '').slice(0, 8)
    const response = await context.events.onInputRequest(id, prompt, kind, options)
    return response
  },
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/ask-user-tool.test.ts
```
Expected: all 3 tests PASS

- [ ] **Step 5: Register in `src/tools/builtin/index.ts`**

```typescript
import { askUserTool } from './ask-user.js'
// ... existing imports ...

export function registerAll(): void {
  // ... existing registrations ...
  registerTool(askUserTool)
}
```

- [ ] **Step 6: Type-check**

```bash
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/tools/builtin/ask-user.ts src/tools/builtin/index.ts tests/ask-user-tool.test.ts
git commit -m "feat: add AskUser built-in tool with text/select/multi_select support"
```

---

## Task 4: TodoWrite and TodoRead built-in tools

**Files:**
- Create: `src/tools/builtin/todo-write.ts`
- Create: `src/tools/builtin/todo-read.ts`
- Modify: `src/tools/builtin/index.ts`
- Create: `tests/todo-tools.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/todo-tools.test.ts
import { describe, it, expect, vi } from 'vitest'
import { todoWriteTool } from '../src/tools/builtin/todo-write.js'
import { todoReadTool } from '../src/tools/builtin/todo-read.js'

function makeCtx(todos: any[] = []) {
  const session: any = { todos }
  const onTodosUpdate = vi.fn()
  const ctx: any = { session, events: { onTodosUpdate } }
  return { ctx, session, onTodosUpdate }
}

describe('TodoWrite', () => {
  it('replaces the session todos and fires onTodosUpdate', async () => {
    const { ctx, session, onTodosUpdate } = makeCtx()
    const items = [
      { id: '1', content: 'Write tests', status: 'in_progress', priority: 'high' },
      { id: '2', content: 'Deploy', status: 'pending', priority: 'medium' },
    ]

    const result = await todoWriteTool.execute({ items }, ctx)

    expect(session.todos).toEqual(items)
    expect(onTodosUpdate).toHaveBeenCalledWith(items)
    expect(result).toContain('2 todo')
  })

  it('validates status and priority values', async () => {
    const { ctx } = makeCtx()
    const result = await todoWriteTool.execute(
      { items: [{ id: '1', content: 'x', status: 'done', priority: 'critical' }] },
      ctx
    )
    expect(result).toContain('Error')
  })
})

describe('TodoRead', () => {
  it('returns JSON of current todos', async () => {
    const items = [{ id: '1', content: 'Foo', status: 'pending', priority: 'low' }]
    const { ctx } = makeCtx(items)

    const result = await todoReadTool.execute({}, ctx)
    expect(JSON.parse(result)).toEqual(items)
  })

  it('returns empty array when no todos', async () => {
    const { ctx } = makeCtx()
    const result = await todoReadTool.execute({}, ctx)
    expect(JSON.parse(result)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/todo-tools.test.ts
```
Expected: FAIL — modules not found

- [ ] **Step 3: Implement `src/tools/builtin/todo-write.ts`**

```typescript
import type { ToolDefinition } from '../types.js'
import type { TodoItem } from '../../types.js'

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed'])
const VALID_PRIORITIES = new Set(['high', 'medium', 'low'])

export const todoWriteTool: ToolDefinition = {
  name: 'TodoWrite',
  description: 'Replace the current todo list with the provided items. Always pass the complete list — this overwrites everything.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Complete todo list',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['id', 'content', 'status', 'priority'],
        },
      },
    },
    required: ['items'],
  },
  async execute(input, context) {
    const { items } = input as { items: TodoItem[] }

    for (const item of items) {
      if (!VALID_STATUSES.has(item.status)) {
        return `Error: invalid status "${item.status}" — must be pending | in_progress | completed`
      }
      if (!VALID_PRIORITIES.has(item.priority)) {
        return `Error: invalid priority "${item.priority}" — must be high | medium | low`
      }
    }

    context.session.todos = items
    context.events.onTodosUpdate?.(items)
    return `Updated ${items.length} todo item${items.length !== 1 ? 's' : ''}`
  },
}
```

- [ ] **Step 4: Implement `src/tools/builtin/todo-read.ts`**

```typescript
import type { ToolDefinition } from '../types.js'

export const todoReadTool: ToolDefinition = {
  name: 'TodoRead',
  description: 'Return the current todo list as JSON.',
  parameters: { type: 'object', properties: {} },
  async execute(_input, context) {
    return JSON.stringify(context.session.todos ?? [], null, 2)
  },
}
```

- [ ] **Step 5: Run test — verify it passes**

```bash
npx vitest run tests/todo-tools.test.ts
```
Expected: all 4 tests PASS

- [ ] **Step 6: Register both tools in `src/tools/builtin/index.ts`**

```typescript
import { todoWriteTool } from './todo-write.js'
import { todoReadTool } from './todo-read.js'

export function registerAll(): void {
  // ... existing registrations ...
  registerTool(todoWriteTool)
  registerTool(todoReadTool)
}
```

- [ ] **Step 7: Type-check and run all tests**

```bash
pnpm typecheck && pnpm test
```
Expected: 0 type errors, all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/tools/builtin/todo-write.ts src/tools/builtin/todo-read.ts src/tools/builtin/index.ts tests/todo-tools.test.ts
git commit -m "feat: add TodoWrite and TodoRead built-in tools with session state + broadcast"
```

---

## Task 5: Server wiring

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add `pendingInputRequests` map and handle `input_response` in the WS message handler**

In the `wss.on('connection', ...)` block, after the `pendingApprovals` map declaration, add:

```typescript
const pendingInputRequests = new Map<string, (value: string) => void>()
```

In the `ws.on('message', ...)` handler, after the `tool_approve/tool_deny` block, add:

```typescript
if (msg.type === 'input_response') {
  const cb = pendingInputRequests.get(msg.id)
  if (cb) { pendingInputRequests.delete(msg.id); cb(msg.value) }
  return
}
```

- [ ] **Step 2: Wire `onInputRequest` and `onTodosUpdate` into the `events` object**

In the `events: AgentLoopEvents = { ... }` block (inside the `msg.type === 'message'` handler), add:

```typescript
onInputRequest: (id, prompt, kind, options) => new Promise<string>(res => {
  pendingInputRequests.set(id, res)
  send({ type: 'input_request', id, prompt, kind, options })
}),
onTodosUpdate: (todos) => {
  send({ type: 'todos', todos })
},
```

- [ ] **Step 3: Build and smoke-test server starts**

```bash
pnpm build && node dist/server/index.js 2>&1 | head -5
```
Expected: `Harness server on ws://localhost:7337` (then Ctrl-C)

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: wire input_request/response and todos broadcast in WS server"
```

---

## Task 6: TUI — InputRequestModal

**Files:**
- Create: `src/tui/components/InputRequestModal.tsx`

- [ ] **Step 1: Implement `InputRequestModal`**

This component handles all three kinds. For `text` it renders a `TextInput`; for `select` and `multi_select` it renders an arrow-navigable list. `multi_select` uses space to toggle items and enter to confirm.

```tsx
// src/tui/components/InputRequestModal.tsx
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { C } from '../theme.js'
import type { InputRequestKind } from '../../types.js'

interface Props {
  id: string
  prompt: string
  kind: InputRequestKind
  options?: string[]
  onSubmit: (id: string, value: string) => void
}

export function InputRequestModal({ id, prompt, kind, options = [], onSubmit }: Props) {
  const [textValue, setTextValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  useInput((input, key) => {
    if (kind === 'text') return // TextInput handles its own input

    if (key.upArrow) setCursor(c => Math.max(0, c - 1))
    if (key.downArrow) setCursor(c => Math.min(options.length - 1, c + 1))

    if (kind === 'multi_select' && input === ' ') {
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(cursor)) next.delete(cursor)
        else next.add(cursor)
        return next
      })
    }

    if (key.return) {
      if (kind === 'select') {
        onSubmit(id, options[cursor])
      } else if (kind === 'multi_select') {
        const chosen = [...selected].sort().map(i => options[i])
        onSubmit(id, chosen.join(', '))
      }
    }
  })

  return (
    <Box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <Box
        width={62}
        flexDirection="column"
        borderStyle="single"
        borderColor={C.accent}
        padding={1}
      >
        <Text color={C.accent} bold>Agent Question</Text>
        <Box marginTop={1} marginBottom={1}>
          <Text>{prompt}</Text>
        </Box>

        {kind === 'text' && (
          <Box>
            <Text color={C.dim}>› </Text>
            <TextInput
              value={textValue}
              onChange={setTextValue}
              onSubmit={v => onSubmit(id, v)}
              placeholder="Type your answer..."
            />
          </Box>
        )}

        {(kind === 'select' || kind === 'multi_select') && (
          <Box flexDirection="column">
            {options.map((opt, i) => {
              const isActive = i === cursor
              const isSelected = selected.has(i)
              const prefix = kind === 'multi_select'
                ? (isSelected ? '◉ ' : '○ ')
                : (isActive ? '▶ ' : '  ')
              return (
                <Box key={i}>
                  <Text
                    color={isActive ? C.accent : C.fg}
                    bold={isActive}
                  >
                    {prefix}{opt}
                  </Text>
                </Box>
              )
            })}
            <Box marginTop={1}>
              <Text color={C.dim}>
                {kind === 'multi_select'
                  ? '↑↓ navigate  Space toggle  Enter confirm'
                  : '↑↓ navigate  Enter select'}
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/components/InputRequestModal.tsx
git commit -m "feat: add TUI InputRequestModal for text/select/multi_select agent questions"
```

---

## Task 7: TUI — TodoPanel

**Files:**
- Create: `src/tui/components/TodoPanel.tsx`

- [ ] **Step 1: Implement `TodoPanel`**

```tsx
// src/tui/components/TodoPanel.tsx
import React from 'react'
import { Box, Text } from 'ink'
import { C } from '../theme.js'
import type { TodoItem } from '../../types.js'

interface Props {
  todos: TodoItem[]
}

const STATUS_ICON: Record<TodoItem['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
}

const STATUS_COLOR: Record<TodoItem['status'], string> = {
  pending: C.dim,
  in_progress: C.accent,
  completed: C.ok,
}

const PRIORITY_COLOR: Record<TodoItem['priority'], string> = {
  high: C.del,
  medium: C.warn,
  low: C.dim,
}

export function TodoPanel({ todos }: Props) {
  if (todos.length === 0) return null

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={C.border}
      paddingX={1}
      paddingY={0}
      marginTop={1}
    >
      <Text color={C.dim} bold>Tasks</Text>
      {todos.map(item => (
        <Box key={item.id} marginTop={0}>
          <Text color={STATUS_COLOR[item.status]}>
            {STATUS_ICON[item.status]}{' '}
          </Text>
          <Text
            color={item.status === 'completed' ? C.dim : C.fg}
            strikethrough={item.status === 'completed'}
          >
            {item.content}
          </Text>
          <Text color={PRIORITY_COLOR[item.priority]}>
            {' '}[{item.priority}]
          </Text>
        </Box>
      ))}
    </Box>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/components/TodoPanel.tsx
git commit -m "feat: add TUI TodoPanel component with status icons and priority colors"
```

---

## Task 8: TUI — App integration

**Files:**
- Modify: `src/tui/app.tsx`

- [ ] **Step 1: Import new components and add state**

At the top of `src/tui/app.tsx`, add imports:

```tsx
import { InputRequestModal } from './components/InputRequestModal.js'
import { TodoPanel } from './components/TodoPanel.js'
import type { TodoItem, InputRequestKind } from '../types.js'
```

In the `App` function state declarations, add:

```tsx
const [todos, setTodos] = useState<TodoItem[]>([])
const [pendingInputRequest, setPendingInputRequest] = useState<{
  id: string; prompt: string; kind: InputRequestKind; options?: string[]
  resolve: (v: string) => void
} | null>(null)
```

- [ ] **Step 2: Handle `input_request` and `todos` in `handleMessage`**

In the `handleMessage` callback, add two new cases:

```tsx
if (msg.type === 'input_request') {
  // Store a promise resolver so the modal can fulfill it when user submits
  // We use a ref to break the closure issue — see Step 3 for the resolver pattern
  pendingInputResolveRef.current = null // set in the state update below
  setPendingInputRequest({ id: msg.id, prompt: msg.prompt, kind: msg.kind, options: msg.options, resolve: () => {} })
  // The actual resolve callback is wired up in the useEffect in Step 3
}
if (msg.type === 'todos') {
  setTodos(msg.todos)
}
```

Because `handleMessage` is a stable callback (memoized with `useCallback`), use a `ref` to bridge the resolver:

```tsx
const pendingInputResolveRef = useRef<((v: string) => void) | null>(null)
```

Change the `input_request` handler to:

```tsx
if (msg.type === 'input_request') {
  setPendingInputRequest(prev => ({
    id: msg.id,
    prompt: msg.prompt,
    kind: msg.kind,
    options: msg.options,
    resolve: (v: string) => {
      send({ type: 'input_response', id: msg.id, value: v })
    },
  }))
}
```

- [ ] **Step 3: Wire modal submit handler**

Add a handler function inside `App`:

```tsx
const handleInputResponse = (id: string, value: string) => {
  if (pendingInputRequest && pendingInputRequest.id === id) {
    pendingInputRequest.resolve(value)
    setPendingInputRequest(null)
    send({ type: 'input_response', id, value })
  }
}
```

- [ ] **Step 4: Render TodoPanel and InputRequestModal in JSX**

In the `ConvColumn` section, after the messages list and before `<Composer>`, add:

```tsx
{todos.length > 0 && <TodoPanel todos={todos} />}
```

At the end of the returned JSX (after the `pendingApproval` modal block), add:

```tsx
{pendingInputRequest && (
  <InputRequestModal
    id={pendingInputRequest.id}
    prompt={pendingInputRequest.prompt}
    kind={pendingInputRequest.kind}
    options={pendingInputRequest.options}
    onSubmit={handleInputResponse}
  />
)}
```

- [ ] **Step 5: Type-check**

```bash
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/tui/app.tsx
git commit -m "feat: integrate InputRequestModal and TodoPanel into TUI app"
```

---

## Task 9: Web — InputRequestModal

**Files:**
- Create: `web/components/InputRequestModal.tsx`

- [ ] **Step 1: Implement web `InputRequestModal`**

```tsx
// web/components/InputRequestModal.tsx
'use client'
import { useState, useEffect, useRef } from 'react'
import type { InputRequestKind } from '../lib/types.js'

interface Props {
  id: string
  prompt: string
  kind: InputRequestKind
  options?: string[]
  onSubmit: (id: string, value: string) => void
}

export function InputRequestModal({ id, prompt, kind, options = [], onSubmit }: Props) {
  const [textValue, setTextValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (kind === 'text') inputRef.current?.focus()
  }, [kind])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (kind === 'text') return
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(options.length - 1, c + 1)) }
      if (e.key === ' ' && kind === 'multi_select') {
        e.preventDefault()
        setSelected(prev => {
          const next = new Set(prev)
          if (next.has(cursor)) next.delete(cursor)
          else next.add(cursor)
          return next
        })
      }
      if (e.key === 'Enter') {
        if (kind === 'select') onSubmit(id, options[cursor])
        else if (kind === 'multi_select') {
          const chosen = [...selected].sort((a, b) => a - b).map(i => options[i])
          onSubmit(id, chosen.join(', '))
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [kind, cursor, selected, options, id, onSubmit])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ width: '520px', background: 'var(--panel)', border: '1px solid var(--accent)', borderRadius: '0.5rem', padding: '1.25rem' }}>
        <div style={{ color: 'var(--accent)', fontWeight: 'bold', marginBottom: '0.75rem' }}>Agent Question</div>
        <div style={{ marginBottom: '1rem', color: 'var(--fg)' }}>{prompt}</div>

        {kind === 'text' && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              ref={inputRef}
              value={textValue}
              onChange={e => setTextValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && textValue.trim()) onSubmit(id, textValue.trim()) }}
              placeholder="Type your answer..."
              style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--fg)', padding: '0.5rem', borderRadius: '0.25rem' }}
            />
            <button
              onClick={() => textValue.trim() && onSubmit(id, textValue.trim())}
              style={{ padding: '0.5rem 1rem', background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer', borderRadius: '0.25rem' }}
            >
              Submit
            </button>
          </div>
        )}

        {(kind === 'select' || kind === 'multi_select') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {options.map((opt, i) => {
              const isActive = i === cursor
              const isSelected = selected.has(i)
              return (
                <div
                  key={i}
                  onClick={() => {
                    setCursor(i)
                    if (kind === 'select') {
                      onSubmit(id, opt)
                    } else {
                      setSelected(prev => {
                        const next = new Set(prev)
                        if (next.has(i)) next.delete(i)
                        else next.add(i)
                        return next
                      })
                    }
                  }}
                  style={{
                    padding: '0.5rem 0.75rem',
                    background: isActive ? 'var(--panel-hover, rgba(255,255,255,0.05))' : 'transparent',
                    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '0.25rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    color: 'var(--fg)',
                  }}
                >
                  <span style={{ color: isSelected || (kind === 'select' && isActive) ? 'var(--accent)' : 'var(--dim)' }}>
                    {kind === 'multi_select' ? (isSelected ? '◉' : '○') : (isActive ? '▶' : ' ')}
                  </span>
                  {opt}
                </div>
              )
            })}
            {kind === 'multi_select' && (
              <button
                onClick={() => {
                  const chosen = [...selected].sort((a, b) => a - b).map(i => options[i])
                  onSubmit(id, chosen.join(', '))
                }}
                style={{ marginTop: '0.5rem', padding: '0.5rem 1rem', background: 'var(--accent)', color: 'var(--bg)', border: 'none', cursor: 'pointer', borderRadius: '0.25rem' }}
              >
                Confirm selection
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check web**

```bash
cd web && npx tsc --noEmit && cd ..
```

- [ ] **Step 3: Commit**

```bash
git add web/components/InputRequestModal.tsx
git commit -m "feat: add web InputRequestModal for text/select/multi_select"
```

---

## Task 10: Web — TodoPanel

**Files:**
- Create: `web/components/TodoPanel.tsx`

- [ ] **Step 1: Implement web `TodoPanel`**

```tsx
// web/components/TodoPanel.tsx
'use client'
import type { TodoItem } from '../lib/types.js'

interface Props {
  todos: TodoItem[]
}

const STATUS_ICON: Record<TodoItem['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
}

export function TodoPanel({ todos }: Props) {
  if (todos.length === 0) return null

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ color: 'var(--dim)', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Tasks</div>
      {todos.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: item.status === 'completed' ? 'var(--ok)' : item.status === 'in_progress' ? 'var(--accent)' : 'var(--dim)', fontSize: '0.85rem' }}>
            {STATUS_ICON[item.status]}
          </span>
          <span style={{
            color: item.status === 'completed' ? 'var(--dim)' : 'var(--fg)',
            textDecoration: item.status === 'completed' ? 'line-through' : 'none',
            fontSize: '0.875rem',
            flex: 1,
          }}>
            {item.content}
          </span>
          <span style={{
            fontSize: '0.7rem',
            color: item.priority === 'high' ? 'var(--del)' : item.priority === 'medium' ? 'var(--warn)' : 'var(--dim)',
            opacity: 0.8,
          }}>
            {item.priority}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Type-check web**

```bash
cd web && npx tsc --noEmit && cd ..
```

- [ ] **Step 3: Commit**

```bash
git add web/components/TodoPanel.tsx
git commit -m "feat: add web TodoPanel component"
```

---

## Task 11: Web — HarnessApp integration

**Files:**
- Modify: `web/components/HarnessApp.tsx`

- [ ] **Step 1: Add `TodoItem`, `InputRequestKind` to imports and state**

At the top of `HarnessApp.tsx`, add:
```tsx
import { InputRequestModal } from './InputRequestModal.js'
import { TodoPanel } from './TodoPanel.js'
import type { TodoItem, InputRequestKind } from '../lib/types.js'
```

Add new fields to the `State` interface:
```typescript
todos: TodoItem[]
pendingInputRequest: {
  id: string; prompt: string; kind: InputRequestKind; options?: string[]
} | null
```

Initialize them in the initial state:
```typescript
todos: [],
pendingInputRequest: null,
```

- [ ] **Step 2: Add `Action` types**

```typescript
| { type: 'INPUT_REQUEST'; payload: { id: string; prompt: string; kind: InputRequestKind; options?: string[] } }
| { type: 'RESOLVE_INPUT_REQUEST' }
| { type: 'SET_TODOS'; payload: TodoItem[] }
```

- [ ] **Step 3: Add reducer cases**

```typescript
case 'INPUT_REQUEST':
  return { ...state, pendingInputRequest: action.payload }
case 'RESOLVE_INPUT_REQUEST':
  return { ...state, pendingInputRequest: null }
case 'SET_TODOS':
  return { ...state, todos: action.payload }
```

In the `SERVER_MSG` case of the reducer, add:
```typescript
if (msg.type === 'input_request') {
  return { ...state, pendingInputRequest: { id: msg.id, prompt: msg.prompt, kind: msg.kind, options: msg.options } }
}
if (msg.type === 'todos') {
  return { ...state, todos: msg.todos }
}
```

- [ ] **Step 4: Add handlers and render components**

In `HarnessApp`, add:
```tsx
const handleInputResponse = (id: string, value: string) => {
  send({ type: 'input_response', id, value })
  dispatch({ type: 'RESOLVE_INPUT_REQUEST' })
}
```

In the `ConvColumn`, after the messages list, add the `TodoPanel`:
```tsx
<TodoPanel todos={state.todos} />
```

After the `ApprovalModal`, add:
```tsx
{state.pendingInputRequest && (
  <InputRequestModal
    id={state.pendingInputRequest.id}
    prompt={state.pendingInputRequest.prompt}
    kind={state.pendingInputRequest.kind}
    options={state.pendingInputRequest.options}
    onSubmit={handleInputResponse}
  />
)}
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
git add web/components/HarnessApp.tsx
git commit -m "feat: integrate TodoPanel and InputRequestModal into web client"
```

---

## Task 12: End-to-end smoke test

- [ ] **Step 1: Build everything**

```bash
pnpm build
```
Expected: no errors

- [ ] **Step 2: Start server and TUI**

```bash
pnpm dev &
sleep 2 && pnpm dev:tui
```

- [ ] **Step 3: Send a message that triggers AskUser**

Type: `Use TodoWrite to add 3 tasks then use AskUser with kind=select to ask me to pick one`

Expected observations:
1. TodoPanel appears with 3 items listed (with status icons + priority)
2. InputRequestModal appears with the 3 tasks as options
3. Pressing ↑/↓ moves cursor, Enter submits selection
4. Agent receives the selection and continues

- [ ] **Step 4: Test multi_select**

Type: `Use AskUser with kind=multi_select to ask me which features to enable, options: logging, caching, retries`

Expected: modal shows with ○ toggles, Space selects, Enter confirms with comma-separated result

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: agent input requests (text/select/multi_select) + todo tool with live panel"
```
