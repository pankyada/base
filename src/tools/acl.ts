import { AclValue, ApprovalMode } from '../types.js'
import { Profile } from '../profiles/schema.js'
import { matchesPredicate, type Predicate } from './predicates.js'

type ConditionalAcl = { default: AclValue; allow_if?: Predicate[]; deny_if?: Predicate[] }
type AclConfig = AclValue | ConditionalAcl

export interface AclDecision { value: AclValue; decided_by: 'default' | 'predicate' | 'mode'; reason: string }

function configuredValue(value: AclConfig | undefined, input: Record<string, unknown>, lists: Record<string, unknown[]>): AclDecision {
  if (!value) return { value: 'prompt', decided_by: 'default', reason: 'missing ACL defaults to prompt' }
  if (typeof value === 'string') return { value, decided_by: 'default', reason: 'profile ACL' }
  if ((value.deny_if ?? []).some(rule => matchesPredicate(rule, input, lists))) return { value: 'deny', decided_by: 'predicate', reason: 'deny_if matched' }
  if ((value.allow_if ?? []).length > 0 && (value.allow_if ?? []).every(rule => matchesPredicate(rule, input, lists))) return { value: 'allow', decided_by: 'predicate', reason: 'allow_if matched' }
  return { value: value.default, decided_by: 'default', reason: 'conditional ACL default' }
}

export function getAcl(toolName: string, profile: Profile): AclValue {
  const builtin = profile.tools?.builtin as Record<string, AclConfig> | undefined
  if (builtin && toolName in builtin) {
    const value = builtin[toolName]; return typeof value === 'string' ? value : value.default
  }
  if (builtin && '*' in builtin) {
    const value = builtin['*']; return typeof value === 'string' ? value : value.default
  }

  // Fallback to custom tools ACL
  const custom = profile.tools?.custom as Record<string, AclConfig> | undefined
  if (custom) {
    const value = custom[toolName] ?? custom['*']; return typeof value === 'string' ? value : value?.default ?? 'prompt'
  }

  return 'prompt'
}

export function getMcpAcl(serverName: string, toolName: string, profile: Profile): AclValue {
  const server = profile.tools?.mcp_servers?.find(s => s.name === serverName)
  if (!server) return 'deny'
  const acl = server.acl as Record<string, AclConfig>
  const value = acl[toolName] ?? acl['*']; return typeof value === 'string' ? value : value?.default ?? 'prompt'
}

export function resolveAclDecision(toolName: string, input: Record<string, unknown>, profile: Profile, mode: ApprovalMode = 'danger', serverName?: string): AclDecision {
  const lists = (profile.lists ?? {}) as Record<string, unknown[]>
  const raw = serverName
    ? (profile.tools.mcp_servers.find(server => server.name === serverName)?.acl as Record<string, AclConfig> | undefined)?.[toolName]
    : ((profile.tools.builtin as Record<string, AclConfig>)[toolName] ?? (profile.tools.builtin as Record<string, AclConfig>)['*'] ?? (profile.tools.custom as Record<string, AclConfig>)[toolName] ?? (profile.tools.custom as Record<string, AclConfig>)['*'])
  const decision = configuredValue(raw, input, lists)
  if (decision.value === 'deny') return decision
  if (mode === 'yolo') return { value: 'allow', decided_by: 'mode', reason: 'yolo mode' }
  if (mode === 'strict') return { value: serverName ? 'prompt' : MUTATING_TOOLS.has(toolName) ? 'prompt' : 'allow', decided_by: 'mode', reason: 'strict mode' }
  if (mode === 'bash') return { value: toolName === 'Bash' || toolName === 'ExecuteCode' ? 'prompt' : 'allow', decided_by: 'mode', reason: 'bash mode' }
  return decision
}

const MUTATING_TOOLS = new Set(['Write', 'Edit', 'Bash', 'ExecuteCode', 'Delegate', 'MemoryWrite', 'MemoryDelete', 'Notify'])

function baseAcl(toolName: string, profile: Profile, serverName?: string): AclValue {
  return serverName ? getMcpAcl(serverName, toolName, profile) : getAcl(toolName, profile)
}

/** Resolve the connection trust mode without ever relaxing a profile deny. */
export function resolveAcl(toolName: string, profile: Profile, mode: ApprovalMode = 'danger', serverName?: string): AclValue {
  const configured = baseAcl(toolName, profile, serverName)
  if (configured === 'deny') return 'deny'
  if (mode === 'yolo') return 'allow'
  if (mode === 'strict') return serverName ? 'prompt' : MUTATING_TOOLS.has(toolName) ? 'prompt' : 'allow'
  if (mode === 'bash') return toolName === 'Bash' || toolName === 'ExecuteCode' ? 'prompt' : 'allow'
  return configured
}
