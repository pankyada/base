# Instance Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `mode:` field to profiles that sets trust-model defaults for tool ACLs and validates dangerous configuration combinations at startup.

**Architecture:** `MODE_DEFAULTS` constant in `src/profiles/schema.ts` maps each mode to a partial ACL record; `applyModeDefaults()` in `src/profiles/loader.ts` merges it over the profile's explicit `tools.builtin` (mode wins on conflict); `validateMode()` in the same file hard-errors or warns based on detected misconfigurations. No mode = zero behavior change.

**Tech Stack:** TypeScript, Zod, Vitest, js-yaml (existing)

---

## File Map

| Status | Path | Change |
|--------|------|--------|
| Modify | `src/profiles/schema.ts` | Add `mode` Zod field + `MODE_DEFAULTS` constant |
| Modify | `src/profiles/loader.ts` | Add `applyModeDefaults()` + `validateMode()`, call both in `loadProfile` |
| Create | `tests/instance-modes.test.ts` | All mode merge + validation tests |

---

## Task 1: Schema — `mode` field + `MODE_DEFAULTS`

**Files:**
- Modify: `src/profiles/schema.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/instance-modes.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProfileSchema, MODE_DEFAULTS } from '../src/profiles/schema.js'
import { applyModeDefaults, validateMode } from '../src/profiles/loader.js'

const BASE: any = {
  name: 'test',
  model: { base_url: 'https://api.openai.com/v1', api_key_env: 'KEY', id: 'gpt-4o' },
  system_prompt: './prompt.md',
  artifact_dir: '/tmp/test',
}

describe('ProfileSchema – mode field', () => {
  it('mode is optional, defaults to undefined', () => {
    const p = ProfileSchema.parse(BASE)
    expect(p.mode).toBeUndefined()
  })

  it('accepts valid mode values', () => {
    for (const mode of ['developer', 'analyst', 'assistant', 'production']) {
      const p = ProfileSchema.parse({ ...BASE, mode })
      expect(p.mode).toBe(mode)
    }
  })

  it('rejects invalid mode values', () => {
    expect(() => ProfileSchema.parse({ ...BASE, mode: 'superuser' })).toThrow()
  })

  it('MODE_DEFAULTS covers all four modes', () => {
    expect(Object.keys(MODE_DEFAULTS)).toEqual(
      expect.arrayContaining(['developer', 'analyst', 'assistant', 'production'])
    )
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/instance-modes.test.ts
```
Expected: FAIL — `mode` not in schema, `MODE_DEFAULTS` not exported

- [ ] **Step 3: Add `mode` field and `MODE_DEFAULTS` to `src/profiles/schema.ts`**

Add this block **before** the `ProfileSchema` export (after the existing `AgentEntrySchema`):

```typescript
export type AclValue = z.infer<typeof AclValue>  // re-export for MODE_DEFAULTS typing

export const MODE_DEFAULTS: Record<string, Partial<Record<string, 'allow' | 'prompt' | 'deny'>>> = {
  developer: {
    Bash: 'allow', Read: 'allow', Write: 'allow', Edit: 'allow',
    Grep: 'allow', Glob: 'allow', Skill: 'allow', Stats: 'allow',
    Delegate: 'allow', AskUser: 'allow',
    MemoryRead: 'allow', MemoryWrite: 'allow', MemoryList: 'allow', MemoryDelete: 'allow',
    TodoWrite: 'allow', TodoRead: 'allow',
    ExecuteCode: 'allow',
  },
  analyst: {
    Bash: 'deny', Write: 'deny', Edit: 'deny', Delegate: 'deny',
    Read: 'allow', ExecuteCode: 'allow', AskUser: 'allow',
    MemoryRead: 'allow', MemoryWrite: 'allow', MemoryList: 'allow', MemoryDelete: 'allow',
    TodoWrite: 'allow', TodoRead: 'allow',
  },
  assistant: {
    Bash: 'deny', Write: 'deny', Edit: 'deny', Delegate: 'deny', ExecuteCode: 'deny',
    Read: 'allow', AskUser: 'allow',
    MemoryRead: 'allow', MemoryWrite: 'allow', MemoryList: 'allow', MemoryDelete: 'allow',
    TodoWrite: 'allow', TodoRead: 'allow',
  },
  production: {
    Bash: 'deny', Write: 'deny', Edit: 'deny', Delegate: 'deny', ExecuteCode: 'deny',
    Read: 'allow', AskUser: 'allow',
    MemoryRead: 'allow', MemoryWrite: 'allow', MemoryList: 'allow', MemoryDelete: 'allow',
    TodoWrite: 'allow', TodoRead: 'allow',
  },
}
```

Add `mode` field inside `ProfileSchema`:
```typescript
mode: z.enum(['developer', 'analyst', 'assistant', 'production']).optional(),
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/instance-modes.test.ts
```
Expected: 4/4 PASS

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/profiles/schema.ts tests/instance-modes.test.ts
git commit -m "feat: add mode field and MODE_DEFAULTS to ProfileSchema"
```

---

## Task 2: Loader — `applyModeDefaults` + `validateMode`

**Files:**
- Modify: `src/profiles/loader.ts`
- Modify: `tests/instance-modes.test.ts`

- [ ] **Step 1: Write failing tests — add to `tests/instance-modes.test.ts`**

```typescript
// Add these describe blocks to the existing test file

describe('applyModeDefaults', () => {
  it('returns profile unchanged when no mode set', () => {
    const profile = ProfileSchema.parse(BASE)
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin).toEqual(profile.tools.builtin)
  })

  it('developer mode: all tools are allow', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'developer' })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.Bash).toBe('allow')
    expect(result.tools.builtin.Write).toBe('allow')
    expect(result.tools.builtin.Edit).toBe('allow')
    expect(result.tools.builtin.Delegate).toBe('allow')
    expect(result.tools.builtin.ExecuteCode).toBe('allow')
  })

  it('analyst mode: Bash/Write/Edit/Delegate are deny, ExecuteCode/Read/Memory/Todo are allow', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'analyst' })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.Bash).toBe('deny')
    expect(result.tools.builtin.Write).toBe('deny')
    expect(result.tools.builtin.Edit).toBe('deny')
    expect(result.tools.builtin.Delegate).toBe('deny')
    expect(result.tools.builtin.ExecuteCode).toBe('allow')
    expect(result.tools.builtin.Read).toBe('allow')
    expect(result.tools.builtin.MemoryWrite).toBe('allow')
    expect(result.tools.builtin.TodoWrite).toBe('allow')
  })

  it('assistant mode: additionally denies ExecuteCode', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'assistant' })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.ExecuteCode).toBe('deny')
    expect(result.tools.builtin.Bash).toBe('deny')
    expect(result.tools.builtin.MemoryRead).toBe('allow')
    expect(result.tools.builtin.TodoRead).toBe('allow')
  })

  it('production mode: danger tools deny, unlisted tools default to prompt', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'production' })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.Bash).toBe('deny')
    expect(result.tools.builtin.ExecuteCode).toBe('deny')
    expect(result.tools.builtin.Read).toBe('allow')
    expect(result.tools.builtin.MemoryRead).toBe('allow')
    // Grep/Glob/Stats/Skill not in MODE_DEFAULTS['production'] → prompt
    expect(result.tools.builtin.Grep).toBe('prompt')
    expect(result.tools.builtin.Glob).toBe('prompt')
    expect(result.tools.builtin.Stats).toBe('prompt')
    expect(result.tools.builtin.Skill).toBe('prompt')
  })

  it('mode wins over profile explicit setting on conflict', () => {
    // analyst mode denies Bash — profile trying to allow it should lose
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'analyst',
      tools: { builtin: { Bash: 'allow' } },
    })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.Bash).toBe('deny')
  })

  it('profile can configure tools the mode leaves open', () => {
    // analyst does not specify Grep — profile deny should win
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'analyst',
      tools: { builtin: { Grep: 'deny' } },
    })
    const result = applyModeDefaults(profile)
    expect(result.tools.builtin.Grep).toBe('deny')
  })
})

describe('validateMode', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { warnSpy.mockRestore() })

  it('developer mode always warns about multi-tenant risk', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'developer' })
    validateMode(applyModeDefaults(profile))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('developer mode'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('multi-tenant'))
  })

  it('analyst mode without executor warns', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'analyst' })
    validateMode(applyModeDefaults(profile))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('analyst mode without executor'))
  })

  it('analyst mode with executor does not warn about executor', () => {
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'analyst',
      executor: { default: 'docker', fallback: 'docker', docker_image: 'python:3.12-slim', timeout_ms: 30000, allowed_packages: [] },
    })
    validateMode(applyModeDefaults(profile))
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('analyst mode without executor'))
  })

  it('production mode without contract warns', () => {
    const profile = ProfileSchema.parse({ ...BASE, mode: 'production' })
    validateMode(applyModeDefaults(profile))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('production mode without contract'))
  })

  it('production mode with contract does not warn about contract', () => {
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'production',
      contract: { input: { type: 'object' }, output: { type: 'object' } },
    })
    validateMode(applyModeDefaults(profile))
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('production mode without contract'))
  })

  it('developer + cron trigger throws hard error', () => {
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'developer',
      triggers: { cron: '0 9 * * *', webhook: false },
    })
    expect(() => validateMode(applyModeDefaults(profile))).toThrow(
      /developer mode with cron\/webhook triggers/
    )
  })

  it('developer + webhook trigger throws hard error', () => {
    const profile = ProfileSchema.parse({
      ...BASE,
      mode: 'developer',
      triggers: { cron: undefined, webhook: true },
    })
    expect(() => validateMode(applyModeDefaults(profile))).toThrow(
      /developer mode with cron\/webhook triggers/
    )
  })

  it('no mode: no warnings, no errors', () => {
    const profile = ProfileSchema.parse(BASE)
    expect(() => validateMode(applyModeDefaults(profile))).not.toThrow()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/instance-modes.test.ts
```
Expected: FAIL — `applyModeDefaults` and `validateMode` not exported from loader

- [ ] **Step 3: Implement `applyModeDefaults` and `validateMode` in `src/profiles/loader.ts`**

Replace the entire file with:

```typescript
import yaml from 'js-yaml'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { ProfileSchema, Profile, MODE_DEFAULTS } from './schema.js'

function untildify(p: string): string {
  return p.startsWith('~') ? p.replace('~', homedir()) : p
}

function expandPath(p: string, cwd: string): string {
  if (p === '$CWD') return cwd
  return resolve(untildify(p))
}

export function applyModeDefaults(profile: Profile): Profile {
  if (!profile.mode) return profile

  const defaults = MODE_DEFAULTS[profile.mode]
  if (!defaults) return profile

  const merged = { ...profile.tools.builtin } as Record<string, string>

  // Mode wins where both specify the same tool
  for (const [tool, acl] of Object.entries(defaults)) {
    merged[tool] = acl
  }

  // production: all known builtin tools not explicitly set by mode or profile default to 'prompt'
  if (profile.mode === 'production') {
    const allKnownTools = [
      'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Skill', 'Stats',
      'Delegate', 'AskUser', 'MemoryRead', 'MemoryWrite', 'MemoryList', 'MemoryDelete',
      'TodoWrite', 'TodoRead', 'ExecuteCode',
    ]
    const profileBuiltin = profile.tools.builtin as Record<string, string>
    for (const tool of allKnownTools) {
      if (!(tool in defaults) && !(tool in profileBuiltin)) {
        merged[tool] = 'prompt'
      }
    }
  }

  return {
    ...profile,
    tools: {
      ...profile.tools,
      builtin: merged as typeof profile.tools.builtin,
    },
  }
}

export function validateMode(profile: Profile): void {
  if (!profile.mode) return

  // Hard errors
  if (profile.mode === 'developer' && (profile.triggers?.cron || profile.triggers?.webhook)) {
    throw new Error(
      '[mode] developer mode with cron/webhook triggers is not allowed — ' +
      'autonomous developer agents have unrestricted tool access. ' +
      'Use analyst or production mode for autonomous deployments.'
    )
  }

  // Soft warnings
  if (profile.mode === 'developer') {
    console.warn(
      '[mode] developer mode: not safe for multi-tenant deployments — ' +
      'all tools are allow by default including Bash and Write'
    )
  }

  if (profile.mode === 'analyst' && !profile.executor) {
    console.warn(
      '[mode] analyst mode without executor: block — ' +
      'ExecuteCode tool will return "not enabled" — add executor: to enable sandboxed code execution'
    )
  }

  if (profile.mode === 'production' && !profile.contract?.input && !profile.contract?.output) {
    console.warn(
      '[mode] production mode without contract: block — ' +
      'consider adding input/output contracts for type-safe production deployments'
    )
  }
}

export function loadProfile(profilePath: string): Profile {
  const raw = readFileSync(profilePath, 'utf-8')
  const parsed = yaml.load(raw)
  const validated = ProfileSchema.parse(parsed)
  const cwd = process.cwd()

  const profile: Profile = {
    ...validated,
    working_dir: expandPath(validated.working_dir, cwd),
    artifact_dir: expandPath(validated.artifact_dir, cwd),
    system_prompt: expandPath(validated.system_prompt, cwd),
  }

  const withMode = applyModeDefaults(profile)
  validateMode(withMode)
  return withMode
}
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
npx vitest run tests/instance-modes.test.ts
```
Expected: all tests PASS

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```
Expected: all tests pass — existing profile-loader and profile-schema tests unaffected

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/profiles/loader.ts tests/instance-modes.test.ts
git commit -m "feat: add applyModeDefaults and validateMode to profile loader"
```

---

## Task 3: Smoke test + ROADMAP update

- [ ] **Step 1: Build**

```bash
pnpm build
```
Expected: no errors

- [ ] **Step 2: Smoke test developer mode warning**

Create a temp profile file:
```bash
cat > /tmp/test-dev-mode.yaml << 'EOF'
name: test-dev
mode: developer
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
system_prompt: /dev/null
artifact_dir: /tmp/harness-test
EOF
node -e "
const { loadProfile } = require('./dist/profiles/loader.js')
loadProfile('/tmp/test-dev-mode.yaml')
" 2>&1
```
Expected output contains: `[mode] developer mode: not safe for multi-tenant deployments`

- [ ] **Step 3: Smoke test hard error**

```bash
cat > /tmp/test-dev-cron.yaml << 'EOF'
name: test-dev-cron
mode: developer
triggers:
  cron: "0 9 * * *"
model:
  base_url: https://api.openai.com/v1
  api_key_env: OPENAI_API_KEY
  id: gpt-4o
system_prompt: /dev/null
artifact_dir: /tmp/harness-test
EOF
node -e "
const { loadProfile } = require('./dist/profiles/loader.js')
try { loadProfile('/tmp/test-dev-cron.yaml') } catch(e) { console.log('Caught:', e.message) }
" 2>&1
```
Expected output contains: `[mode] developer mode with cron/webhook triggers is not allowed`

- [ ] **Step 4: Update ROADMAP**

In `docs/ROADMAP.md`, change `### ❌ 12.` to `### ✅ 12.` and add a "What shipped" summary after the mode table:

```markdown
**What shipped:**
- `mode: developer | analyst | assistant | production` field in `ProfileSchema`
- `MODE_DEFAULTS` constant with per-mode ACL presets; mode wins on conflict with profile `tools.builtin`
- `applyModeDefaults()` — merges mode ACLs into profile at load time; production unlisted tools → `prompt`
- `validateMode()` — hard error for developer+triggers; soft warnings for developer, analyst-without-executor, production-without-contract
```

Also update sequencing section: mark `#12` as ✅.

- [ ] **Step 5: Final commit and push**

```bash
git add docs/ROADMAP.md
git commit -m "feat: instance modes — developer/analyst/assistant/production ACL presets + startup validation (#12)"
git push
```
