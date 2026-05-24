# Minimal Agent Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript agent harness with profile-based tool/skill/MCP sandboxing, a memory layer, skill mining, and usage telemetry, exposed via a WebSocket server and thin CLI client.

**Architecture:** Profile YAML files declare model, tools (ACL), MCP servers, skill dirs, and artifact dirs. An agent loop runs against OpenAI-compatible endpoints, dispatches to in-process builtin tools or out-of-process MCP clients, and emits events consumed by a WS server. A file-based memory + improver layer learns from sessions.

**Tech Stack:** TypeScript 5 + Node 20, `openai` SDK (OpenAI-compatible), `ws`, `zod`, `js-yaml`, `gray-matter`, `fast-glob`, `untildify`, `@modelcontextprotocol/sdk`, vitest, tsx, pnpm

---

## File Map

```
src/
  types.ts                       # AclValue, TelemetryEvent, WS protocol types
  tools/
    types.ts                     # ToolDefinition, ToolContext
    registry.ts                  # register, resolve, toOpenAITools
    acl.ts                       # getAcl, getMcpAcl
    builtin/
      index.ts                   # registerAll()
      read.ts
      write.ts
      edit.ts
      bash.ts
      grep.ts
      glob.ts
      skill.ts
      memory-read.ts
      memory-write.ts
      memory-list.ts
      stats.ts
      delegate.ts
  profiles/
    schema.ts                    # zod schema + Profile type
    loader.ts                    # loadProfile (yaml → validated + expanded)
  session/
    types.ts                     # Session, SessionToolCall
    store.ts                     # createSession, saveSession, loadSession
  telemetry/
    logger.ts                    # logEvent → ~/.harness/telemetry.jsonl
    query.ts                     # queryEvents, summarize
  provider/
    client.ts                    # createProviderClient → OpenAI instance
  mcp/
    client.ts                    # initMcpClients, closeMcpClients, getMcpToolDefinitions
  memory/
    interface.ts                 # MemoryProvider interface, MemoryEntry
    fs-memory.ts                 # FsMemoryProvider (default fs impl)
  skills/
    loader.ts                    # Skill type, loadSkillsFromDir, loadAllSkills
    indexer.ts                   # buildSkillIndex
  hooks/
    runner.ts                    # runHooks (pre_tool | post_tool | on_stop)
  improver/
    interface.ts                 # Improver interface, ProposedSkill
    default-improver.ts          # DefaultImprover: reflect + mineSkills
  loop/
    agent-loop.ts                # runAgentLoop + AgentLoopEvents
  server/
    index.ts                     # WS server entry
  cli/
    index.ts                     # thin WS client + readline REPL

profiles/
  coding.yaml
  data.yaml
prompts/
  coding.md
  data.md
tests/
  profile-loader.test.ts
  acl.test.ts
  registry.test.ts
  session-store.test.ts
  telemetry.test.ts
  memory.test.ts
  skills.test.ts
  agent-loop.test.ts
```

---

## Task 1: Project Bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Init pnpm project and install deps**

```bash
cd /Users/pankajkumaryadav/Desktop/development/base
git init
pnpm init
pnpm add openai ws zod js-yaml gray-matter fast-glob untildify @modelcontextprotocol/sdk
pnpm add -D typescript tsx vitest @types/ws @types/js-yaml @types/node
```

- [ ] **Step 2: Write package.json scripts**

```json
{
  "name": "harness",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/server/index.ts",
    "cli": "tsx src/cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*", "tests/**/*", "vitest.config.ts"]
}
```

- [ ] **Step 4: Write vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'node' },
})
```

- [ ] **Step 5: Write .gitignore**

```
node_modules/
dist/
.env
```

- [ ] **Step 6: Create src dirs**

```bash
mkdir -p src/tools/builtin src/profiles src/session src/telemetry src/provider src/mcp src/memory src/skills src/hooks src/improver src/loop src/server src/cli profiles prompts tests
```

- [ ] **Step 7: Verify setup**

```bash
pnpm typecheck 2>&1 | head -5
```

Expected: no errors (empty src is fine at this point)

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "chore: bootstrap project"
```

---

## Task 2: Core Types

**Files:**
- Create: `src/types.ts`
- Create: `src/tools/types.ts`
- Create: `src/session/types.ts`
- Create: `src/memory/interface.ts`
- Create: `src/improver/interface.ts`

- [ ] **Step 1: Write src/types.ts**

```ts
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
  | { type: 'error'; message: string }
```

- [ ] **Step 2: Write src/session/types.ts**

```ts
export interface SessionToolCall {
  name: string
  input: Record<string, unknown>
  result: string
  ok: boolean
  ts: string
}

export interface Session {
  id: string
  profile: string
  created_at: string
  messages: unknown[]
  tool_calls: SessionToolCall[]
  usage: { input: number; output: number; cost_usd: number }
  session_memory: Record<string, string>
}
```

- [ ] **Step 3: Write src/memory/interface.ts**

```ts
export interface MemoryEntry {
  key: string
  preview: string
}

export interface MemoryProvider {
  read(scope: 'session' | 'profile', key: string): Promise<string | null>
  write(scope: 'session' | 'profile', key: string, content: string): Promise<void>
  list(scope: 'session' | 'profile'): Promise<MemoryEntry[]>
  buildSystemPromptSection(): Promise<string>
}
```

- [ ] **Step 4: Write src/improver/interface.ts**

```ts
import type { Session } from '../session/types.js'
import type { MemoryProvider } from '../memory/interface.js'

export interface ProposedSkill {
  name: string
  description: string
  content: string
}

export interface Improver {
  reflect(session: Session, memory: MemoryProvider): Promise<void>
  mineSkills(sessions: Session[]): Promise<ProposedSkill[]>
}
```

- [ ] **Step 5: Write src/tools/types.ts**

```ts
import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import type { MemoryProvider } from '../memory/interface.js'

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
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(input: Record<string, unknown>, context: ToolContext): Promise<string>
}
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: may error on missing profile schema import — that's OK at this point (profile/schema.ts doesn't exist yet). Fix by temporarily commenting out the Profile import in tools/types.ts and restore in Task 3.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/session/types.ts src/memory/interface.ts src/improver/interface.ts src/tools/types.ts
git commit -m "feat: add core types"
```

---

## Task 3: Profile Schema + Loader

**Files:**
- Create: `src/profiles/schema.ts`
- Create: `src/profiles/loader.ts`
- Create: `tests/profile-loader.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/profile-loader.test.ts
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadProfile } from '../src/profiles/loader.js'

describe('loadProfile', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'harness-'))

  it('parses valid profile yaml', () => {
    const yaml = `
name: test
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
system_prompt: ${tmp}/prompt.md
working_dir: ${tmp}
artifact_dir: ${tmp}/artifacts
skills_dirs: []
`
    writeFileSync(join(tmp, 'profile.yaml'), yaml)
    writeFileSync(join(tmp, 'prompt.md'), '# prompt')
    const profile = loadProfile(join(tmp, 'profile.yaml'))
    expect(profile.name).toBe('test')
    expect(profile.model.id).toBe('gpt-4o')
    expect(profile.tools.builtin.Read).toBe('allow')
  })

  it('throws on missing required fields', () => {
    writeFileSync(join(tmp, 'bad.yaml'), 'name: bad')
    expect(() => loadProfile(join(tmp, 'bad.yaml'))).toThrow()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm test tests/profile-loader.test.ts
```

Expected: FAIL — `loader.js` not found

- [ ] **Step 3: Write src/profiles/schema.ts**

```ts
import { z } from 'zod'

const AclValue = z.enum(['allow', 'prompt', 'deny'])

const BuiltinToolsSchema = z.object({
  Read: AclValue.default('allow'),
  Write: AclValue.default('allow'),
  Edit: AclValue.default('allow'),
  Bash: AclValue.default('prompt'),
  Grep: AclValue.default('allow'),
  Glob: AclValue.default('allow'),
  Skill: AclValue.default('allow'),
  MemoryRead: AclValue.default('allow'),
  MemoryWrite: AclValue.default('allow'),
  MemoryList: AclValue.default('allow'),
  Stats: AclValue.default('allow'),
  Delegate: AclValue.default('prompt'),
}).passthrough()

const McpServerSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  acl: z.record(AclValue).default({ '*': 'prompt' }),
})

export const ProfileSchema = z.object({
  name: z.string(),
  model: z.object({
    base_url: z.string().url(),
    api_key_env: z.string(),
    id: z.string(),
    fallback_id: z.string().optional(),
  }),
  system_prompt: z.string(),
  working_dir: z.string().default('$CWD'),
  artifact_dir: z.string(),
  skills_dirs: z.array(z.string()).default([]),
  tools: z.object({
    builtin: BuiltinToolsSchema.default({}),
    mcp_servers: z.array(McpServerSchema).default([]),
  }).default({}),
  hooks: z.object({
    pre_tool: z.array(z.string()).default([]),
    post_tool: z.array(z.string()).default([]),
    on_stop: z.array(z.string()).default([]),
  }).default({}),
  improvement: z.object({
    enabled: z.boolean().default(true),
    model_id: z.string().optional(),
    mine_skills_every_n_sessions: z.number().default(10),
  }).default({}),
})

export type Profile = z.infer<typeof ProfileSchema>
```

- [ ] **Step 4: Write src/profiles/loader.ts**

```ts
import yaml from 'js-yaml'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { ProfileSchema, Profile } from './schema.js'

function untildify(p: string): string {
  return p.startsWith('~') ? p.replace('~', homedir()) : p
}

function expandPath(p: string, cwd: string): string {
  if (p === '$CWD') return cwd
  return resolve(untildify(p))
}

export function loadProfile(profilePath: string): Profile {
  const raw = readFileSync(profilePath, 'utf-8')
  const parsed = yaml.load(raw)
  const validated = ProfileSchema.parse(parsed)
  const cwd = process.cwd()
  return {
    ...validated,
    working_dir: expandPath(validated.working_dir, cwd),
    artifact_dir: expandPath(validated.artifact_dir, cwd),
    system_prompt: expandPath(validated.system_prompt, cwd),
    skills_dirs: validated.skills_dirs.map(d => expandPath(d, cwd)),
  }
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
pnpm test tests/profile-loader.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/profiles/ tests/profile-loader.test.ts
git commit -m "feat: profile schema + loader"
```

---

## Task 4: Session Store

**Files:**
- Create: `src/session/store.ts`
- Create: `tests/session-store.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/session-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createSession, saveSession, loadSession } from '../src/session/store.js'

describe('session store', () => {
  it('creates session with id and profile', () => {
    const s = createSession('coding')
    expect(s.id).toHaveLength(8)
    expect(s.profile).toBe('coding')
    expect(s.messages).toEqual([])
    expect(s.usage.cost_usd).toBe(0)
  })

  it('saves and loads session by id', () => {
    const s = createSession('coding')
    s.session_memory['foo'] = 'bar'
    saveSession(s)
    const loaded = loadSession(s.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.session_memory['foo']).toBe('bar')
  })

  it('returns null for unknown id', () => {
    expect(loadSession('unknown0')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm test tests/session-store.test.ts
```

Expected: FAIL — `store.js` not found

- [ ] **Step 3: Write src/session/store.ts**

```ts
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { Session } from './types.js'

const SESSIONS_DIR = join(homedir(), '.harness', 'sessions')

export function createSession(profileName: string): Session {
  return {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    profile: profileName,
    created_at: new Date().toISOString(),
    messages: [],
    tool_calls: [],
    usage: { input: 0, output: 0, cost_usd: 0 },
    session_memory: {},
  }
}

export function saveSession(session: Session): void {
  mkdirSync(SESSIONS_DIR, { recursive: true })
  const date = session.created_at.slice(0, 10)
  const path = join(SESSIONS_DIR, `${date}_${session.id}.json`)
  writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8')
}

export function loadSession(id: string): Session | null {
  mkdirSync(SESSIONS_DIR, { recursive: true })
  const files = readdirSync(SESSIONS_DIR)
  const match = files.find(f => f.includes(id))
  if (!match) return null
  return JSON.parse(readFileSync(join(SESSIONS_DIR, match), 'utf-8')) as Session
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm test tests/session-store.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/store.ts tests/session-store.test.ts
git commit -m "feat: session store (create/save/load)"
```

---

## Task 5: Telemetry Logger

**Files:**
- Create: `src/telemetry/logger.ts`
- Create: `tests/telemetry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/telemetry.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { logEvent } from '../src/telemetry/logger.js'
import { queryEvents } from '../src/telemetry/query.js'

const TELEMETRY_PATH = join(homedir(), '.harness', 'telemetry.jsonl')

describe('telemetry', () => {
  beforeEach(() => {
    if (existsSync(TELEMETRY_PATH)) unlinkSync(TELEMETRY_PATH)
  })

  it('appends events to jsonl file', () => {
    logEvent({ session: 'abc', profile: 'coding', kind: 'tool', name: 'Read', ok: true, duration_ms: 10 })
    logEvent({ session: 'abc', profile: 'coding', kind: 'tool', name: 'Write', ok: true, duration_ms: 20 })
    const events = queryEvents({})
    expect(events).toHaveLength(2)
    expect(events[0].name).toBe('Read')
    expect(events[0].ts).toBeDefined()
  })

  it('filters by profile', () => {
    logEvent({ session: 'a', profile: 'coding', kind: 'tool', name: 'Read', ok: true })
    logEvent({ session: 'b', profile: 'data', kind: 'tool', name: 'Read', ok: true })
    const events = queryEvents({ profile: 'coding' })
    expect(events).toHaveLength(1)
  })

  it('filters by since date', () => {
    logEvent({ session: 'a', profile: 'coding', kind: 'tool', name: 'Read', ok: true })
    const future = new Date(Date.now() + 60_000)
    const events = queryEvents({ since: future })
    expect(events).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm test tests/telemetry.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write src/telemetry/logger.ts**

```ts
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { TelemetryEvent } from '../types.js'

export const TELEMETRY_PATH = join(homedir(), '.harness', 'telemetry.jsonl')

export function logEvent(event: Omit<TelemetryEvent, 'ts'>): void {
  mkdirSync(join(homedir(), '.harness'), { recursive: true })
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event })
  appendFileSync(TELEMETRY_PATH, line + '\n', 'utf-8')
}
```

- [ ] **Step 4: Write src/telemetry/query.ts**

```ts
import { readFileSync, existsSync } from 'fs'
import { TelemetryEvent } from '../types.js'
import { TELEMETRY_PATH } from './logger.js'

export function queryEvents(opts: {
  profile?: string
  since?: Date
  kind?: TelemetryEvent['kind']
}): TelemetryEvent[] {
  if (!existsSync(TELEMETRY_PATH)) return []
  return readFileSync(TELEMETRY_PATH, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as TelemetryEvent)
    .filter(e => {
      if (opts.profile && e.profile !== opts.profile) return false
      if (opts.since && new Date(e.ts) < opts.since) return false
      if (opts.kind && e.kind !== opts.kind) return false
      return true
    })
}

export function summarize(events: TelemetryEvent[]): string {
  const toolCounts = new Map<string, number>()
  const skillCounts = new Map<string, number>()
  const mcpCounts = new Map<string, number>()
  let totalCost = 0

  for (const e of events) {
    if (e.kind === 'tool' && e.name) toolCounts.set(e.name, (toolCounts.get(e.name) ?? 0) + 1)
    if (e.kind === 'skill' && e.name) skillCounts.set(e.name, (skillCounts.get(e.name) ?? 0) + 1)
    if (e.kind === 'mcp') {
      const key = `${e.server ?? '?'}/${e.name ?? '?'}`
      mcpCounts.set(key, (mcpCounts.get(key) ?? 0) + 1)
    }
    if (e.cost_usd) totalCost += e.cost_usd
  }

  const top5 = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => `  ${k}: ${v}`).join('\n') || '  (none)'

  return [
    `Total events: ${events.length}`,
    `Total cost: $${totalCost.toFixed(4)}`,
    `\nTop tools:\n${top5(toolCounts)}`,
    `\nTop skills:\n${top5(skillCounts)}`,
    `\nTop MCP calls:\n${top5(mcpCounts)}`,
  ].join('\n')
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
pnpm test tests/telemetry.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/telemetry/ tests/telemetry.test.ts
git commit -m "feat: telemetry logger + query"
```

---

## Task 6: Provider Client

**Files:**
- Create: `src/provider/client.ts`

No unit test here — mocking the entire OpenAI SDK is wasteful; the agent loop integration test (Task 17) covers this.

- [ ] **Step 1: Write src/provider/client.ts**

```ts
import OpenAI from 'openai'
import { Profile } from '../profiles/schema.js'

export function createProviderClient(profile: Profile): OpenAI {
  const apiKey = process.env[profile.model.api_key_env]
  if (!apiKey) {
    throw new Error(
      `Provider API key missing: set env var ${profile.model.api_key_env}`
    )
  }
  return new OpenAI({
    baseURL: profile.model.base_url,
    apiKey,
  })
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors in provider/client.ts

- [ ] **Step 3: Commit**

```bash
git add src/provider/client.ts
git commit -m "feat: openai-compatible provider client"
```

---

## Task 7: Tool Registry + ACL

**Files:**
- Create: `src/tools/registry.ts`
- Create: `src/tools/acl.ts`
- Create: `tests/acl.test.ts`
- Create: `tests/registry.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/acl.test.ts
import { describe, it, expect } from 'vitest'
import { getAcl, getMcpAcl } from '../src/tools/acl.js'
import { Profile } from '../src/profiles/schema.js'

const baseProfile = {
  name: 'test', model: { base_url: 'http://x', api_key_env: 'X', id: 'gpt-4o' },
  system_prompt: '/tmp/p.md', working_dir: '/tmp', artifact_dir: '/tmp/art',
  skills_dirs: [],
  tools: {
    builtin: { Read: 'allow', Bash: 'prompt', Write: 'deny' } as any,
    mcp_servers: [{ name: 'pg', command: 'pg-mcp', args: [], env: {}, acl: { '*': 'prompt', query: 'allow' } }],
  },
  hooks: { pre_tool: [], post_tool: [], on_stop: [] },
  improvement: { enabled: false, mine_skills_every_n_sessions: 10 },
} satisfies Profile

describe('getAcl', () => {
  it('returns allow for Read', () => expect(getAcl('Read', baseProfile)).toBe('allow'))
  it('returns prompt for Bash', () => expect(getAcl('Bash', baseProfile)).toBe('prompt'))
  it('returns deny for Write', () => expect(getAcl('Write', baseProfile)).toBe('deny'))
  it('returns prompt for unknown tool', () => expect(getAcl('Unknown', baseProfile)).toBe('prompt'))
})

describe('getMcpAcl', () => {
  it('returns allow for exact match', () => expect(getMcpAcl('pg', 'query', baseProfile)).toBe('allow'))
  it('returns wildcard for unmatched', () => expect(getMcpAcl('pg', 'insert', baseProfile)).toBe('prompt'))
  it('returns deny for unknown server', () => expect(getMcpAcl('unknown', 'x', baseProfile)).toBe('deny'))
})
```

```ts
// tests/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { registerTool, resolveTool, clearRegistry, getAllTools } from '../src/tools/registry.js'
import { ToolDefinition } from '../src/tools/types.js'

const fakeTool: ToolDefinition = {
  name: 'FakeTool',
  description: 'test',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async () => 'result',
}

beforeEach(() => clearRegistry())

describe('registry', () => {
  it('registers and resolves tool', () => {
    registerTool(fakeTool)
    expect(resolveTool('FakeTool')).toBe(fakeTool)
  })

  it('returns undefined for unknown tool', () => {
    expect(resolveTool('Nope')).toBeUndefined()
  })

  it('getAllTools returns all registered', () => {
    registerTool(fakeTool)
    expect(getAllTools()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests — expect fail**

```bash
pnpm test tests/acl.test.ts tests/registry.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write src/tools/acl.ts**

```ts
import { AclValue } from '../types.js'
import { Profile } from '../profiles/schema.js'

export function getAcl(toolName: string, profile: Profile): AclValue {
  const builtin = profile.tools?.builtin as Record<string, AclValue> | undefined
  return builtin?.[toolName] ?? 'prompt'
}

export function getMcpAcl(serverName: string, toolName: string, profile: Profile): AclValue {
  const server = profile.tools?.mcp_servers?.find(s => s.name === serverName)
  if (!server) return 'deny'
  const acl = server.acl as Record<string, AclValue>
  return acl[toolName] ?? acl['*'] ?? 'prompt'
}
```

- [ ] **Step 4: Write src/tools/registry.ts**

```ts
import { ToolDefinition } from './types.js'

const registry = new Map<string, ToolDefinition>()

export function registerTool(tool: ToolDefinition): void {
  registry.set(tool.name, tool)
}

export function resolveTool(name: string): ToolDefinition | undefined {
  return registry.get(name)
}

export function getAllTools(): ToolDefinition[] {
  return [...registry.values()]
}

export function clearRegistry(): void {
  registry.clear()
}

export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
pnpm test tests/acl.test.ts tests/registry.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/registry.ts src/tools/acl.ts tests/acl.test.ts tests/registry.test.ts
git commit -m "feat: tool registry + ACL"
```

---

## Task 8: Builtin Tools — Read + Write

**Files:**
- Create: `src/tools/builtin/read.ts`
- Create: `src/tools/builtin/write.ts`

- [ ] **Step 1: Write src/tools/builtin/read.ts**

```ts
import { readFileSync } from 'fs'
import { ToolDefinition } from '../types.js'

export const readTool: ToolDefinition = {
  name: 'Read',
  description: 'Read a file. Returns content with line numbers (cat -n format).',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to file' },
      offset: { type: 'number', description: 'Start line, 1-indexed (default 1)' },
      limit: { type: 'number', description: 'Max lines to read (default 2000)' },
    },
    required: ['file_path'],
  },
  async execute(input) {
    const { file_path, offset = 1, limit = 2000 } = input as {
      file_path: string; offset?: number; limit?: number
    }
    const content = readFileSync(file_path, 'utf-8')
    const lines = content.split('\n')
    const slice = lines.slice(offset - 1, offset - 1 + limit)
    return slice.map((l, i) => `${offset + i}\t${l}`).join('\n')
  },
}
```

- [ ] **Step 2: Write src/tools/builtin/write.ts**

```ts
import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { ToolDefinition } from '../types.js'

export const writeTool: ToolDefinition = {
  name: 'Write',
  description: 'Write content to a file, creating parent directories as needed.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to file' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['file_path', 'content'],
  },
  async execute(input) {
    const { file_path, content } = input as { file_path: string; content: string }
    mkdirSync(dirname(file_path), { recursive: true })
    writeFileSync(file_path, content, 'utf-8')
    return `Written ${content.length} bytes to ${file_path}`
  },
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/tools/builtin/read.ts src/tools/builtin/write.ts
git commit -m "feat: builtin Read + Write tools"
```

---

## Task 9: Builtin Tool — Edit

**Files:**
- Create: `src/tools/builtin/edit.ts`

- [ ] **Step 1: Write src/tools/builtin/edit.ts**

```ts
import { readFileSync, writeFileSync } from 'fs'
import { ToolDefinition } from '../types.js'

export const editTool: ToolDefinition = {
  name: 'Edit',
  description: 'Replace an exact string in a file. old_string must be unique unless replace_all is true.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      old_string: { type: 'string', description: 'Exact text to find (must be unique in file)' },
      new_string: { type: 'string', description: 'Text to replace it with' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  async execute(input) {
    const { file_path, old_string, new_string, replace_all = false } = input as {
      file_path: string; old_string: string; new_string: string; replace_all?: boolean
    }
    const content = readFileSync(file_path, 'utf-8')
    const count = content.split(old_string).length - 1
    if (count === 0) {
      throw new Error(`old_string not found in ${file_path}`)
    }
    if (!replace_all && count > 1) {
      throw new Error(
        `old_string found ${count} times in ${file_path} — must be unique. Add more surrounding context or use replace_all: true.`
      )
    }
    const updated = replace_all
      ? content.split(old_string).join(new_string)
      : content.replace(old_string, new_string)
    writeFileSync(file_path, updated, 'utf-8')
    return `Replaced ${count} occurrence(s) in ${file_path}`
  },
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/builtin/edit.ts
git commit -m "feat: builtin Edit tool"
```

---

## Task 10: Builtin Tools — Bash, Grep, Glob

**Files:**
- Create: `src/tools/builtin/bash.ts`
- Create: `src/tools/builtin/grep.ts`
- Create: `src/tools/builtin/glob.ts`

- [ ] **Step 1: Write src/tools/builtin/bash.ts**

```ts
import { spawn } from 'child_process'
import { ToolDefinition } from '../types.js'

const MAX_OUTPUT = 50_000

export const bashTool: ToolDefinition = {
  name: 'Bash',
  description: 'Execute a bash command. Timeout 120s max. stdout + stderr combined.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout: { type: 'number', description: 'Timeout in ms (max 120000, default 120000)' },
    },
    required: ['command'],
  },
  async execute(input) {
    const { command, timeout = 120_000 } = input as { command: string; timeout?: number }
    const effectiveTimeout = Math.min(timeout, 120_000)
    return new Promise((resolve, reject) => {
      let output = ''
      const proc = spawn('bash', ['-c', command], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const timer = setTimeout(() => {
        proc.kill()
        resolve(`[timeout after ${effectiveTimeout}ms]\n${output}`)
      }, effectiveTimeout)
      proc.stdout.on('data', (d: Buffer) => { output += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { output += d.toString() })
      proc.on('close', (code) => {
        clearTimeout(timer)
        const truncated = output.length > MAX_OUTPUT
          ? output.slice(0, MAX_OUTPUT) + '\n[truncated]'
          : output
        resolve(code === 0 ? truncated : `Exit ${code}\n${truncated}`)
      })
      proc.on('error', reject)
    })
  },
}
```

- [ ] **Step 2: Write src/tools/builtin/grep.ts**

```ts
import { execFileSync } from 'child_process'
import { ToolDefinition } from '../types.js'

export const grepTool: ToolDefinition = {
  name: 'Grep',
  description: 'Search for a regex pattern in files.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern' },
      path: { type: 'string', description: 'File or directory to search' },
      flags: { type: 'string', description: 'grep flags (default: -rn --include not set)' },
    },
    required: ['pattern', 'path'],
  },
  async execute(input) {
    const { pattern, path, flags = '-rn' } = input as { pattern: string; path: string; flags?: string }
    try {
      const args = [...flags.split(' ').filter(Boolean), pattern, path]
      return execFileSync('grep', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
    } catch (e: any) {
      if (e.status === 1) return '(no matches)'
      throw new Error(e.stderr ?? e.message)
    }
  },
}
```

- [ ] **Step 3: Write src/tools/builtin/glob.ts**

```ts
import fg from 'fast-glob'
import { ToolDefinition } from '../types.js'

export const globTool: ToolDefinition = {
  name: 'Glob',
  description: 'Find files matching a glob pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. src/**/*.ts)' },
      cwd: { type: 'string', description: 'Working directory (defaults to process.cwd())' },
    },
    required: ['pattern'],
  },
  async execute(input) {
    const { pattern, cwd = process.cwd() } = input as { pattern: string; cwd?: string }
    const files = await fg(pattern, { cwd, dot: true })
    return files.length > 0 ? files.join('\n') : '(no matches)'
  },
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/tools/builtin/bash.ts src/tools/builtin/grep.ts src/tools/builtin/glob.ts
git commit -m "feat: builtin Bash + Grep + Glob tools"
```

---

## Task 11: MCP Client Manager

**Files:**
- Create: `src/mcp/client.ts`

No unit test — requires a live MCP server process. Integration verified manually via reference profile in Task 22.

- [ ] **Step 1: Write src/mcp/client.ts**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Profile } from '../profiles/schema.js'
import { ToolDefinition } from '../tools/types.js'

interface McpEntry {
  client: Client
  serverName: string
  toolNames: string[]
}

const entries: McpEntry[] = []

export async function initMcpClients(profile: Profile): Promise<void> {
  for (const cfg of profile.tools.mcp_servers) {
    const transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args,
      env: { ...process.env as Record<string, string>, ...cfg.env },
    })
    const client = new Client({ name: 'harness', version: '0.1.0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    entries.push({
      client,
      serverName: cfg.name,
      toolNames: tools.map((t: any) => t.name),
    })
  }
}

export async function closeMcpClients(): Promise<void> {
  for (const e of entries) await e.client.close()
  entries.length = 0
}

export function getMcpToolDefinitions(profile: Profile): ToolDefinition[] {
  const result: ToolDefinition[] = []
  for (const entry of entries) {
    const cfg = profile.tools.mcp_servers.find(s => s.name === entry.serverName)
    if (!cfg) continue
    for (const toolName of entry.toolNames) {
      result.push({
        name: `${entry.serverName}__${toolName}`,
        description: `[MCP:${entry.serverName}] ${toolName}`,
        parameters: { type: 'object', properties: {}, additionalProperties: true },
        async execute(input) {
          const r = await entry.client.callTool({ name: toolName, arguments: input })
          const content = r.content as Array<{ type: string; text?: string }>
          return content.map(c => c.text ?? JSON.stringify(c)).join('\n')
        },
      })
    }
  }
  return result
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/mcp/client.ts
git commit -m "feat: MCP client manager"
```

---

## Task 12: Memory Layer (FS Implementation)

**Files:**
- Create: `src/memory/fs-memory.ts`
- Create: `tests/memory.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/memory.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { createSession } from '../src/session/store.js'

describe('FsMemoryProvider', () => {
  let artifactDir: string
  let provider: FsMemoryProvider

  beforeEach(() => {
    artifactDir = mkdtempSync(join(tmpdir(), 'harness-mem-'))
    provider = new FsMemoryProvider(artifactDir, createSession('test'))
  })

  it('reads and writes session memory', async () => {
    await provider.write('session', 'foo', 'bar')
    expect(await provider.read('session', 'foo')).toBe('bar')
  })

  it('returns null for missing session key', async () => {
    expect(await provider.read('session', 'missing')).toBeNull()
  })

  it('reads and writes profile memory files', async () => {
    await provider.write('profile', 'project-context', '# Context\nThis is a test.')
    const content = await provider.read('profile', 'project-context')
    expect(content).toContain('This is a test.')
  })

  it('lists profile memory entries', async () => {
    await provider.write('profile', 'key1', 'val1')
    await provider.write('profile', 'key2', 'val2')
    const entries = await provider.list('profile')
    expect(entries.map(e => e.key)).toContain('key1')
    expect(entries.map(e => e.key)).toContain('key2')
  })

  it('builds system prompt section from MEMORY.md', async () => {
    await provider.write('profile', 'context', '# Context\nSomething important.')
    const section = await provider.buildSystemPromptSection()
    expect(section).toContain('Memory')
    expect(section).toContain('context')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm test tests/memory.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write src/memory/fs-memory.ts**

```ts
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { MemoryProvider, MemoryEntry } from './interface.js'
import { Session } from '../session/types.js'

export class FsMemoryProvider implements MemoryProvider {
  constructor(
    private readonly artifactDir: string,
    private readonly session: Session
  ) {}

  private get memDir(): string {
    return join(this.artifactDir, 'memory')
  }

  async read(scope: 'session' | 'profile', key: string): Promise<string | null> {
    if (scope === 'session') {
      return this.session.session_memory[key] ?? null
    }
    const path = join(this.memDir, `${key}.md`)
    return existsSync(path) ? readFileSync(path, 'utf-8') : null
  }

  async write(scope: 'session' | 'profile', key: string, content: string): Promise<void> {
    if (scope === 'session') {
      this.session.session_memory[key] = content
      return
    }
    mkdirSync(this.memDir, { recursive: true })
    writeFileSync(join(this.memDir, `${key}.md`), content, 'utf-8')
    await this.rebuildIndex()
  }

  async list(scope: 'session' | 'profile'): Promise<MemoryEntry[]> {
    if (scope === 'session') {
      return Object.entries(this.session.session_memory).map(([key, val]) => ({
        key,
        preview: val.slice(0, 100),
      }))
    }
    if (!existsSync(this.memDir)) return []
    return readdirSync(this.memDir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
      .map(f => {
        const key = f.replace(/\.md$/, '')
        const content = readFileSync(join(this.memDir, f), 'utf-8')
        return { key, preview: content.slice(0, 100) }
      })
  }

  async buildSystemPromptSection(): Promise<string> {
    const indexPath = join(this.memDir, 'MEMORY.md')
    if (!existsSync(indexPath)) return ''
    const content = readFileSync(indexPath, 'utf-8')
    return `\n\n## Memory\n${content}`
  }

  private async rebuildIndex(): Promise<void> {
    const entries = await this.list('profile')
    const lines = entries.map(e => `- **${e.key}**: ${e.preview.replace(/\n/g, ' ')}`)
    const index = `# Memory Index\n\n${lines.join('\n')}\n`
    writeFileSync(join(this.memDir, 'MEMORY.md'), index, 'utf-8')
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm test tests/memory.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory/fs-memory.ts tests/memory.test.ts
git commit -m "feat: FsMemoryProvider"
```

---

## Task 13: Memory Tools

**Files:**
- Create: `src/tools/builtin/memory-read.ts`
- Create: `src/tools/builtin/memory-write.ts`
- Create: `src/tools/builtin/memory-list.ts`

- [ ] **Step 1: Write src/tools/builtin/memory-read.ts**

```ts
import { ToolDefinition, ToolContext } from '../types.js'

export const memoryReadTool: ToolDefinition = {
  name: 'MemoryRead',
  description: 'Read a memory entry by key from session or profile scope.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile'] },
      key: { type: 'string' },
    },
    required: ['scope', 'key'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope, key } = input as { scope: 'session' | 'profile'; key: string }
    const val = await ctx.memory.read(scope, key)
    return val ?? `(no memory entry for key: ${key})`
  },
}
```

- [ ] **Step 2: Write src/tools/builtin/memory-write.ts**

```ts
import { ToolDefinition, ToolContext } from '../types.js'

export const memoryWriteTool: ToolDefinition = {
  name: 'MemoryWrite',
  description: 'Write a memory entry. Profile scope persists to disk across sessions.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile'] },
      key: { type: 'string', description: 'Short slug (e.g. project-context)' },
      content: { type: 'string', description: 'Markdown content to store' },
    },
    required: ['scope', 'key', 'content'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope, key, content } = input as { scope: 'session' | 'profile'; key: string; content: string }
    await ctx.memory.write(scope, key, content)
    return `Memory written: ${scope}/${key}`
  },
}
```

- [ ] **Step 3: Write src/tools/builtin/memory-list.ts**

```ts
import { ToolDefinition, ToolContext } from '../types.js'

export const memoryListTool: ToolDefinition = {
  name: 'MemoryList',
  description: 'List all memory entries in a scope.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['session', 'profile'] },
    },
    required: ['scope'],
  },
  async execute(input, ctx: ToolContext) {
    const { scope } = input as { scope: 'session' | 'profile' }
    const entries = await ctx.memory.list(scope)
    if (entries.length === 0) return `(no entries in ${scope} memory)`
    return entries.map(e => `- **${e.key}**: ${e.preview}`).join('\n')
  },
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/tools/builtin/memory-read.ts src/tools/builtin/memory-write.ts src/tools/builtin/memory-list.ts
git commit -m "feat: MemoryRead + MemoryWrite + MemoryList tools"
```

---

## Task 14: Skill System + Skill Tool

**Files:**
- Create: `src/skills/loader.ts`
- Create: `src/skills/indexer.ts`
- Create: `src/tools/builtin/skill.ts`
- Create: `tests/skills.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/skills.test.ts
import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadSkillsFromDir, loadAllSkills } from '../src/skills/loader.js'
import { buildSkillIndex } from '../src/skills/indexer.js'

describe('skill loader', () => {
  it('loads skills from directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skills-'))
    writeFileSync(join(dir, 'foo.md'), `---\nname: foo\ndescription: does foo\n---\n# Foo\nDo the foo thing.`)
    const skills = loadSkillsFromDir(dir)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('foo')
    expect(skills[0].description).toBe('does foo')
  })

  it('skips files starting with _', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skills2-'))
    writeFileSync(join(dir, '_proposed.md'), `---\nname: draft\ndescription: draft\n---`)
    const skills = loadSkillsFromDir(dir)
    expect(skills).toHaveLength(0)
  })

  it('later dir overrides earlier (project-local wins)', () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'skills3a-'))
    const dir2 = mkdtempSync(join(tmpdir(), 'skills3b-'))
    writeFileSync(join(dir1, 'shared.md'), `---\nname: shared\ndescription: global\n---`)
    writeFileSync(join(dir2, 'shared.md'), `---\nname: shared\ndescription: local\n---`)
    const skills = loadAllSkills([dir1, dir2])
    expect(skills).toHaveLength(1)
    expect(skills[0].description).toBe('local')
  })
})

describe('buildSkillIndex', () => {
  it('builds index string from skills', () => {
    const index = buildSkillIndex([{ name: 'foo', description: 'does foo', content: '', filePath: '' }])
    expect(index).toContain('foo')
    expect(index).toContain('does foo')
  })

  it('returns empty string when no skills', () => {
    expect(buildSkillIndex([])).toBe('')
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm test tests/skills.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write src/skills/loader.ts**

```ts
import matter from 'gray-matter'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { Skill } from '../tools/types.js'

export { Skill }

export function loadSkillsFromDir(dir: string): Skill[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .map(f => {
      const filePath = join(dir, f)
      const raw = readFileSync(filePath, 'utf-8')
      const { data } = matter(raw)
      return {
        name: data.name as string,
        description: data.description as string,
        content: raw,
        filePath,
      }
    })
    .filter(s => s.name && s.description)
}

export function loadAllSkills(skillsDirs: string[]): Skill[] {
  const byName = new Map<string, Skill>()
  for (const dir of skillsDirs) {
    for (const skill of loadSkillsFromDir(dir)) {
      byName.set(skill.name, skill)
    }
  }
  return [...byName.values()]
}
```

- [ ] **Step 4: Write src/skills/indexer.ts**

```ts
import { Skill } from '../tools/types.js'

export function buildSkillIndex(skills: Skill[]): string {
  if (skills.length === 0) return ''
  const lines = skills.map(s => `- **${s.name}**: ${s.description}`)
  return `\n\n## Available Skills\nInvoke with Skill({name}) tool.\n${lines.join('\n')}`
}
```

- [ ] **Step 5: Write src/tools/builtin/skill.ts**

```ts
import { readFileSync } from 'fs'
import { ToolDefinition, ToolContext } from '../types.js'
import { logEvent } from '../../telemetry/logger.js'

export const skillTool: ToolDefinition = {
  name: 'Skill',
  description: 'Load and read a skill by name. Returns the full skill content.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill name as listed in the skill index' },
    },
    required: ['name'],
  },
  async execute(input, ctx: ToolContext) {
    const { name } = input as { name: string }
    const skill = ctx.skills.find(s => s.name === name)
    if (!skill) {
      const available = ctx.skills.map(s => s.name).join(', ')
      return `Skill "${name}" not found. Available: ${available || '(none)'}`
    }
    logEvent({
      session: ctx.session.id,
      profile: ctx.profile.name,
      kind: 'skill',
      name,
      trigger: 'model',
    })
    return readFileSync(skill.filePath, 'utf-8')
  },
}
```

- [ ] **Step 6: Run test — expect pass**

```bash
pnpm test tests/skills.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/skills/ src/tools/builtin/skill.ts tests/skills.test.ts
git commit -m "feat: skill loader + indexer + Skill tool"
```

---

## Task 15: Delegate Stub + Hooks Runner + Stats Tool

**Files:**
- Create: `src/tools/builtin/delegate.ts`
- Create: `src/hooks/runner.ts`
- Create: `src/tools/builtin/stats.ts`

- [ ] **Step 1: Write src/tools/builtin/delegate.ts**

```ts
import { ToolDefinition } from '../types.js'

export const delegateTool: ToolDefinition = {
  name: 'Delegate',
  description: 'Delegate a task to another profile (stub — not yet implemented).',
  parameters: {
    type: 'object',
    properties: {
      profile: { type: 'string', description: 'Target profile name' },
      task: { type: 'string', description: 'Task description for the sub-agent' },
    },
    required: ['profile', 'task'],
  },
  async execute(input) {
    const { profile, task } = input as { profile: string; task: string }
    return `[Delegate stub] Would run profile "${profile}" with task: "${task}". Inter-profile delegation not yet implemented.`
  },
}
```

- [ ] **Step 2: Write src/hooks/runner.ts**

```ts
import { execSync } from 'child_process'
import { Profile } from '../profiles/schema.js'

export type HookType = 'pre_tool' | 'post_tool' | 'on_stop'

export function runHooks(
  hookType: HookType,
  profile: Profile,
  env: Record<string, string> = {}
): void {
  const hooks = profile.hooks?.[hookType] ?? []
  for (const cmd of hooks) {
    try {
      execSync(cmd, {
        env: { ...process.env as Record<string, string>, ...env },
        stdio: 'pipe',
      })
    } catch (e: any) {
      console.error(`[hook:${hookType}] failed: ${cmd}\n${e.stderr?.toString() ?? e.message}`)
    }
  }
}
```

- [ ] **Step 3: Write src/tools/builtin/stats.ts**

```ts
import { ToolDefinition, ToolContext } from '../types.js'
import { queryEvents, summarize } from '../../telemetry/query.js'

export const statsTool: ToolDefinition = {
  name: 'Stats',
  description: 'Show usage stats: top tools, skills, MCP calls, and cost breakdown.',
  parameters: {
    type: 'object',
    properties: {
      since_days: { type: 'number', description: 'Show stats for last N days (default 7)' },
      profile: { type: 'string', description: 'Filter by profile (default: current profile)' },
    },
    required: [],
  },
  async execute(input, ctx: ToolContext) {
    const { since_days = 7, profile } = input as { since_days?: number; profile?: string }
    const since = new Date(Date.now() - since_days * 24 * 60 * 60 * 1000)
    const events = queryEvents({ profile: profile ?? ctx.profile.name, since })
    return summarize(events)
  },
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/tools/builtin/delegate.ts src/tools/builtin/stats.ts src/hooks/runner.ts
git commit -m "feat: Delegate stub + Hooks runner + Stats tool"
```

---

## Task 16: Builtin Tool Index

**Files:**
- Create: `src/tools/builtin/index.ts`

- [ ] **Step 1: Write src/tools/builtin/index.ts**

```ts
import { registerTool } from '../registry.js'
import { readTool } from './read.js'
import { writeTool } from './write.js'
import { editTool } from './edit.js'
import { bashTool } from './bash.js'
import { grepTool } from './grep.js'
import { globTool } from './glob.js'
import { skillTool } from './skill.js'
import { memoryReadTool } from './memory-read.js'
import { memoryWriteTool } from './memory-write.js'
import { memoryListTool } from './memory-list.js'
import { statsTool } from './stats.js'
import { delegateTool } from './delegate.js'

export function registerAll(): void {
  registerTool(readTool)
  registerTool(writeTool)
  registerTool(editTool)
  registerTool(bashTool)
  registerTool(grepTool)
  registerTool(globTool)
  registerTool(skillTool)
  registerTool(memoryReadTool)
  registerTool(memoryWriteTool)
  registerTool(memoryListTool)
  registerTool(statsTool)
  registerTool(delegateTool)
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/tools/builtin/index.ts
git commit -m "feat: builtin tool index (registerAll)"
```

---

## Task 17: Agent Loop

**Files:**
- Create: `src/loop/agent-loop.ts`
- Create: `tests/agent-loop.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/agent-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAgentLoop } from '../src/loop/agent-loop.js'
import { createSession } from '../src/session/store.js'
import { FsMemoryProvider } from '../src/memory/fs-memory.js'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import OpenAI from 'openai'

function makeFakeOpenAI(responses: any[]): OpenAI {
  let call = 0
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const response = responses[call++]
          return response
        }),
      },
    },
  } as unknown as OpenAI
}

async function* makeStream(chunks: any[]) {
  for (const chunk of chunks) yield chunk
}

describe('runAgentLoop', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'loop-'))
  let endedSessionId: string | null

  beforeEach(() => { endedSessionId = null })

  it('runs end_turn immediately when no tool calls', async () => {
    const session = createSession('test')
    const profile: any = {
      name: 'test',
      model: { id: 'gpt-4o', base_url: '', api_key_env: '' },
      tools: { builtin: {}, mcp_servers: [] },
      hooks: { pre_tool: [], post_tool: [], on_stop: [] },
      improvement: { enabled: false },
    }
    const memory = new FsMemoryProvider(tmp, session)
    const ctx: any = { profile, session, workingDir: tmp, memory, skills: [] }

    const openai = makeFakeOpenAI([
      makeStream([
        { choices: [{ delta: { content: 'Hello!' } }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
      ]),
    ])

    const tokens: string[] = []
    await runAgentLoop('hi', profile, session, ctx, {
      onToken: t => tokens.push(t),
      onToolStart: vi.fn(),
      onToolEnd: vi.fn(),
      onToolPrompt: vi.fn(),
      onSessionEnd: id => { endedSessionId = id },
    }, openai)

    expect(tokens).toContain('Hello!')
    expect(endedSessionId).toBe(session.id)
    expect(session.messages).toHaveLength(2) // user + assistant
  })
})
```

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm test tests/agent-loop.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write src/loop/agent-loop.ts**

```ts
import OpenAI from 'openai'
import { Profile } from '../profiles/schema.js'
import { Session } from '../session/types.js'
import { ToolContext } from '../tools/types.js'
import { getAllTools, toOpenAITools } from '../tools/registry.js'
import { getMcpToolDefinitions } from '../mcp/client.js'
import { getAcl, getMcpAcl } from '../tools/acl.js'
import { logEvent } from '../telemetry/logger.js'
import { runHooks } from '../hooks/runner.js'

export interface AgentLoopEvents {
  onToken(token: string): void
  onToolStart(name: string, input: Record<string, unknown>): void
  onToolEnd(name: string, result: string): void
  onToolPrompt(id: string, name: string, input: Record<string, unknown>): Promise<boolean>
  onSessionEnd(sessionId: string): void
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

    const stream = await (openai.chat.completions as any).create({
      model: profile.model.id,
      messages: session.messages as OpenAI.ChatCompletionMessageParam[],
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      stream: true,
    }, { signal })

    let assistantContent = ''
    const toolCallMap = new Map<number, {
      id: string; name: string; args: string
    }>()
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

    for (const tc of toolCalls) {
      const name = tc.name
      let input: Record<string, unknown>
      try {
        input = JSON.parse(tc.args || '{}')
      } catch {
        input = {}
      }

      const isMcp = name.includes('__')
      let acl: string
      if (isMcp) {
        const [server, tool] = name.split('__', 2)
        acl = getMcpAcl(server, tool, profile)
      } else {
        acl = getAcl(name, profile)
      }

      if (acl === 'deny') {
        session.messages.push({
          role: 'tool', tool_call_id: tc.id,
          content: `Tool "${name}" is denied by profile ACL.`,
        } as any)
        continue
      }

      if (acl === 'prompt') {
        const approved = await events.onToolPrompt(tc.id, name, input)
        if (!approved) {
          session.messages.push({
            role: 'tool', tool_call_id: tc.id,
            content: `User denied tool "${name}".`,
          } as any)
          continue
        }
      }

      runHooks('pre_tool', profile, { TOOL_NAME: name })
      events.onToolStart(name, input)

      const toolDef = allTools.find(t => t.name === name)
      const toolStart = Date.now()
      let result: string
      let ok = true
      try {
        if (!toolDef) throw new Error(`Tool "${name}" not found in registry`)
        result = await toolDef.execute(input, context)
      } catch (e: any) {
        result = `Error: ${e.message}`
        ok = false
      }
      const duration_ms = Date.now() - toolStart

      logEvent({
        session: session.id, profile: profile.name,
        kind: isMcp ? 'mcp' : 'tool',
        name, duration_ms, ok,
      })
      runHooks('post_tool', profile, { TOOL_NAME: name, TOOL_OK: String(ok) })
      events.onToolEnd(name, result)

      session.messages.push({
        role: 'tool', tool_call_id: tc.id, content: result,
      } as any)
      session.tool_calls.push({ name, input, result, ok, ts: new Date().toISOString() })
    }
  }
}

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  return (tokensIn * 0.000003) + (tokensOut * 0.000015)
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm test tests/agent-loop.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/loop/agent-loop.ts tests/agent-loop.test.ts
git commit -m "feat: agent loop"
```

---

## Task 18: WebSocket Server

**Files:**
- Create: `src/server/index.ts`

- [ ] **Step 1: Write src/server/index.ts**

```ts
import { WebSocketServer, WebSocket } from 'ws'
import { resolve } from 'path'
import { homedir } from 'os'
import { loadProfile } from '../profiles/loader.js'
import { createSession, saveSession, loadSession } from '../session/store.js'
import { createProviderClient } from '../provider/client.js'
import { initMcpClients, closeMcpClients } from '../mcp/client.js'
import { FsMemoryProvider } from '../memory/fs-memory.js'
import { loadAllSkills } from '../skills/loader.js'
import { registerAll, clearRegistry } from '../tools/builtin/index.js'
import { buildSkillIndex } from '../skills/indexer.js'
import { runAgentLoop } from '../loop/agent-loop.js'
import { readFileSync } from 'fs'
import { ClientMessage, ServerMessage } from '../types.js'

const PORT = parseInt(process.env.HARNESS_PORT ?? '7337')

async function main() {
  const profileArg = process.argv[2]
  const profilePath = profileArg
    ? resolve(profileArg)
    : resolve(homedir(), '.harness', 'profiles', 'coding.yaml')

  const profile = loadProfile(profilePath)

  clearRegistry()
  registerAll()
  await initMcpClients(profile)

  const openai = createProviderClient(profile)
  const skills = loadAllSkills(profile.skills_dirs)
  const skillIndex = buildSkillIndex(skills)

  const systemPromptBase = readFileSync(profile.system_prompt, 'utf-8')
  const systemPrompt = systemPromptBase + skillIndex

  const wss = new WebSocketServer({ port: PORT })
  console.log(`Harness server on ws://localhost:${PORT} [profile: ${profile.name}]`)

  wss.on('connection', (ws: WebSocket) => {
    let session = createSession(profile.name)
    let memory = new FsMemoryProvider(profile.artifact_dir, session)
    let abortController = new AbortController()
    const pendingApprovals = new Map<string, (approved: boolean) => void>()

    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
    }

    // prepend system message
    session.messages.push({
      role: 'system',
      content: systemPrompt + (memory as any).buildSystemPromptSection
        ? '' // will be appended async on first message
        : '',
    })

    ws.on('message', async (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage
      } catch {
        send({ type: 'error', message: 'Invalid JSON' })
        return
      }

      if (msg.type === 'cancel') {
        abortController.abort()
        abortController = new AbortController()
        return
      }

      if (msg.type === 'tool_approve' || msg.type === 'tool_deny') {
        const cb = pendingApprovals.get(msg.id)
        if (cb) { pendingApprovals.delete(msg.id); cb(msg.type === 'tool_approve') }
        return
      }

      if (msg.type === 'resume') {
        const loaded = loadSession(msg.sessionId)
        if (loaded) {
          session = loaded
          memory = new FsMemoryProvider(profile.artifact_dir, session)
          send({ type: 'session_end', sessionId: session.id })
        } else {
          send({ type: 'error', message: `Session ${msg.sessionId} not found` })
        }
        return
      }

      if (msg.type === 'message') {
        // inject memory section into system message on first user turn
        if (session.messages.length === 1) {
          const memSection = await memory.buildSystemPromptSection()
          session.messages[0] = { role: 'system', content: systemPrompt + memSection }
        }

        const context = {
          profile, session, workingDir: profile.working_dir, memory, skills,
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
          }, openai, abortController.signal)
        } catch (e: any) {
          if (e.name !== 'AbortError') {
            send({ type: 'error', message: e.message })
          }
        }
      }
    })

    ws.on('close', () => { saveSession(session) })
    ws.on('error', (e) => console.error('ws error:', e.message))
  })

  process.on('SIGINT', async () => {
    console.log('\nShutting down...')
    await closeMcpClients()
    wss.close()
    process.exit(0)
  })
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Update src/tools/builtin/index.ts to export clearRegistry**

Open `src/tools/builtin/index.ts` and add this export at the top:

```ts
export { clearRegistry } from '../registry.js'
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts src/tools/builtin/index.ts
git commit -m "feat: WebSocket server"
```

---

## Task 19: CLI Client

**Files:**
- Create: `src/cli/index.ts`

- [ ] **Step 1: Write src/cli/index.ts**

```ts
import WebSocket from 'ws'
import * as readline from 'readline'
import { ClientMessage, ServerMessage } from '../types.js'

const PORT = parseInt(process.env.HARNESS_PORT ?? '7337')
const ws = new WebSocket(`ws://localhost:${PORT}`)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
})

const send = (msg: ClientMessage) => ws.send(JSON.stringify(msg))

ws.on('open', () => {
  console.log(`Connected to harness (ws://localhost:${PORT})`)
  console.log('Commands: /exit  /cancel  /resume <session-id>')
  prompt()
})

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString()) as ServerMessage
  switch (msg.type) {
    case 'token':
      process.stdout.write(msg.content)
      break
    case 'tool_start':
      process.stdout.write(`\n[tool:start] ${msg.name} ${JSON.stringify(msg.input)}\n`)
      break
    case 'tool_end':
      process.stdout.write(`[tool:end] ${msg.name}\n`)
      break
    case 'tool_prompt':
      rl.question(
        `\n[permission] Allow "${msg.name}"?\n  Input: ${JSON.stringify(msg.input)}\n  [y/N] `,
        (ans) => {
          send(
            ans.trim().toLowerCase() === 'y'
              ? { type: 'tool_approve', id: msg.id }
              : { type: 'tool_deny', id: msg.id }
          )
        }
      )
      break
    case 'session_end':
      process.stdout.write(`\n[session: ${msg.sessionId}]\n`)
      prompt()
      break
    case 'error':
      process.stdout.write(`\n[error] ${msg.message}\n`)
      prompt()
      break
  }
})

ws.on('close', () => { console.log('\nDisconnected.'); process.exit(0) })
ws.on('error', (e) => { console.error('Connection error:', e.message); process.exit(1) })

function prompt() {
  rl.question('> ', (input) => {
    const trimmed = input.trim()
    if (!trimmed) { prompt(); return }
    if (trimmed === '/exit') { ws.close(); rl.close(); return }
    if (trimmed === '/cancel') { send({ type: 'cancel' }); prompt(); return }
    if (trimmed.startsWith('/resume ')) {
      send({ type: 'resume', sessionId: trimmed.slice(8).trim() })
      return
    }
    send({ type: 'message', content: trimmed })
  })
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: CLI client"
```

---

## Task 20: Improver — Reflect + Skill Mining

**Files:**
- Create: `src/improver/default-improver.ts`

- [ ] **Step 1: Write src/improver/default-improver.ts**

```ts
import OpenAI from 'openai'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { Session } from '../session/types.js'
import { MemoryProvider } from '../memory/interface.js'
import { Improver, ProposedSkill } from './interface.js'
import { queryEvents } from '../telemetry/query.js'
import { Profile } from '../profiles/schema.js'

export class DefaultImprover implements Improver {
  constructor(
    private readonly profile: Profile,
    private readonly openai: OpenAI
  ) {}

  private get modelId(): string {
    return this.profile.improvement?.model_id ?? this.profile.model.id
  }

  async reflect(session: Session, memory: MemoryProvider): Promise<void> {
    if (!this.profile.improvement?.enabled) return

    const transcript = (session.messages as any[])
      .filter(m => m.role !== 'system')
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 500) : JSON.stringify(m.content).slice(0, 500)}`)
      .join('\n')
      .slice(0, 8_000)

    const memSection = await memory.buildSystemPromptSection()

    let memories: Array<{ key: string; content: string }> = []
    try {
      const response = await this.openai.chat.completions.create({
        model: this.modelId,
        messages: [{
          role: 'user',
          content: `Review this agent session. Identify 0-3 things worth remembering for future sessions. Output ONLY a JSON array: [{"key":"slug","content":"markdown"}]. Empty array if nothing significant.\n\nCurrent memory:${memSection}\n\nTranscript:\n${transcript}`,
        }],
        response_format: { type: 'json_object' },
      })
      const parsed = JSON.parse(response.choices[0].message.content ?? '{"items":[]}')
      memories = parsed.items ?? parsed ?? []
    } catch {
      return
    }

    for (const m of memories) {
      if (m.key && m.content) await memory.write('profile', m.key, m.content)
    }

    if (memories.length > 0) {
      const learningsDir = join(this.profile.artifact_dir, 'learnings')
      mkdirSync(learningsDir, { recursive: true })
      const date = new Date().toISOString().slice(0, 10)
      const entry = `\n## Session ${session.id} (${new Date().toISOString()})\n` +
        memories.map(m => `- **${m.key}**: ${m.content.slice(0, 200)}`).join('\n') + '\n'
      writeFileSync(join(learningsDir, `${date}.md`), entry, { flag: 'a' })
    }
  }

  async mineSkills(sessions: Session[]): Promise<ProposedSkill[]> {
    if (!this.profile.improvement?.enabled || sessions.length === 0) return []

    const telemetry = queryEvents({ profile: this.profile.name })
    const toolFreq = telemetry
      .filter(e => e.kind === 'tool' || e.kind === 'mcp')
      .reduce((acc, e) => {
        const k = e.name ?? 'unknown'
        acc[k] = (acc[k] ?? 0) + 1
        return acc
      }, {} as Record<string, number>)

    const topTools = Object.entries(toolFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    let skills: ProposedSkill[] = []
    try {
      const response = await this.openai.chat.completions.create({
        model: this.modelId,
        messages: [{
          role: 'user',
          content: `Based on ${sessions.length} sessions and these tool frequencies, propose 1-2 skills that could automate common workflows. Tool frequencies: ${JSON.stringify(topTools)}. Output ONLY JSON array: [{"name":"skill-slug","description":"one line","content":"full markdown with ---\\nname: slug\\ndescription: one line\\n--- frontmatter"}]. Empty array if nothing compelling.`,
        }],
        response_format: { type: 'json_object' },
      })
      const parsed = JSON.parse(response.choices[0].message.content ?? '{"items":[]}')
      skills = parsed.items ?? parsed ?? []
    } catch {
      return []
    }

    const proposedDir = join(
      this.profile.skills_dirs[0] ?? join(this.profile.artifact_dir, 'skills'),
      '_proposed'
    )
    mkdirSync(proposedDir, { recursive: true })
    for (const skill of skills) {
      if (skill.name && skill.content) {
        writeFileSync(join(proposedDir, `${skill.name}.md`), skill.content, 'utf-8')
      }
    }

    return skills
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/improver/default-improver.ts
git commit -m "feat: DefaultImprover (reflect + mineSkills)"
```

---

## Task 21: Reference Profiles + Prompts

**Files:**
- Create: `profiles/coding.yaml`
- Create: `profiles/data.yaml`
- Create: `prompts/coding.md`
- Create: `prompts/data.md`

- [ ] **Step 1: Write profiles/coding.yaml**

```yaml
name: coding
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
  fallback_id: gpt-4o-mini
system_prompt: ./prompts/coding.md
working_dir: $CWD
artifact_dir: .harness/coding
skills_dirs:
  - ~/.harness/skills
  - ./.harness/skills
tools:
  builtin:
    Read: allow
    Write: allow
    Edit: allow
    Bash: prompt
    Grep: allow
    Glob: allow
    Skill: allow
    MemoryRead: allow
    MemoryWrite: allow
    MemoryList: allow
    Stats: allow
    Delegate: prompt
  mcp_servers: []
hooks:
  pre_tool: []
  post_tool: []
  on_stop: []
improvement:
  enabled: true
  mine_skills_every_n_sessions: 10
```

- [ ] **Step 2: Write profiles/data.yaml**

```yaml
name: data
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
  fallback_id: gpt-4o-mini
system_prompt: ./prompts/data.md
working_dir: $CWD
artifact_dir: .harness/data
skills_dirs:
  - ~/.harness/skills
  - ./.harness/skills
tools:
  builtin:
    Read: allow
    Write: allow
    Edit: deny
    Bash: deny
    Grep: allow
    Glob: allow
    Skill: allow
    MemoryRead: allow
    MemoryWrite: allow
    MemoryList: allow
    Stats: allow
    Delegate: prompt
  mcp_servers:
    # Uncomment and configure your DB MCP server(s):
    # - name: postgres
    #   command: postgres-mcp
    #   args: []
    #   env:
    #     DATABASE_URL: "${DATABASE_URL}"
    #   acl:
    #     "*": prompt
    #     query: allow
```

- [ ] **Step 3: Write prompts/coding.md**

```markdown
# Coding Agent

You are a coding assistant with access to files, shell commands, and version control.

## Core principles
- Read files before editing. Understand context before changing code.
- Prefer targeted edits over rewrites. Use Edit over Write for existing files.
- Run tests after changes. Use Bash to verify your work.
- Use Grep and Glob to navigate the codebase before assuming file locations.
- Write no comments unless the WHY is non-obvious.
- When stuck, read error messages carefully — they usually contain the fix.

## Working memory
Use MemoryWrite to record important context: project conventions, architecture decisions, recurring patterns, gotchas. Read it back with MemoryRead when context is relevant.

## Skills
Check available skills before starting a complex task. A skill may already define the right workflow.
```

- [ ] **Step 4: Write prompts/data.md**

```markdown
# Data Analysis Agent

You are a data analysis assistant. You write SQL, markdown reports, plans, insights, and learnings.

## Core principles
- All database queries go through MCP tools — never execute SQL directly via shell.
- Write findings to artifact files: plans/, insights/, sql/, learnings/.
- Structure SQL files clearly with comments explaining the business question.
- Summarize insights in plain language after each analysis.
- Record patterns and learnings you discover — future sessions benefit.

## Artifact structure
- `.harness/data/plans/` — analysis plans and task breakdowns
- `.harness/data/sql/` — reusable SQL queries
- `.harness/data/insights/` — findings and summaries
- `.harness/data/learnings/` — patterns and lessons learned

## Working memory
Use MemoryWrite to track: schema knowledge, team conventions, recurring business questions, data quality issues. The memory system learns from your sessions.

## Skills
Check available skills before starting. A skill may have pre-built workflows for common analysis patterns.
```

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add profiles/ prompts/
git commit -m "feat: reference profiles (coding + data) + system prompts"
```

---

## Task 22: Smoke Test — Manual Verification

- [ ] **Step 1: Start the server with coding profile**

```bash
OPENAI_API_KEY=<your-key> pnpm dev profiles/coding.yaml
```

Expected output:
```
Harness server on ws://localhost:7337 [profile: coding]
```

- [ ] **Step 2: Connect the CLI in a second terminal**

```bash
pnpm cli
```

Expected:
```
Connected to harness (ws://localhost:7337)
Commands: /exit  /cancel  /resume <session-id>
>
```

- [ ] **Step 3: Send a message that uses Read tool**

```
> List the files in the profiles/ directory
```

Expected: server logs `[tool:start] Glob {...}`, CLI shows results.

- [ ] **Step 4: Verify session was persisted**

```bash
ls ~/.harness/sessions/
```

Expected: one JSON file for your session.

- [ ] **Step 5: Verify telemetry was appended**

```bash
tail -5 ~/.harness/telemetry.jsonl
```

Expected: JSONL lines with tool and llm events.

- [ ] **Step 6: Exit and commit**

```bash
# in CLI:
/exit
```

```bash
git add -A
git commit -m "chore: verified smoke test"
```

---

## Summary

22 tasks covering the complete v1 harness:
- **Tasks 1–6:** Foundation (project, types, profile, session, telemetry, provider)
- **Tasks 7–16:** Tool system (registry, ACL, all 12 builtin tools, MCP client, hooks)
- **Tasks 14, 17–19:** Skill system + agent loop + WS server + CLI
- **Tasks 20–22:** Improver (reflect + skill mining) + reference configs + smoke test

After smoke test passes, the harness is usable. Remaining v2 work: inter-profile Delegate, cron/file/webhook triggers, branch/replay, cost-aware model routing, web UI.
