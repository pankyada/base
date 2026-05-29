# Per-User Identity & Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user isolation to the harness so a single server instance serves multiple users with separate sessions, two-tier memory (shared + private), and a per-user usage ledger.

**Architecture:** Identity flows from client (`HARNESS_USER` env or OS username) via a new `hello` WS message; the server re-sanitizes and scopes all storage under that user id. A single `userPaths()` helper owns the on-disk layout so path logic is never duplicated.

**Tech Stack:** TypeScript, Node.js `fs`, `os`, Vitest. No new npm packages.

---

## File Map

| File | Change |
|------|--------|
| `src/session/user-paths.ts` | CREATE — `sanitizeUserId`, `userPaths` |
| `src/session/types.ts` | ADD `user: string` to `Session` |
| `src/session/store.ts` | Update `createSession`, `saveSession`, `loadSession`; add `listSessions` |
| `src/memory/interface.ts` | Scope union gains `'user'` |
| `src/memory/fs-memory.ts` | Add `user` branch to all methods; merge `buildSystemPromptSection` |
| `src/usage/ledger.ts` | CREATE — `recordUsage` |
| `src/tools/builtin/memory-write.ts` | Scope gains `'user'`; `scope` becomes optional, defaults to `'user'` |
| `src/tools/builtin/memory-read.ts` | Scope enum gains `'user'` |
| `src/tools/builtin/memory-delete.ts` | Scope enum gains `'user'` |
| `src/tools/builtin/memory-list.ts` | Scope enum gains `'user'` |
| `src/improver/default-improver.ts` | `reflect` writes to `'user'` scope; `mineSkills` stays `'profile'` |
| `src/types.ts` | Add `hello` to `ClientMessage` |
| `src/server/index.ts` | Handle `hello`; scope session/memory/resume; call `recordUsage` at close |
| `src/cli/index.ts` | Send `hello` on connect |
| `src/tui/hooks/use-ws.ts` | Send `hello` on connect |
| `tests/user-paths.test.ts` | CREATE |
| `tests/session-store.test.ts` | Update for new signatures |
| `tests/memory.test.ts` | Update for `user` scope + merged prompt section |
| `tests/usage-ledger.test.ts` | CREATE |

---

## Task 1: `user-paths.ts` — path helper

**Files:**
- Create: `src/session/user-paths.ts`
- Create: `tests/user-paths.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/user-paths.test.ts
import { describe, it, expect } from 'vitest'
import { sanitizeUserId, userPaths } from '../src/session/user-paths.js'
import { homedir } from 'os'
import { join } from 'path'

describe('sanitizeUserId', () => {
  it('lowercases input', () => {
    expect(sanitizeUserId('Pankaj')).toBe('pankaj')
  })

  it('replaces unsafe chars with hyphens', () => {
    expect(sanitizeUserId('hello world!')).toBe('hello-world-')
  })

  it('collapses path traversal attempt', () => {
    const result = sanitizeUserId('../../etc')
    expect(result).not.toContain('..')
    expect(result).not.toContain('/')
  })

  it('returns "default" for empty string', () => {
    expect(sanitizeUserId('')).toBe('default')
  })

  it('truncates to 64 chars', () => {
    expect(sanitizeUserId('a'.repeat(100))).toHaveLength(64)
  })

  it('keeps valid chars unchanged', () => {
    expect(sanitizeUserId('pankaj-01_dev')).toBe('pankaj-01_dev')
  })
})

describe('userPaths', () => {
  it('returns correct sessionsDir', () => {
    const paths = userPaths('pankaj', '/tmp/artifacts')
    expect(paths.sessionsDir).toBe(join(homedir(), '.harness', 'sessions', 'pankaj'))
  })

  it('returns correct privateMemDir', () => {
    const paths = userPaths('pankaj', '/tmp/artifacts')
    expect(paths.privateMemDir).toBe('/tmp/artifacts/users/pankaj/memory')
  })

  it('returns correct usageFile', () => {
    const paths = userPaths('pankaj', '/tmp/artifacts')
    expect(paths.usageFile).toBe(join(homedir(), '.harness', 'usage', 'pankaj.json'))
  })

  it('sanitizes user id inside userPaths', () => {
    const paths = userPaths('BAD USER', '/tmp/artifacts')
    expect(paths.sessionsDir).toContain('bad-user-')
    expect(paths.sessionsDir).not.toContain('BAD')
  })
})
```

- [ ] **Step 2: Run — confirm it fails**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
npx vitest run tests/user-paths.test.ts 2>&1 | tail -5
```
Expected: `FAIL` — module not found.

- [ ] **Step 3: Implement**

```ts
// src/session/user-paths.ts
import { join } from 'path'
import { homedir } from 'os'

export function sanitizeUserId(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 64)
  return slug || 'default'
}

export interface UserPaths {
  sessionsDir: string
  privateMemDir: string
  usageFile: string
}

export function userPaths(user: string, artifactDir: string): UserPaths {
  const safe = sanitizeUserId(user)
  return {
    sessionsDir: join(homedir(), '.harness', 'sessions', safe),
    privateMemDir: join(artifactDir, 'users', safe, 'memory'),
    usageFile: join(homedir(), '.harness', 'usage', `${safe}.json`),
  }
}
```

- [ ] **Step 4: Run — confirm all pass**

```bash
npx vitest run tests/user-paths.test.ts 2>&1 | tail -5
```
Expected: `✓ 10 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/session/user-paths.ts tests/user-paths.test.ts
git commit -m "feat: add userPaths helper and sanitizeUserId"
```

---

## Task 2: Session types + store — user isolation

**Files:**
- Modify: `src/session/types.ts`
- Modify: `src/session/store.ts`
- Modify: `tests/session-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire `tests/session-store.test.ts`:

```ts
// tests/session-store.test.ts
import { describe, it, expect } from 'vitest'
import { createSession, saveSession, loadSession, listSessions } from '../src/session/store.js'

describe('session store', () => {
  it('creates session with id, profile, and user', () => {
    const s = createSession('coding', 'pankaj')
    expect(s.id).toHaveLength(8)
    expect(s.profile).toBe('coding')
    expect(s.user).toBe('pankaj')
    expect(s.messages).toEqual([])
    expect(s.usage.cost_usd).toBe(0)
  })

  it('saves and loads session by user + id', () => {
    const s = createSession('coding', 'pankaj')
    s.session_memory['foo'] = 'bar'
    saveSession(s)
    const loaded = loadSession('pankaj', s.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.session_memory['foo']).toBe('bar')
  })

  it('returns null for unknown id', () => {
    expect(loadSession('pankaj', 'unknown0')).toBeNull()
  })

  it('returns null when loading another users session', () => {
    const s = createSession('coding', 'alice')
    saveSession(s)
    expect(loadSession('bob', s.id)).toBeNull()
  })

  it('listSessions returns only that users sessions', () => {
    const s1 = createSession('coding', 'alice')
    const s2 = createSession('coding', 'bob')
    saveSession(s1)
    saveSession(s2)
    const aliceSessions = listSessions('alice')
    const ids = aliceSessions.map(s => s.id)
    expect(ids).toContain(s1.id)
    expect(ids).not.toContain(s2.id)
  })
})
```

- [ ] **Step 2: Run — confirm it fails**

```bash
npx vitest run tests/session-store.test.ts 2>&1 | tail -8
```
Expected: type errors or missing exports.

- [ ] **Step 3: Update `Session` type**

```ts
// src/session/types.ts
export interface SessionToolCall {
  name: string
  input: Record<string, unknown>
  result: string
  ok: boolean
  ts: string
}

export interface Session {
  id: string
  user: string
  profile: string
  created_at: string
  messages: unknown[]
  tool_calls: SessionToolCall[]
  usage: { input: number; output: number; cost_usd: number }
  session_memory: Record<string, string>
}
```

- [ ] **Step 4: Update `store.ts`**

```ts
// src/session/store.ts
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { Session } from './types.js'
import { userPaths, sanitizeUserId } from './user-paths.js'

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
  }
}

export function saveSession(session: Session): void {
  const { sessionsDir } = userPaths(session.user, '')
  mkdirSync(sessionsDir, { recursive: true })
  const date = session.created_at.slice(0, 10)
  const path = join(sessionsDir, `${date}_${session.id}.json`)
  writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8')
}

export function loadSession(user: string, id: string): Session | null {
  const { sessionsDir } = userPaths(user, '')
  if (!existsSync(sessionsDir)) return null
  const files = readdirSync(sessionsDir)
  const match = files.find(f => f.includes(id))
  if (!match) return null
  return JSON.parse(readFileSync(join(sessionsDir, match), 'utf-8')) as Session
}

export function listSessions(user: string): Session[] {
  const { sessionsDir } = userPaths(user, '')
  if (!existsSync(sessionsDir)) return []
  return readdirSync(sessionsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(sessionsDir, f), 'utf-8')) as Session)
}
```

- [ ] **Step 5: Run — confirm all pass**

```bash
npx vitest run tests/session-store.test.ts 2>&1 | tail -8
```
Expected: `✓ 5 tests passed`.

- [ ] **Step 6: Full suite — confirm nothing broken**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: all tests pass (some other tests calling `createSession` or `loadSession` will fail — fix those in the next step before committing).

- [ ] **Step 7: Fix callers broken by signature change**

The file `tests/memory.test.ts` calls `createSession('test')` — update to `createSession('test', 'testuser')`:

```ts
// tests/memory.test.ts  line 14 — change:
provider = new FsMemoryProvider(artifactDir, createSession('test', 'testuser'))
```

Any other test or source file calling `createSession(x)` with one arg: add `'default'` as the second arg.

- [ ] **Step 8: Run full suite**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/session/types.ts src/session/store.ts tests/session-store.test.ts tests/memory.test.ts
git commit -m "feat: user-scoped sessions — createSession(profile, user), loadSession(user, id)"
```

---

## Task 3: Two-tier memory — `interface.ts` + `FsMemoryProvider`

**Files:**
- Modify: `src/memory/interface.ts`
- Modify: `src/memory/fs-memory.ts`
- Modify: `tests/memory.test.ts`

- [ ] **Step 1: Write failing tests** (append to `tests/memory.test.ts`)

Add these cases after the existing ones:

```ts
  // --- user scope ---
  it('reads and writes user-private memory', async () => {
    await provider.write('user', 'my-key', 'private content')
    const val = await provider.read('user', 'my-key')
    expect(val).toBe('private content')
  })

  it('user-scope write does not appear in profile list', async () => {
    await provider.write('user', 'private-key', 'val')
    const profileEntries = await provider.list('profile')
    expect(profileEntries.map(e => e.key)).not.toContain('private-key')
  })

  it('profile-scope write does not appear in user list', async () => {
    await provider.write('profile', 'shared-key', 'val')
    const userEntries = await provider.list('user')
    expect(userEntries.map(e => e.key)).not.toContain('shared-key')
  })

  it('buildSystemPromptSection merges shared and private with labels', async () => {
    await provider.write('profile', 'shared', '# Shared')
    await provider.write('user', 'mine', '# Mine')
    const section = await provider.buildSystemPromptSection()
    expect(section).toContain('Memory (shared)')
    expect(section).toContain('Memory (yours)')
  })

  it('buildSystemPromptSection omits a tier when empty', async () => {
    await provider.write('profile', 'shared', '# Shared only')
    const section = await provider.buildSystemPromptSection()
    expect(section).toContain('Memory (shared)')
    expect(section).not.toContain('Memory (yours)')
  })

  it('deletes user-scope memory key', async () => {
    await provider.write('user', 'del-me', 'content')
    await provider.delete('user', 'del-me')
    expect(await provider.read('user', 'del-me')).toBeNull()
  })
```

- [ ] **Step 2: Run — confirm new tests fail**

```bash
npx vitest run tests/memory.test.ts 2>&1 | tail -10
```
Expected: new tests fail with "invalid scope" or similar.

- [ ] **Step 3: Update `interface.ts`**

```ts
// src/memory/interface.ts
export interface MemoryEntry {
  key: string
  preview: string
}

export interface MemoryProvider {
  read(scope: 'session' | 'profile' | 'user', key: string): Promise<string | null>
  write(scope: 'session' | 'profile' | 'user', key: string, content: string): Promise<void>
  delete(scope: 'session' | 'profile' | 'user', key: string): Promise<void>
  list(scope: 'session' | 'profile' | 'user'): Promise<MemoryEntry[]>
  buildSystemPromptSection(): Promise<string>
}
```

- [ ] **Step 4: Update `fs-memory.ts`**

```ts
// src/memory/fs-memory.ts
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { MemoryProvider, MemoryEntry } from './interface.js'
import { Session } from '../session/types.js'
import { userPaths } from '../session/user-paths.js'

export class FsMemoryProvider implements MemoryProvider {
  constructor(
    private readonly artifactDir: string,
    private readonly session: Session
  ) {}

  private get sharedMemDir(): string {
    return join(this.artifactDir, 'memory')
  }

  private get privateMemDir(): string {
    return userPaths(this.session.user, this.artifactDir).privateMemDir
  }

  private dirFor(scope: 'profile' | 'user'): string {
    return scope === 'profile' ? this.sharedMemDir : this.privateMemDir
  }

  async read(scope: 'session' | 'profile' | 'user', key: string): Promise<string | null> {
    if (scope === 'session') {
      return this.session.session_memory[key] ?? null
    }
    const path = join(this.dirFor(scope), `${key}.md`)
    return existsSync(path) ? readFileSync(path, 'utf-8') : null
  }

  async write(scope: 'session' | 'profile' | 'user', key: string, content: string): Promise<void> {
    if (scope === 'session') {
      this.session.session_memory[key] = content
      return
    }
    const dir = this.dirFor(scope)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${key}.md`), content, 'utf-8')
    await this.rebuildIndex(scope)
  }

  async delete(scope: 'session' | 'profile' | 'user', key: string): Promise<void> {
    if (scope === 'session') {
      delete this.session.session_memory[key]
      return
    }
    const path = join(this.dirFor(scope), `${key}.md`)
    if (existsSync(path)) {
      unlinkSync(path)
      await this.rebuildIndex(scope)
    }
  }

  async list(scope: 'session' | 'profile' | 'user'): Promise<MemoryEntry[]> {
    if (scope === 'session') {
      return Object.entries(this.session.session_memory).map(([key, val]) => ({
        key,
        preview: val.slice(0, 100),
      }))
    }
    const dir = this.dirFor(scope)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
      .map(f => {
        const key = f.replace(/\.md$/, '')
        const content = readFileSync(join(dir, f), 'utf-8')
        return { key, preview: content.slice(0, 100) }
      })
  }

  async buildSystemPromptSection(): Promise<string> {
    const parts: string[] = []

    const sharedIndex = join(this.sharedMemDir, 'MEMORY.md')
    if (existsSync(sharedIndex)) {
      parts.push(`## Memory (shared)\n${readFileSync(sharedIndex, 'utf-8')}`)
    }

    const privateIndex = join(this.privateMemDir, 'MEMORY.md')
    if (existsSync(privateIndex)) {
      parts.push(`## Memory (yours)\n${readFileSync(privateIndex, 'utf-8')}`)
    }

    return parts.length > 0 ? '\n\n' + parts.join('\n\n') : ''
  }

  private async rebuildIndex(scope: 'profile' | 'user'): Promise<void> {
    const entries = await this.list(scope)
    const lines = entries.map(e => `- **${e.key}**: ${e.preview.replace(/\n/g, ' ')}`)
    const dir = this.dirFor(scope)
    writeFileSync(join(dir, 'MEMORY.md'), `# Memory Index\n\n${lines.join('\n')}\n`, 'utf-8')
  }
}
```

- [ ] **Step 5: Run memory tests**

```bash
npx vitest run tests/memory.test.ts 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 6: Run full suite**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/memory/interface.ts src/memory/fs-memory.ts tests/memory.test.ts
git commit -m "feat: two-tier memory — user scope + merged system prompt section"
```

---

## Task 4: Usage ledger

**Files:**
- Create: `src/usage/ledger.ts`
- Create: `tests/usage-ledger.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/usage-ledger.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { recordUsage, readUsage } from '../src/usage/ledger.js'

describe('recordUsage', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'harness-usage-'))
  })

  it('creates a new file with correct totals', () => {
    recordUsage('alice', { input: 100, output: 50, cost_usd: 0.01 }, tmpDir)
    const data = readUsage('alice', tmpDir)
    expect(data).not.toBeNull()
    expect(data!.user).toBe('alice')
    expect(data!.total.input).toBe(100)
    expect(data!.total.output).toBe(50)
    expect(data!.total.cost_usd).toBeCloseTo(0.01)
  })

  it('accumulates across multiple calls', () => {
    recordUsage('alice', { input: 100, output: 50, cost_usd: 0.01 }, tmpDir)
    recordUsage('alice', { input: 200, output: 80, cost_usd: 0.02 }, tmpDir)
    const data = readUsage('alice', tmpDir)!
    expect(data.total.input).toBe(300)
    expect(data.total.output).toBe(130)
    expect(data.total.cost_usd).toBeCloseTo(0.03)
  })

  it('records current month in by_month', () => {
    recordUsage('alice', { input: 50, output: 20, cost_usd: 0.005 }, tmpDir)
    const data = readUsage('alice', tmpDir)!
    const month = new Date().toISOString().slice(0, 7)
    expect(data.by_month[month]).toBeDefined()
    expect(data.by_month[month].input).toBe(50)
  })

  it('accumulates within the same month', () => {
    recordUsage('alice', { input: 10, output: 5, cost_usd: 0.001 }, tmpDir)
    recordUsage('alice', { input: 20, output: 10, cost_usd: 0.002 }, tmpDir)
    const data = readUsage('alice', tmpDir)!
    const month = new Date().toISOString().slice(0, 7)
    expect(data.by_month[month].input).toBe(30)
  })

  it('recovers from a corrupt file and starts fresh', () => {
    const { writeFileSync, mkdirSync } = require('fs')
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(join(tmpDir, 'alice.json'), 'NOT JSON', 'utf-8')
    expect(() => recordUsage('alice', { input: 1, output: 1, cost_usd: 0.001 }, tmpDir)).not.toThrow()
    const data = readUsage('alice', tmpDir)!
    expect(data.total.input).toBe(1)
  })

  it('keeps separate ledgers for different users', () => {
    recordUsage('alice', { input: 100, output: 50, cost_usd: 0.01 }, tmpDir)
    recordUsage('bob', { input: 200, output: 100, cost_usd: 0.02 }, tmpDir)
    expect(readUsage('alice', tmpDir)!.total.input).toBe(100)
    expect(readUsage('bob', tmpDir)!.total.input).toBe(200)
  })
})
```

- [ ] **Step 2: Run — confirm fails**

```bash
npx vitest run tests/usage-ledger.test.ts 2>&1 | tail -5
```
Expected: `FAIL` — module not found.

- [ ] **Step 3: Implement**

```ts
// src/usage/ledger.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface UsageDelta {
  input: number
  output: number
  cost_usd: number
}

export interface MonthBucket extends UsageDelta {}

export interface UserUsage {
  user: string
  total: UsageDelta
  by_month: Record<string, MonthBucket>
  updated_at: string
}

function usageDir(overrideDir?: string): string {
  return overrideDir ?? join(homedir(), '.harness', 'usage')
}

function usageFilePath(user: string, overrideDir?: string): string {
  return join(usageDir(overrideDir), `${user}.json`)
}

function emptyLedger(user: string): UserUsage {
  return {
    user,
    total: { input: 0, output: 0, cost_usd: 0 },
    by_month: {},
    updated_at: new Date().toISOString(),
  }
}

export function recordUsage(user: string, delta: UsageDelta, overrideDir?: string): void {
  const dir = usageDir(overrideDir)
  mkdirSync(dir, { recursive: true })
  const path = usageFilePath(user, overrideDir)

  let ledger: UserUsage
  try {
    ledger = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf-8')) as UserUsage)
      : emptyLedger(user)
  } catch {
    ledger = emptyLedger(user)
  }

  ledger.total.input += delta.input
  ledger.total.output += delta.output
  ledger.total.cost_usd += delta.cost_usd

  const month = new Date().toISOString().slice(0, 7)
  if (!ledger.by_month[month]) {
    ledger.by_month[month] = { input: 0, output: 0, cost_usd: 0 }
  }
  ledger.by_month[month].input += delta.input
  ledger.by_month[month].output += delta.output
  ledger.by_month[month].cost_usd += delta.cost_usd

  ledger.updated_at = new Date().toISOString()
  writeFileSync(path, JSON.stringify(ledger, null, 2), 'utf-8')
}

export function readUsage(user: string, overrideDir?: string): UserUsage | null {
  const path = usageFilePath(user, overrideDir)
  try {
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf-8')) as UserUsage)
      : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run — confirm all pass**

```bash
npx vitest run tests/usage-ledger.test.ts 2>&1 | tail -5
```
Expected: `✓ 6 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/usage/ledger.ts tests/usage-ledger.test.ts
git commit -m "feat: per-user usage ledger with month buckets"
```

---

## Task 5: Memory tools — add `'user'` scope

**Files:**
- Modify: `src/tools/builtin/memory-write.ts`
- Modify: `src/tools/builtin/memory-read.ts`
- Modify: `src/tools/builtin/memory-delete.ts`
- Modify: `src/tools/builtin/memory-list.ts`

No new test file needed — the agent-loop integration tests cover these. Just update the tool definitions.

- [ ] **Step 1: Update `memory-write.ts`**

`scope` becomes optional and defaults to `'user'`:

```ts
// src/tools/builtin/memory-write.ts
import { ToolDefinition, ToolContext } from '../types.js'

export const memoryWriteTool: ToolDefinition = {
  name: 'MemoryWrite',
  description: 'Write a memory entry. "user" scope (default) is private to this user. "profile" scope is shared across all users. "session" scope is in-memory only.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['session', 'profile', 'user'],
        description: 'Defaults to "user" (private). Use "profile" to share with all users.',
      },
      key: { type: 'string', description: 'Short slug (e.g. project-context)' },
      content: { type: 'string', description: 'Markdown content to store' },
    },
    required: ['key', 'content'],
  },
  async execute(input, ctx: ToolContext) {
    const { key, content } = input as { key: string; content: string }
    const scope = ((input as any).scope ?? 'user') as 'session' | 'profile' | 'user'
    await ctx.memory.write(scope, key, content)
    return `Memory written: ${scope}/${key}`
  },
}
```

- [ ] **Step 2: Update `memory-read.ts`**

```ts
// src/tools/builtin/memory-read.ts
import { ToolDefinition, ToolContext } from '../types.js'

export const memoryReadTool: ToolDefinition = {
  name: 'MemoryRead',
  description: 'Read a memory entry by key. Scopes: session, profile (shared), user (private).',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile', 'user'] },
      key: { type: 'string' },
    },
    required: ['scope', 'key'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope, key } = input as { scope: 'session' | 'profile' | 'user'; key: string }
    const val = await ctx.memory.read(scope, key)
    return val ?? `(no memory entry for key: ${key})`
  },
}
```

- [ ] **Step 3: Update `memory-delete.ts`**

```ts
// src/tools/builtin/memory-delete.ts
import { ToolDefinition, ToolContext } from '../types.js'

export const memoryDeleteTool: ToolDefinition = {
  name: 'MemoryDelete',
  description: 'Delete a memory entry by key. Scopes: session, profile (shared), user (private).',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile', 'user'] },
      key: { type: 'string', description: 'Key to delete' },
    },
    required: ['scope', 'key'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope, key } = input as { scope: 'session' | 'profile' | 'user'; key: string }
    const existing = await ctx.memory.read(scope, key)
    if (existing === null) return `No memory entry found for key: ${key} (scope: ${scope})`
    await ctx.memory.delete(scope, key)
    return `Memory deleted: ${scope}/${key}`
  },
}
```

- [ ] **Step 4: Update `memory-list.ts`**

```ts
// src/tools/builtin/memory-list.ts
import { ToolDefinition, ToolContext } from '../types.js'

export const memoryListTool: ToolDefinition = {
  name: 'MemoryList',
  description: 'List all memory entries in a scope. Scopes: session, profile (shared), user (private).',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile', 'user'] },
    },
    required: ['scope'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope } = input as { scope: 'session' | 'profile' | 'user' }
    const entries = await ctx.memory.list(scope)
    if (entries.length === 0) return `(no entries in ${scope} memory)`
    return entries.map(e => `- **${e.key}**: ${e.preview}`).join('\n')
  },
}
```

- [ ] **Step 5: Run full suite**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/builtin/memory-write.ts src/tools/builtin/memory-read.ts \
        src/tools/builtin/memory-delete.ts src/tools/builtin/memory-list.ts
git commit -m "feat: memory tools support user scope; MemoryWrite defaults to user"
```

---

## Task 6: Improver — per-user reflections

**Files:**
- Modify: `src/improver/default-improver.ts` (line 50 only)

No new tests needed — the change is a one-line scope swap in `reflect`. The existing improver tests (if any) don't exercise the write scope directly.

- [ ] **Step 1: Update the write scope in `reflect`**

In `src/improver/default-improver.ts`, find line 50:
```ts
    if (m.key && m.content) await memory.write('profile', m.key, m.content)
```
Change to:
```ts
    if (m.key && m.content) await memory.write('user', m.key, m.content)
```

`mineSkills` does not write to memory directly — it writes skill files to disk — so no change needed there.

- [ ] **Step 2: Run full suite**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/improver/default-improver.ts
git commit -m "feat: improver reflection writes to user scope (private)"
```

---

## Task 7: Protocol + server + clients — wire `hello`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/server/index.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/tui/hooks/use-ws.ts`

- [ ] **Step 1: Add `hello` to `ClientMessage` in `src/types.ts`**

```ts
// src/types.ts
export type AclValue = 'allow' | 'prompt' | 'deny'

export interface TelemetryEvent {
  ts: string
  session: string
  profile: string
  kind: 'tool' | 'skill' | 'mcp' | 'llm'
  name?: string
  server?: string
  model?: string
  duration_ms?: number
  ok?: boolean
  tokens_in?: number
  tokens_out?: number
  cost_usd?: number
  trigger?: string
}

// WebSocket protocol
export type ClientMessage =
  | { type: 'hello'; user_id: string }
  | { type: 'message'; content: string }
  | { type: 'cancel' }
  | { type: 'resume'; sessionId: string }
  | { type: 'tool_approve'; id: string }
  | { type: 'tool_deny'; id: string }

export type ServerMessage =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; name: string; result: string }
  | { type: 'tool_prompt'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'session_end'; sessionId: string }
  | { type: 'stats'; tokens_in: number; tokens_out: number; cost_usd: number; context_window?: number }
  | { type: 'error'; message: string }
```

- [ ] **Step 2: Update `src/server/index.ts`**

Add these imports at the top (alongside existing imports):
```ts
import { sanitizeUserId } from '../session/user-paths.js'
import { recordUsage } from '../usage/ledger.js'
```

Inside `wss.on('connection', (ws) => { ... })`, make these changes:

**a)** Replace `let session = createSession(profile.name)` with:
```ts
let userId = sanitizeUserId(process.env.HARNESS_USER ?? 'default')
let session = createSession(profile.name, userId)
let memory = new FsMemoryProvider(profile.artifact_dir, session)
```
(Remove the existing `let memory = ...` line directly below — it's now inside the userId block.)

**b)** Add a `hello` handler inside `ws.on('message', ...)`, before the `cancel` check:
```ts
      if (msg.type === 'hello') {
        // Only honour hello before the session has any messages
        if (session.messages.length === 0) {
          userId = sanitizeUserId(msg.user_id)
          session = createSession(profile.name, userId)
          memory = new FsMemoryProvider(profile.artifact_dir, session)
        }
        return
      }
```

**c)** Update the `resume` handler to pass `userId`:
```ts
      if (msg.type === 'resume') {
        const loaded = loadSession(userId, msg.sessionId)
        if (loaded) {
          session = loaded
          memory = new FsMemoryProvider(profile.artifact_dir, session)
          send({ type: 'session_end', sessionId: session.id })
        } else {
          send({ type: 'error', message: `Session ${msg.sessionId} not found` })
        }
        return
      }
```

**d)** In `ws.on('close', ...)`, add `recordUsage` call right after `saveSession(session)`:
```ts
      saveSession(session)
      recordUsage(session.user, session.usage)
```

- [ ] **Step 3: Send `hello` from CLI (`src/cli/index.ts`)**

Add this helper at the top (after the `send` declaration):
```ts
import { userInfo } from 'os'
```

In the `ws.on('open', ...)` handler, add one line before `prompt()`:
```ts
ws.on('open', () => {
  send({ type: 'hello', user_id: process.env.HARNESS_USER ?? userInfo().username })
  console.log(`Connected to harness (ws://localhost:${PORT})`)
  console.log('Commands: /exit  /cancel  /resume <session-id>')
  prompt()
})
```

- [ ] **Step 4: Send `hello` from TUI (`src/tui/hooks/use-ws.ts`)**

Add this import at the top:
```ts
import { userInfo } from 'os'
```

In the `ws.on('open', ...)` handler inside `connect`:
```ts
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'hello',
        user_id: process.env.HARNESS_USER ?? userInfo().username,
      }))
      setConnected(true)
    })
```

- [ ] **Step 5: Run full suite**

```bash
npx vitest run 2>&1 | tail -5
```
Expected: all tests pass.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/server/index.ts src/cli/index.ts src/tui/hooks/use-ws.ts
git commit -m "feat: hello message wires user identity end-to-end; recordUsage at session close"
```

---

## Task 8: Push

- [ ] **Step 1: Final full suite run**

```bash
npx vitest run 2>&1 | tail -10
```
Expected: all tests pass, zero failures.

- [ ] **Step 2: Push**

```bash
git push
```
