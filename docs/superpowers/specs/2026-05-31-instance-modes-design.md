# Instance Modes — Design Spec

> **Status:** Approved for implementation
> **Date:** 2026-05-31
> **Roadmap item:** #12

---

## Goal

Add a first-class `mode:` field to profiles that sets the trust model and default tool ACLs for a deployment. Operators state their intent once; the harness enforces it. Misconfigured combinations are caught at startup before they can cause harm.

---

## Architecture

A `MODE_DEFAULTS` constant in `src/profiles/schema.ts` maps each mode to a partial ACL record covering only the tools the mode has an explicit opinion on. At profile load time in `src/profiles/loader.ts`, mode defaults are merged over the resolved `tools.builtin` ACLs: **mode wins where both specify the same tool; profile controls everything the mode leaves open.**

Startup validation runs after the merge and either hard-errors or warns based on the severity of any detected misconfiguration.

No mode = current behavior unchanged. All existing profiles keep working.

---

## Profile Schema

New optional field in `ProfileSchema` (`src/profiles/schema.ts`):

```typescript
mode: z.enum(['developer', 'analyst', 'assistant', 'production']).optional()
```

---

## MODE_DEFAULTS

Defined as a constant in `src/profiles/schema.ts`. Each mode only specifies tools it has an explicit opinion on — profile configures the rest.

```typescript
export const MODE_DEFAULTS: Record<string, Partial<Record<string, AclValue>>> = {
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
    // Tools NOT listed here default to 'prompt' in production (see merge logic below)
  },
}
```

**Mode descriptions:**

| Mode | Analogy | Trust level |
|------|---------|-------------|
| `developer` | Claude Code | Full access — single-tenant, operator owns the machine |
| `analyst` | Notebook AI | Sandboxed code only — no shell, no file writes |
| `assistant` | ChatGPT-style | Conversation + memory only — no exec, no writes |
| `production` | Customer-facing | Explicit allowlist — everything not listed defaults to `prompt` |

---

## Merge Logic (`src/profiles/loader.ts`)

Applied immediately after `ProfileSchema.parse()`:

```typescript
function applyModeDefaults(profile: Profile): Profile {
  if (!profile.mode) return profile

  const defaults = MODE_DEFAULTS[profile.mode]
  if (!defaults) return profile

  // Start with profile's explicit builtin ACLs
  const merged = { ...profile.tools.builtin }

  // Mode wins where both specify the same tool
  for (const [tool, acl] of Object.entries(defaults)) {
    merged[tool as keyof typeof merged] = acl
  }

  // production: tools not explicitly set by mode or profile default to 'prompt'
  if (profile.mode === 'production') {
    for (const tool of Object.keys(merged) as Array<keyof typeof merged>) {
      if (!(tool in defaults) && !(tool in profile.tools.builtin)) {
        merged[tool] = 'prompt'
      }
    }
  }

  return {
    ...profile,
    tools: { ...profile.tools, builtin: merged },
  }
}
```

---

## Startup Validation (`src/profiles/loader.ts`)

Runs after `applyModeDefaults`. Called from `loadProfile()`.

### Hard errors — server refuses to start

```typescript
// developer mode + autonomous triggers = high-risk unattended execution
if (profile.mode === 'developer' && (profile.triggers?.cron || profile.triggers?.webhook)) {
  throw new Error(
    '[mode] developer mode with cron/webhook triggers is not allowed — ' +
    'autonomous developer agents have unrestricted tool access. ' +
    'Use analyst or production mode for autonomous deployments.'
  )
}
```

### Soft warnings — logged at startup, server continues

```typescript
if (profile.mode === 'developer') {
  console.warn('[mode] developer mode: not safe for multi-tenant deployments — ' +
    'all tools are allow by default including Bash and Write')
}

if (profile.mode === 'analyst' && !profile.executor) {
  console.warn('[mode] analyst mode without executor: block — ' +
    'ExecuteCode tool will return "not enabled" — add executor: to enable sandboxed code execution')
}

if (profile.mode === 'production' && (!profile.contract?.input && !profile.contract?.output)) {
  console.warn('[mode] production mode without contract: block — ' +
    'consider adding input/output contracts for type-safe production deployments')
}
```

**MCP tools in production mode:** `applyModeDefaults` only touches `tools.builtin`. MCP ACLs (`tools.mcp_servers[].acl`) are not modified by mode — they remain as configured in the profile. Operators of production deployments should set `acl: { "*": "prompt" }` (already the Zod default) on any MCP servers.

---

## Files Created / Modified

| Status | Path | Change |
|--------|------|--------|
| Modify | `src/profiles/schema.ts` | Add `mode` field to `ProfileSchema`; add `MODE_DEFAULTS` constant |
| Modify | `src/profiles/loader.ts` | Add `applyModeDefaults()` call + startup validation after parse |

---

## Testing Strategy

- **`tests/instance-modes.test.ts`** — unit tests covering:
  - `developer` mode: all tools resolved to `allow`; profile ACL settings overridden by mode
  - `analyst` mode: `Bash`/`Write`/`Edit`/`Delegate` are `deny`; `ExecuteCode`/`Read`/Memory/Todo are `allow`; profile can configure unlisted tools
  - `assistant` mode: additionally `ExecuteCode` is `deny`
  - `production` mode: danger tools denied; unlisted tools default to `prompt`
  - No mode: profile ACLs unchanged
  - Hard error: `developer` + `triggers.cron` throws
  - Hard error: `developer` + `triggers.webhook` throws
  - Soft warnings: `developer`, `analyst` without executor, `production` without contract — `console.warn` called with expected message
  - Profile `tools.builtin` can configure tools the mode leaves open (e.g. `Grep: deny` in `analyst` mode works since mode doesn't specify Grep)

---

## Example Profiles

**Analyst profile:**
```yaml
name: data-analyst
mode: analyst
executor:
  default: wasm
  fallback: docker
  docker_image: python:3.12-slim
# Bash, Write, Edit, Delegate → deny (from mode)
# ExecuteCode, Read, Memory, Todo → allow (from mode)
# Grep: deny  ← profile can still restrict what mode leaves open
tools:
  builtin:
    Grep: deny
```

**Production profile:**
```yaml
name: customer-assistant
mode: production
contract:
  input:
    type: object
    properties:
      query: { type: string }
  output:
    type: object
    properties:
      answer: { type: string }
# Dangerous tools → deny (from mode)
# Memory, Todo, Read, AskUser → allow (from mode)
# Everything else → prompt (production default for unlisted tools)
```
