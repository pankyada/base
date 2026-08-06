import yaml from 'js-yaml'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { homedir } from 'os'
import { ProfileSchema, Profile, MODE_DEFAULTS } from './schema.js'
import { MODEL_REGISTRY } from '../models/registry.js'

function untildify(p: string): string {
  return p.startsWith('~') ? p.replace('~', homedir()) : p
}

// base defaults to cwd so working_dir/artifact_dir keep resolving against the
// launch directory (matches the documented $CWD sentinel); system_prompt
// passes the profile file's own directory so it doesn't depend on launch cwd.
function expandPath(p: string, cwd: string, base: string = cwd): string {
  if (p === '$CWD') return cwd
  return resolve(base, untildify(p))
}

export function applyModeDefaults(profile: Profile): Profile {
  if (!profile.mode) return profile

  const defaults = MODE_DEFAULTS[profile.mode]
  if (!defaults) return profile

  const merged = { ...profile.tools.builtin } as Record<string, string>

  // Mode wins where both specify the same tool
  for (const [tool, acl] of Object.entries(defaults)) {
    if (acl !== undefined) merged[tool] = acl
  }

  // production: all known builtin tools not covered by mode defaults to 'prompt'
  // (overrides schema defaults — only explicit user-set values in profile.tools.builtin
  //  that are NOT also set by mode defaults are preserved)
  if (profile.mode === 'production') {
    const allKnownTools = [
      'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Skill', 'Stats',
      'Delegate', 'AskUser', 'MemoryRead', 'MemoryWrite', 'MemoryList', 'MemoryDelete',
      'TodoWrite', 'TodoRead', 'ExecuteCode',
    ]
    for (const tool of allKnownTools) {
      if (!(tool in defaults)) {
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

function providerForModel(id: string): string {
  const registered = MODEL_REGISTRY.find(model => model.id === id)
  if (registered) return registered.provider
  if (id.toLowerCase().startsWith('claude')) return 'Anthropic'
  if (id.toLowerCase().startsWith('gpt') || id.toLowerCase().startsWith('o')) return 'OpenAI'
  return 'unknown'
}

export function validateWorkflowModels(profile: Profile): void {
  if (!profile.workflow?.enabled || !profile.models?.roles) return
  const buildTier = profile.workflow.routing.table.build ?? 'balanced'
  const build = profile.models.roles[buildTier] ?? profile.model.id
  const critic = profile.models.roles.critic ?? profile.model.id
  if (providerForModel(build) === providerForModel(critic) && providerForModel(build) !== 'unknown') {
    console.warn(`[workflow] critic and build roles share ${providerForModel(build)} model family; review diversity is reduced`)
  }
}

export function loadProfile(profilePath: string): Profile {
  const raw = readFileSync(profilePath, 'utf-8')
  const parsed = yaml.load(raw)
  const validated = ProfileSchema.parse(parsed)
  const cwd = process.cwd()
  const profileDir = dirname(resolve(profilePath))

  const profile: Profile = {
    ...validated,
    working_dir: expandPath(validated.working_dir, cwd),
    artifact_dir: expandPath(validated.artifact_dir, cwd),
    system_prompt: expandPath(validated.system_prompt, cwd, profileDir),
  }

  const withMode = applyModeDefaults(profile)
  validateMode(withMode)
  validateWorkflowModels(withMode)
  return withMode
}
