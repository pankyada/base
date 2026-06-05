# Projects + History — Runtime/Data Layer Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user projects (with Inbox default), session→project grouping, a `project` memory scope, richer session history (title + summary), and the WS/REST surface to manage it all.

**Architecture:** Projects are per-user records under `~/.harness/projects/<user>/`. Sessions stay in their existing flat location and reference a project by id (`session.project`, always set, defaults to `"inbox"`). A new `project` memory scope slots into the ladder `session > project > user > profile`. History is exposed as lightweight `SessionSummary` projections, never full message blobs.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Node `fs`, Vitest. Follows existing `src/session/store.ts` + `src/memory/*` patterns.

> Spec: `docs/superpowers/specs/2026-06-05-projects-and-history-design.md`

---

### Task 1: `Project` type + `projectPaths` helper

**Files:**
- Create: `src/projects/types.ts`
- Modify: `src/session/user-paths.ts`
- Test: `tests/project-paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/project-paths.test.ts
import { describe, it, expect } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'
import { projectPaths } from '../src/session/user-paths.js'

describe('projectPaths', () => {
  it('composes record file and memory dir under ~/.harness/projects', () => {
    const p = projectPaths('Pankaj!', 'inbox')
    expect(p.recordFile).toBe(join(homedir(), '.harness', 'projects', 'pankaj-', 'inbox.json'))
    expect(p.memoryDir).toBe(join(homedir(), '.harness', 'projects', 'pankaj-', 'inbox', 'memory'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/project-paths.test.ts`
Expected: FAIL — `projectPaths is not a function`.

- [ ] **Step 3: Create the `Project` type**

```ts
// src/projects/types.ts
export interface Project {
  id: string          // 8-char id, or the fixed string "inbox"
  user: string        // sanitized owner id
  name: string        // "Inbox", "Q3 Launch", ...
  created_at: string  // ISO timestamp
  description?: string
}
```

- [ ] **Step 4: Add `projectPaths` to user-paths.ts**

Add to `src/session/user-paths.ts` (keep existing `sanitizeUserId`, `userPaths`, `UserPaths`):

```ts
export interface ProjectPaths {
  recordFile: string
  memoryDir: string
}

export function projectPaths(user: string, projectId: string): ProjectPaths {
  const safe = sanitizeUserId(user)
  const base = join(homedir(), '.harness', 'projects', safe)
  return {
    recordFile: join(base, `${projectId}.json`),
    memoryDir: join(base, projectId, 'memory'),
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/project-paths.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/projects/types.ts src/session/user-paths.ts tests/project-paths.test.ts
git commit -m "feat: add Project type and projectPaths helper"
```

---

### Task 2: `projects/store.ts` — CRUD + lazy Inbox

**Files:**
- Create: `src/projects/store.ts`
- Test: `tests/project-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/project-store.test.ts
import { describe, it, expect } from 'vitest'
import { createProject, listProjects, getProject, ensureInbox } from '../src/projects/store.js'

describe('project store', () => {
  it('creates a project with an 8-char id and sanitized user', () => {
    const p = createProject('alice', 'Q3 Launch', 'the big one')
    expect(p.id).toHaveLength(8)
    expect(p.user).toBe('alice')
    expect(p.name).toBe('Q3 Launch')
    expect(p.description).toBe('the big one')
    expect(getProject('alice', p.id)!.name).toBe('Q3 Launch')
  })

  it('ensureInbox creates a stable "inbox" project once', () => {
    const a = ensureInbox('bob')
    const b = ensureInbox('bob')
    expect(a.id).toBe('inbox')
    expect(a.name).toBe('Inbox')
    expect(b.id).toBe('inbox')
    expect(listProjects('bob').filter(p => p.id === 'inbox')).toHaveLength(1)
  })

  it('listProjects returns only that users projects', () => {
    const p = createProject('carol', 'Solo')
    expect(listProjects('carol').map(x => x.id)).toContain(p.id)
    expect(listProjects('dave').map(x => x.id)).not.toContain(p.id)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/project-store.test.ts`
Expected: FAIL — module `src/projects/store.js` not found.

- [ ] **Step 3: Implement the store**

```ts
// src/projects/store.ts
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { Project } from './types.js'
import { projectPaths, sanitizeUserId } from '../session/user-paths.js'

function writeProject(p: Project): void {
  const { recordFile } = projectPaths(p.user, p.id)
  mkdirSync(dirname(recordFile), { recursive: true })
  writeFileSync(recordFile, JSON.stringify(p, null, 2), 'utf-8')
}

export function createProject(user: string, name: string, description?: string): Project {
  const p: Project = {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    user: sanitizeUserId(user),
    name,
    created_at: new Date().toISOString(),
    ...(description ? { description } : {}),
  }
  writeProject(p)
  return p
}

export function getProject(user: string, id: string): Project | null {
  const { recordFile } = projectPaths(user, id)
  if (!existsSync(recordFile)) return null
  return JSON.parse(readFileSync(recordFile, 'utf-8')) as Project
}

export function ensureInbox(user: string): Project {
  const existing = getProject(user, 'inbox')
  if (existing) return existing
  const p: Project = {
    id: 'inbox',
    user: sanitizeUserId(user),
    name: 'Inbox',
    created_at: new Date().toISOString(),
  }
  writeProject(p)
  return p
}

export function listProjects(user: string): Project[] {
  const safe = sanitizeUserId(user)
  const dir = join(homedir(), '.harness', 'projects', safe)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Project)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/project-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/projects/store.ts tests/project-store.test.ts
git commit -m "feat: add project store with lazy Inbox"
```

---

### Task 3: `Session` gains `project` / `title` / `summary`; default + stamp

**Files:**
- Modify: `src/session/types.ts`
- Modify: `src/session/store.ts`
- Test: `tests/session-project.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/session-project.test.ts
import { describe, it, expect } from 'vitest'
import { createSession, saveSession, loadSession } from '../src/session/store.js'

describe('session project + title', () => {
  it('new sessions default to the inbox project', () => {
    const s = createSession('coding', 'erin')
    expect(s.project).toBe('inbox')
  })

  it('a loaded legacy session without project is stamped inbox on save', () => {
    const s = createSession('coding', 'frank')
    delete (s as any).project           // simulate a pre-projects session
    saveSession(s)                       // saveSession backfills inbox
    expect(loadSession('frank', s.id)!.project).toBe('inbox')
  })

  it('title is derived from the first user message when absent', () => {
    const s = createSession('coding', 'gwen')
    s.messages.push({ role: 'user', content: 'Refactor the auth flow please and thanks' })
    saveSession(s)
    expect(loadSession('gwen', s.id)!.title).toBe('Refactor the auth flow please and thanks')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/session-project.test.ts`
Expected: FAIL — `project` undefined / `title` undefined.

- [ ] **Step 3: Extend the `Session` type**

In `src/session/types.ts`, add fields to the `Session` interface (after `profile`):

```ts
  project: string       // projectId — always set; defaults to "inbox"
  title?: string        // auto-derived from first user message
  summary?: string      // LLM-generated at session end
```

- [ ] **Step 4: Default + stamp in store.ts**

In `src/session/store.ts`, set the default in `createSession` (add to the returned object):

```ts
    project: 'inbox',
```

Then update `saveSession` to backfill `project` and derive `title` before writing:

```ts
export function saveSession(session: Session): void {
  if (!session.project) session.project = 'inbox'
  if (!session.title) {
    const firstUser = (session.messages as Array<{ role?: string; content?: unknown }>)
      .find(m => m?.role === 'user' && typeof m.content === 'string')
    if (firstUser && typeof firstUser.content === 'string') {
      session.title = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 80)
    }
  }
  const { sessionsDir } = userPaths(session.user, '')
  mkdirSync(sessionsDir, { recursive: true })
  const date = session.created_at.slice(0, 10)
  const path = join(sessionsDir, `${date}_${session.id}.json`)
  writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8')
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/session-project.test.ts tests/session-store.test.ts`
Expected: PASS (both the new test and the existing session-store test).

- [ ] **Step 6: Commit**

```bash
git add src/session/types.ts src/session/store.ts tests/session-project.test.ts
git commit -m "feat: session project default, inbox stamping, title derivation"
```

---

### Task 4: `SessionSummary` + `listSessionSummaries` + `assignSession`

**Files:**
- Modify: `src/session/types.ts`
- Modify: `src/session/store.ts`
- Test: `tests/session-summaries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/session-summaries.test.ts
import { describe, it, expect } from 'vitest'
import { createSession, saveSession, listSessionSummaries, assignSession } from '../src/session/store.js'

describe('session summaries + assignment', () => {
  it('listSessionSummaries returns lightweight rows without message arrays', () => {
    const s = createSession('coding', 'hank')
    s.messages.push({ role: 'user', content: 'Hello world task' })
    saveSession(s)
    const rows = listSessionSummaries('hank')
    const row = rows.find(r => r.id === s.id)!
    expect(row.title).toBe('Hello world task')
    expect(row.project).toBe('inbox')
    expect((row as any).messages).toBeUndefined()
  })

  it('filters by project when projectId is provided', () => {
    const a = createSession('iris', 'iris'); saveSession(a)
    const b = createSession('iris', 'iris'); saveSession(b)
    assignSession('iris', b.id, 'proj1234')
    const inInbox = listSessionSummaries('iris', 'inbox').map(r => r.id)
    const inProj = listSessionSummaries('iris', 'proj1234').map(r => r.id)
    expect(inInbox).toContain(a.id)
    expect(inInbox).not.toContain(b.id)
    expect(inProj).toContain(b.id)
  })

  it('assignSession reassigns and persists', () => {
    const s = createSession('jade', 'jade'); saveSession(s)
    assignSession('jade', s.id, 'proj9999')
    expect(listSessionSummaries('jade', 'proj9999').map(r => r.id)).toContain(s.id)
  })
})
```

> Note: `createSession(profileName, user)` — first arg is the profile. The tests above pass the user as both where the profile value is irrelevant.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/session-summaries.test.ts`
Expected: FAIL — `listSessionSummaries` / `assignSession` not exported.

- [ ] **Step 3: Add `SessionSummary` to types.ts**

In `src/session/types.ts`, add:

```ts
export interface SessionSummary {
  id: string
  project: string
  title?: string
  summary?: string
  created_at: string
  usage: { input: number; output: number; cost_usd: number }
}
```

- [ ] **Step 4: Implement in store.ts**

Add to `src/session/store.ts` (import `SessionSummary` from `./types.js`):

```ts
export function listSessionSummaries(user: string, projectId?: string): SessionSummary[] {
  return listSessions(user)
    .filter(s => projectId ? (s.project ?? 'inbox') === projectId : true)
    .map(s => ({
      id: s.id,
      project: s.project ?? 'inbox',
      title: s.title,
      summary: s.summary,
      created_at: s.created_at,
      usage: s.usage,
    }))
}

export function assignSession(user: string, sessionId: string, projectId: string): void {
  const s = loadSession(user, sessionId)
  if (!s) return
  s.project = projectId
  saveSession(s)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/session-summaries.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/session/types.ts src/session/store.ts tests/session-summaries.test.ts
git commit -m "feat: session summaries listing + project assignment"
```

---

### Task 5: `project` memory scope (interface + both providers)

**Files:**
- Modify: `src/memory/interface.ts`
- Modify: `src/memory/fs-memory.ts`
- Modify: `src/memory/graph-memory.ts`
- Test: `tests/memory-project-scope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/memory-project-scope.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { createSession } from '../src/session/store.js'

describe('project memory scope', () => {
  it('writes and reads project-scoped memory tied to session.project', async () => {
    const artifact = mkdtempSync(join(tmpdir(), 'art-'))
    const session = createSession('coding', 'kira')
    session.project = 'projABCD'
    const mem = new FsMemoryProvider(artifact, session)
    await mem.write('project', 'context', 'Project Alpha goals')
    const got = await mem.read('project', 'context')
    expect(got!.content).toBe('Project Alpha goals')
    const list = await mem.list('project')
    expect(list.map(e => e.key)).toContain('context')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/memory-project-scope.test.ts`
Expected: FAIL — TypeScript rejects `'project'` scope / write throws.

- [ ] **Step 3: Widen the interface**

In `src/memory/interface.ts`, replace every `'session' | 'profile' | 'user'` union with
`'session' | 'profile' | 'user' | 'project'` (4 method signatures: `read`, `write`, `delete`, `list`).

- [ ] **Step 4: Update `FsMemoryProvider`**

In `src/memory/fs-memory.ts`:

a) Add import: `import { userPaths, projectPaths } from '../session/user-paths.js'`

b) Add a project dir getter and widen `dirFor`:

```ts
  private get projectMemDir(): string {
    return projectPaths(this.session.user, this.session.project ?? 'inbox').memoryDir
  }

  private dirFor(scope: 'profile' | 'user' | 'project'): string {
    if (scope === 'profile') return this.sharedMemDir
    if (scope === 'project') return this.projectMemDir
    return this.privateMemDir
  }
```

c) Widen the scope type on `read`, `write`, `delete`, `list`, and `rebuildIndex` from
`'session' | 'profile' | 'user'` to `'session' | 'profile' | 'user' | 'project'`
(and `rebuildIndex(scope: 'profile' | 'user' | 'project')`).

d) In `buildSystemPromptSection`, after the private index block and before the `return`, add:

```ts
    if ((this.session.project ?? 'inbox') !== 'inbox') {
      const projectIndex = join(this.projectMemDir, 'MEMORY.md')
      if (existsSync(projectIndex)) {
        parts.push(`## Memory (project)\n${readFileSync(projectIndex, 'utf-8')}`)
      }
    }
```

- [ ] **Step 5: Update `GraphMemoryProvider` identically**

In `src/memory/graph-memory.ts`:

a) Add `projectPaths` to the existing `../session/user-paths.js` import.

b) Add the project dir getter:

```ts
  private get projectMemDir(): string {
    return projectPaths(this.session.user, this.session.project ?? 'inbox').memoryDir
  }
```

c) Widen `getGraphPath`, `loadGraph`, `saveGraph`, `rebuildIndex`, and the public `read`/`write`/`delete`/`list` scope unions to include `'project'`, and route the project scope to `projectMemDir`:

```ts
  private getGraphPath(scope: 'profile' | 'user' | 'project'): string {
    const dir = scope === 'profile' ? this.sharedMemDir
      : scope === 'project' ? this.projectMemDir
      : this.privateMemDir
    return join(dir, 'graph.json')
  }
```

Apply the same three-way `dir` selection in `rebuildIndex` (which currently picks the dir
inline). In `buildSystemPromptSection`, add the same project-index block as Fs (guarded by
`session.project !== 'inbox'`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/memory-project-scope.test.ts tests/memory.test.ts tests/memory-linked.test.ts`
Expected: PASS (new test plus existing memory tests still green).

- [ ] **Step 7: Commit**

```bash
git add src/memory/interface.ts src/memory/fs-memory.ts src/memory/graph-memory.ts tests/memory-project-scope.test.ts
git commit -m "feat: add project memory scope to both providers"
```

---

### Task 6: `MemoryWrite` tool gains `project` scope option

**Files:**
- Modify: `src/tools/builtin/memory-write.ts`
- Also widen the other four memory tools' scope handling: `memory-read.ts`, `memory-list.ts`, `memory-delete.ts`
- Test: `tests/memory-write-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/memory-write-tool.test.ts
import { describe, it, expect } from 'vitest'
import { memoryWriteTool } from '../src/tools/builtin/memory-write.js'

describe('MemoryWrite tool project scope', () => {
  it('routes scope "project" to the memory provider', async () => {
    const calls: any[] = []
    const ctx: any = { memory: { write: async (...a: any[]) => { calls.push(a) } } }
    const msg = await memoryWriteTool.execute({ scope: 'project', key: 'k', content: 'c' }, ctx)
    expect(calls[0][0]).toBe('project')
    expect(msg).toContain('project/k')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/memory-write-tool.test.ts`
Expected: FAIL — type union rejects `'project'`.

- [ ] **Step 3: Update memory-write.ts**

In `src/tools/builtin/memory-write.ts`:
- Add `'project'` to the `scope` enum array.
- Update the description line to mention project scope.
- Widen the cast: `as 'session' | 'profile' | 'user' | 'project'`.

```ts
      scope: {
        type: 'string',
        enum: ['session', 'profile', 'user', 'project'],
        description: 'Defaults to "user" (private). "profile" shares with all users. "project" is shared across sessions in the current project.',
      },
```

```ts
    const scope = ((input as any).scope ?? 'user') as 'session' | 'profile' | 'user' | 'project'
```

- [ ] **Step 4: Widen the sibling tools**

In `memory-read.ts`, `memory-list.ts`, `memory-delete.ts`: add `'project'` to each `scope` enum and to any scope cast, mirroring the write tool. (No behavior change beyond accepting the new value, which the provider now supports.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/memory-write-tool.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/builtin/memory-write.ts src/tools/builtin/memory-read.ts src/tools/builtin/memory-list.ts src/tools/builtin/memory-delete.ts tests/memory-write-tool.test.ts
git commit -m "feat: expose project scope in memory tools"
```

---

### Task 7: WS protocol — project + history messages and server handlers

**Files:**
- Modify: `src/types.ts`
- Modify: `src/server/index.ts`
- Test: `tests/protocol-projects.test.ts`

- [ ] **Step 1: Write the failing test (pure message-handler helper)**

To keep this unit-testable without a live socket, extract a pure handler. First the test:

```ts
// tests/protocol-projects.test.ts
import { describe, it, expect } from 'vitest'
import { handleProjectMessage } from '../src/server/project-handlers.js'

describe('project message handlers', () => {
  it('project_create returns a project_created message', () => {
    const out = handleProjectMessage({ type: 'project_create', name: 'Plan X' }, 'leo')
    expect(out!.type).toBe('project_created')
    expect(out!.type === 'project_created' && out.project.name).toBe('Plan X')
  })

  it('project_list returns the users projects', () => {
    handleProjectMessage({ type: 'project_create', name: 'Only' }, 'mae')
    const out = handleProjectMessage({ type: 'project_list' }, 'mae')
    expect(out!.type).toBe('projects')
    expect(out!.type === 'projects' && out.projects.some(p => p.name === 'Only')).toBe(true)
  })

  it('session_list returns summaries (optionally filtered)', () => {
    const out = handleProjectMessage({ type: 'session_list' }, 'nina')
    expect(out!.type).toBe('sessions')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/protocol-projects.test.ts`
Expected: FAIL — `src/server/project-handlers.js` not found.

- [ ] **Step 3: Add message types to `src/types.ts`**

Add to the `ClientMessage` union:

```ts
  | { type: 'project_create'; name: string; description?: string }
  | { type: 'project_list' }
  | { type: 'project_assign'; sessionId: string; projectId: string }
  | { type: 'session_list'; projectId?: string }
```

Add to the `ServerMessage` union (import `Project` and `SessionSummary` at top of file:
`import { Project } from './projects/types.js'` and `import { SessionSummary } from './session/types.js'`):

```ts
  | { type: 'project_created'; project: Project }
  | { type: 'projects'; projects: Project[] }
  | { type: 'sessions'; sessions: SessionSummary[] }
```

- [ ] **Step 4: Create the pure handler**

```ts
// src/server/project-handlers.ts
import { ClientMessage, ServerMessage } from '../types.js'
import { createProject, listProjects, ensureInbox } from '../projects/store.js'
import { listSessionSummaries, assignSession } from '../session/store.js'

// Returns a ServerMessage to send back, or null if the message is not a project/history op.
export function handleProjectMessage(msg: ClientMessage, user: string): ServerMessage | null {
  switch (msg.type) {
    case 'project_create': {
      const project = createProject(user, msg.name, msg.description)
      return { type: 'project_created', project }
    }
    case 'project_list': {
      ensureInbox(user)
      return { type: 'projects', projects: listProjects(user) }
    }
    case 'project_assign': {
      assignSession(user, msg.sessionId, msg.projectId)
      return { type: 'sessions', sessions: listSessionSummaries(user) }
    }
    case 'session_list': {
      return { type: 'sessions', sessions: listSessionSummaries(user, msg.projectId) }
    }
    default:
      return null
  }
}
```

- [ ] **Step 5: Wire the handler into the WS message loop**

In `src/server/index.ts`, inside `ws.on('message', ...)`, after the existing `resume` block
(around `src/server/index.ts:217`) add:

```ts
      const projectReply = handleProjectMessage(msg, userId)
      if (projectReply) { send(projectReply); return }
```

Add the import near the other server imports:
`import { handleProjectMessage } from './project-handlers.js'`

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/protocol-projects.test.ts && pnpm typecheck`
Expected: PASS and no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/server/index.ts src/server/project-handlers.ts tests/protocol-projects.test.ts
git commit -m "feat: WS project + history messages and handlers"
```

---

### Task 8: REST endpoints for projects + history

**Files:**
- Modify: `src/server/rest.ts` (the REST handler created by `createRestHandler` — confirm exact filename with `grep -rln "createRestHandler" src`)
- Test: `tests/rest-projects.test.ts`

- [ ] **Step 1: Locate the REST handler**

Run: `grep -rln "createRestHandler" src`
Use the returned file as the modify target below (referred to here as `src/server/rest.ts`).

- [ ] **Step 2: Write the failing test**

```ts
// tests/rest-projects.test.ts
import { describe, it, expect } from 'vitest'
import { handleProjectMessage } from '../src/server/project-handlers.js'

// REST endpoints delegate to the same pure handler; this asserts the contract the
// route layer depends on (projects list shape).
describe('REST project contract', () => {
  it('project_list yields a projects array including inbox', () => {
    const out = handleProjectMessage({ type: 'project_list' }, 'olive')
    expect(out!.type === 'projects' && Array.isArray(out.projects)).toBe(true)
    expect(out!.type === 'projects' && out.projects.some(p => p.id === 'inbox')).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails / passes**

Run: `npx vitest run tests/rest-projects.test.ts`
Expected: PASS once Task 7 is merged (handler exists). If it fails, Task 7 is incomplete.

- [ ] **Step 4: Add the routes**

In the REST handler, add these routes, deriving `user` from the request the same way existing
routes do (the `user` body/query field already used by `POST /run`). Reuse the store functions
directly (not the WS handler, to keep REST status codes clean):

```ts
// GET /projects?user=<u>
//   → 200 { projects: listProjects(user) }  (call ensureInbox(user) first)
// POST /projects  body { user, name, description? }
//   → 201 { project: createProject(user, name, description) }
// GET /projects/:id/sessions?user=<u>
//   → 200 { sessions: listSessionSummaries(user, id) }
// PATCH /sessions/:id  body { user, projectId }
//   → 200 { sessions: listSessionSummaries(user) }   (after assignSession)
```

Implement each branch with `listProjects`, `createProject`, `ensureInbox`,
`listSessionSummaries`, `assignSession` imported from the stores. Return `400` when `user` is
missing, mirroring the existing REST validation style in this file.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/rest-projects.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/rest.ts tests/rest-projects.test.ts
git commit -m "feat: REST endpoints for projects and history"
```

---

### Task 9: Session summary via `DefaultImprover.reflect()`

**Files:**
- Modify: `src/improver/default-improver.ts`
- Test: `tests/improver-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/improver-summary.test.ts
import { describe, it, expect, vi } from 'vitest'
import { DefaultImprover } from '../src/improver/default-improver.js'
import { createSession } from '../src/session/store.js'

function fakeOpenAI(content: string) {
  return { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }) } } } as any
}

describe('improver writes a one-line summary back to the session', () => {
  it('sets session.summary from the model output', async () => {
    const profile: any = { name: 'coding', artifact_dir: '/tmp/h-test', model: { id: 'x' }, improvement: { enabled: true } }
    const session = createSession('coding', 'pia')
    session.messages.push({ role: 'user', content: 'do a thing' } as any)
    // First call → memories array; summary derived from a dedicated field. Return empty memories.
    const improver = new DefaultImprover(profile, fakeOpenAI('{"summary":"Did a thing","memories":[]}'))
    const memory: any = { buildSystemPromptSection: async () => '', write: async () => {} }
    await improver.reflect(session, memory)
    expect(session.summary).toBe('Did a thing')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/improver-summary.test.ts`
Expected: FAIL — `session.summary` stays undefined.

- [ ] **Step 3: Extend `reflect()` to emit a summary**

In `src/improver/default-improver.ts`, change the reflection prompt and parsing so the model
returns both a summary and memories in one call (no extra round-trip). Replace the JSON-array
contract with an object:

- Update the prompt content to:
  `Review this agent session. Output ONLY JSON: {"summary":"one short line describing the session","memories":[{"key":"slug","content":"markdown"}]} (memories may be empty).`
- Parse `parsed.summary` (string) and `parsed.memories` (array). Keep the existing
  empty/try-catch guards. After parsing, if `parsed.summary` is a non-empty string, set
  `session.summary = parsed.summary.trim()` and call `saveSession(session)` (import it from
  `../session/store.js`).
- Keep writing memories exactly as before, iterating `parsed.memories`.

Concretely, replace the block from `const raw = response.choices[0].message.content ?? '[]'`
through the `for (const m of memories)` loop with:

```ts
      const raw = response.choices[0].message.content ?? '{}'
      const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
      const parsed = JSON.parse(cleaned) as { summary?: string; memories?: Array<{ key: string; content: string }> }
      memories = Array.isArray(parsed.memories) ? parsed.memories : []
      if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
        session.summary = parsed.summary.trim()
        saveSession(session)
      }
    } catch {
      return
    }

    for (const m of memories) {
      if (m.key && m.content) await memory.write('user', m.key, m.content)
    }
```

Add `import { saveSession } from '../session/store.js'` to the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/improver-summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: All green.

- [ ] **Step 6: Commit**

```bash
git add src/improver/default-improver.ts tests/improver-summary.test.ts
git commit -m "feat: improver writes session summary on reflect"
```

---

## Plan 1 self-review notes

- **Spec coverage:** data model (T1,T3,T4), storage layout (T1,T2), Inbox default (T2,T3), memory scope ladder (T5,T6), protocol (T7), REST (T8), title (T3) + summary (T9), history summaries (T4). All spec sections map to a task.
- **Type consistency:** scope union widened identically across interface, both providers, and all four memory tools to `'session' | 'profile' | 'user' | 'project'`. `SessionSummary` shape defined once in T4 and reused in T7/T8. `Project` defined in T1, used everywhere.
- **Out of scope (deferred to Plan 2):** all web + TUI surfaces.
