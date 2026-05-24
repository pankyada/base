# Group A Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four dead-code and missing-feature gaps: wire DefaultImprover into the server, fix its skill output format, fire on_stop hooks per-session, and add a MemoryDelete tool.

**Architecture:** Each task is independent and self-contained. Tasks 1-2 (MemoryDelete) must complete before Task 3 (server wiring) since the server imports from memory. Task 4 (mineSkills format) only touches the improver. Task 3 wires everything together.

**Tech Stack:** TypeScript, Node.js `fs`, vitest

---

## File Map

| File | Change |
|------|--------|
| `src/memory/interface.ts` | Add `delete()` method to `MemoryProvider` |
| `src/memory/fs-memory.ts` | Implement `delete()` |
| `src/tools/builtin/memory-delete.ts` | New `MemoryDelete` tool |
| `src/tools/builtin/index.ts` | Register `MemoryDelete` |
| `src/profiles/schema.ts` | Add `MemoryDelete: allow` to `BuiltinToolsSchema` |
| `src/improver/default-improver.ts` | Fix `mineSkills` to write `<name>/SKILL.md` |
| `src/server/index.ts` | Wire `DefaultImprover`, `on_stop` hooks, session counter |
| `tests/memory.test.ts` | Add `delete()` tests |
| `tests/agent-loop.test.ts` | No change needed |

---

### Task 1: Add `delete()` to MemoryProvider interface and FsMemoryProvider

**Files:**
- Modify: `src/memory/interface.ts`
- Modify: `src/memory/fs-memory.ts`
- Modify: `tests/memory.test.ts`

- [ ] **Step 1: Add failing tests to `tests/memory.test.ts`**

Append these tests inside the existing `describe('FsMemoryProvider')` block:

```typescript
  it('deletes a session memory key', async () => {
    await provider.write('session', 'to-delete', 'value')
    await provider.delete('session', 'to-delete')
    expect(await provider.read('session', 'to-delete')).toBeNull()
  })

  it('deletes a profile memory file and rebuilds index', async () => {
    await provider.write('profile', 'removeme', '# content')
    await provider.delete('profile', 'removeme')
    expect(await provider.read('profile', 'removeme')).toBeNull()
    const entries = await provider.list('profile')
    expect(entries.map(e => e.key)).not.toContain('removeme')
  })

  it('delete on missing key does not throw', async () => {
    await expect(provider.delete('session', 'nonexistent')).resolves.toBeUndefined()
    await expect(provider.delete('profile', 'nonexistent')).resolves.toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && npx vitest run tests/memory.test.ts
```

Expected: FAIL — `provider.delete is not a function`

- [ ] **Step 3: Add `delete()` to `src/memory/interface.ts`**

```typescript
export interface MemoryEntry {
  key: string
  preview: string
}

export interface MemoryProvider {
  read(scope: 'session' | 'profile', key: string): Promise<string | null>
  write(scope: 'session' | 'profile', key: string, content: string): Promise<void>
  delete(scope: 'session' | 'profile', key: string): Promise<void>
  list(scope: 'session' | 'profile'): Promise<MemoryEntry[]>
  buildSystemPromptSection(): Promise<string>
}
```

- [ ] **Step 4: Implement `delete()` in `src/memory/fs-memory.ts`**

Add this method to `FsMemoryProvider` after `write()`:

```typescript
  async delete(scope: 'session' | 'profile', key: string): Promise<void> {
    if (scope === 'session') {
      delete this.session.session_memory[key]
      return
    }
    const path = join(this.memDir, `${key}.md`)
    if (existsSync(path)) {
      unlinkSync(path)
      await this.rebuildIndex()
    }
  }
```

Also add `unlinkSync` to the import at the top of the file:

```typescript
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'fs'
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && npx vitest run tests/memory.test.ts
```

Expected: all PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git add src/memory/interface.ts src/memory/fs-memory.ts tests/memory.test.ts
git commit -m "feat(memory): add delete() to MemoryProvider interface and FsMemoryProvider"
```

---

### Task 2: Add `MemoryDelete` built-in tool

**Files:**
- Create: `src/tools/builtin/memory-delete.ts`
- Modify: `src/tools/builtin/index.ts`
- Modify: `src/profiles/schema.ts`

- [ ] **Step 1: Create `src/tools/builtin/memory-delete.ts`**

```typescript
import { ToolDefinition, ToolContext } from '../types.js'

export const memoryDeleteTool: ToolDefinition = {
  name: 'MemoryDelete',
  description: 'Delete a memory entry by key. Profile scope removes the file from disk.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile'] },
      key: { type: 'string', description: 'Key to delete' },
    },
    required: ['scope', 'key'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope, key } = input as { scope: 'session' | 'profile'; key: string }
    const existing = await ctx.memory.read(scope, key)
    if (existing === null) return `No memory entry found for key: ${key} (scope: ${scope})`
    await ctx.memory.delete(scope, key)
    return `Memory deleted: ${scope}/${key}`
  },
}
```

- [ ] **Step 2: Register in `src/tools/builtin/index.ts`**

Add the import and register call:

```typescript
import { memoryDeleteTool } from './memory-delete.js'
```

Add to `registerAll()`:

```typescript
  registerTool(memoryDeleteTool)
```

- [ ] **Step 3: Add ACL default in `src/profiles/schema.ts`**

In `BuiltinToolsSchema`, add after `MemoryList`:

```typescript
  MemoryDelete: AclValue.default('allow'),
```

- [ ] **Step 4: Run typecheck and full test suite**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && pnpm typecheck && pnpm test
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git add src/tools/builtin/memory-delete.ts src/tools/builtin/index.ts src/profiles/schema.ts
git commit -m "feat(tools): add MemoryDelete built-in tool"
```

---

### Task 3: Fix `mineSkills` to write directory-based skill format

**Files:**
- Modify: `src/improver/default-improver.ts`

- [ ] **Step 1: Read the current `mineSkills` method in `src/improver/default-improver.ts`**

Find this block near the end:

```typescript
    for (const skill of skills) {
      if (skill.name && skill.content) {
        writeFileSync(join(proposedDir, `${skill.name}.md`), skill.content, 'utf-8')
      }
    }
```

- [ ] **Step 2: Replace the skill-writing block**

```typescript
    for (const skill of skills) {
      if (skill.name && skill.content) {
        const skillDir = join(proposedDir, skill.name)
        mkdirSync(skillDir, { recursive: true })
        writeFileSync(join(skillDir, 'SKILL.md'), skill.content, 'utf-8')
      }
    }
```

- [ ] **Step 3: Run typecheck and tests**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && pnpm typecheck && pnpm test
```

Expected: all PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git add src/improver/default-improver.ts
git commit -m "fix(improver): write proposed skills as SKILL.md directories not flat .md files"
```

---

### Task 4: Wire DefaultImprover + on_stop hooks into server

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Add imports to `src/server/index.ts`**

Add these imports (after existing imports):

```typescript
import { readFileSync as readFs, writeFileSync as writeFs, existsSync as existsFs, mkdirSync as mkdirFs } from 'fs'
import { DefaultImprover } from '../improver/default-improver.js'
import { runHooks } from '../hooks/runner.js'
```

- [ ] **Step 2: Add session counter helpers after imports**

Add these two functions before `main()`:

```typescript
function readSessionCount(artifactDir: string): number {
  const path = `${artifactDir}/session-count.json`
  try {
    if (existsFs(path)) return JSON.parse(readFs(path, 'utf-8')).count ?? 0
  } catch { /* corrupt file — reset */ }
  return 0
}

function writeSessionCount(artifactDir: string, count: number): void {
  mkdirFs(artifactDir, { recursive: true })
  writeFs(`${artifactDir}/session-count.json`, JSON.stringify({ count }), 'utf-8')
}
```

- [ ] **Step 3: Instantiate `DefaultImprover` inside `main()`**

Add this line after `const openai = createProviderClient(profile)`:

```typescript
  const improver = new DefaultImprover(profile, openai)
```

- [ ] **Step 4: Replace the `ws.on('close', ...)` handler**

Find:

```typescript
    ws.on('close', () => { saveSession(session) })
```

Replace with:

```typescript
    ws.on('close', () => {
      saveSession(session)

      // on_stop hooks
      runHooks('on_stop', profile, { SESSION_ID: session.id, PROFILE: profile.name })

      // self-improvement (fire-and-forget)
      const userTurns = (session.messages as any[]).filter(m => m.role === 'user').length
      if (userTurns >= 2 && profile.improvement?.enabled) {
        void improver.reflect(session, memory).catch(e =>
          console.error('[improver] reflect failed:', e.message)
        )

        const mineEvery = profile.improvement?.mine_skills_every_n_sessions ?? 10
        let count = readSessionCount(profile.artifact_dir) + 1
        if (count >= mineEvery) {
          count = 0
          void improver.mineSkills([session]).catch(e =>
            console.error('[improver] mineSkills failed:', e.message)
          )
        }
        writeSessionCount(profile.artifact_dir, count)
      }
    })
```

- [ ] **Step 5: Run typecheck and full test suite**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base && pnpm typecheck && pnpm test
```

Expected: all PASS

- [ ] **Step 6: Commit and push**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git add src/server/index.ts
git commit -m "feat(server): wire DefaultImprover, on_stop hooks, and session counter"
git push
```
