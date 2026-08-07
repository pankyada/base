import { AclValue, ApprovalMode } from '../types.js'
import type { Profile } from '../profiles/schema.js'
import { matchesPredicate, type Predicate } from './predicates.js'
import type { MemoryProvider, MemoryScope } from '../memory/interface.js'

export type ConditionalAcl = { default: AclValue; allow_if?: Predicate[]; deny_if?: Predicate[] }
export type AclConfig = AclValue | ConditionalAcl

export interface AclDecision {
  value: AclValue
  decided_by: 'default' | 'predicate' | 'mode'
  reason: string
}

const MUTATING_TOOLS = new Set(['Write', 'Edit', 'Bash', 'ExecuteCode', 'Delegate', 'MemoryWrite', 'MemoryDelete', 'Notify'])
const MEMORY_LIST_CACHE_TTL_MS = 1_000
const memoryListCache = new WeakMap<object, Map<string, { expiresAt: number; values?: unknown[] }>>()

function rawAcl(toolName: string, profile: Profile, serverName?: string): AclConfig | undefined {
  if (serverName) {
    const server = profile.tools?.mcp_servers?.find(item => item.name === serverName)
    const acl = server?.acl as Record<string, AclConfig> | undefined
    return acl?.[toolName] ?? acl?.['*']
  }
  const builtin = profile.tools?.builtin as Record<string, AclConfig> | undefined
  const custom = profile.tools?.custom as Record<string, AclConfig> | undefined
  return builtin?.[toolName] ?? builtin?.['*'] ?? custom?.[toolName] ?? custom?.['*']
}

function defaultValue(value: AclConfig | undefined): AclValue {
  return !value ? 'prompt' : typeof value === 'string' ? value : value.default
}

function configuredValue(value: AclConfig | undefined, input: Record<string, unknown>, lists: Record<string, unknown[]>): AclDecision {
  if (!value) return { value: 'prompt', decided_by: 'default', reason: 'missing ACL defaults to prompt' }
  if (typeof value === 'string') return { value, decided_by: 'default', reason: `profile ACL: ${value}` }
  if ((value.deny_if ?? []).some(rule => matchesPredicate(rule, input, lists))) {
    return { value: 'deny', decided_by: 'predicate', reason: 'deny_if matched' }
  }
  if (value.default === 'deny') return { value: 'deny', decided_by: 'default', reason: 'profile ACL deny is absolute' }
  if ((value.allow_if ?? []).length > 0 && value.allow_if!.every(rule => matchesPredicate(rule, input, lists))) {
    return { value: 'allow', decided_by: 'predicate', reason: 'allow_if matched' }
  }
  return { value: value.default, decided_by: 'default', reason: `conditional ACL default: ${value.default}` }
}

function modeDecision(toolName: string, decision: AclDecision, mode: ApprovalMode, serverName?: string): AclDecision {
  if (decision.value === 'deny') return decision
  if (mode === 'yolo') return { value: 'allow', decided_by: 'mode', reason: 'yolo mode' }
  if (mode === 'strict') return { value: serverName ? 'prompt' : MUTATING_TOOLS.has(toolName) ? 'prompt' : 'allow', decided_by: 'mode', reason: 'strict mode' }
  if (mode === 'bash') return { value: toolName === 'Bash' || toolName === 'ExecuteCode' ? 'prompt' : 'allow', decided_by: 'mode', reason: 'bash mode' }
  return decision
}

function referencedMemoryLists(value: AclConfig | undefined, profile: Profile): Set<string> {
  if (!value || typeof value === 'string') return new Set()
  const sources = new Set<string>()
  for (const rule of [...(value.allow_if ?? []), ...(value.deny_if ?? [])]) {
    if (rule.in_list && typeof profile.lists?.[rule.in_list] === 'string') sources.add(rule.in_list)
  }
  return sources
}

export function getAcl(toolName: string, profile: Profile): AclValue {
  return defaultValue(rawAcl(toolName, profile))
}

export function getMcpAcl(serverName: string, toolName: string, profile: Profile): AclValue {
  if (!profile.tools?.mcp_servers?.some(server => server.name === serverName)) return 'deny'
  return defaultValue(rawAcl(toolName, profile, serverName))
}

export function resolveAclDecision(
  toolName: string,
  input: Record<string, unknown>,
  profile: Profile,
  mode: ApprovalMode = 'danger',
  serverName?: string,
): AclDecision {
  const raw = rawAcl(toolName, profile, serverName)
  const memoryLists = referencedMemoryLists(raw, profile)
  if (memoryLists.size > 0) return { value: 'deny', decided_by: 'predicate', reason: 'memory list requires async resolution' }
  const lists = Object.fromEntries(Object.entries(profile.lists ?? {}).filter(([, value]) => Array.isArray(value))) as Record<string, unknown[]>
  return modeDecision(toolName, configuredValue(raw, input, lists), mode, serverName)
}

/** Resolve memory-backed lists with a short cache. Any source failure denies. */
export async function resolveAclDecisionWithMemory(
  toolName: string,
  input: Record<string, unknown>,
  profile: Profile,
  memory: MemoryProvider,
  mode: ApprovalMode = 'danger',
  serverName?: string,
): Promise<AclDecision> {
  const lists: Record<string, unknown[]> = {}
  const unavailable = new Set<string>()
  let cache = memoryListCache.get(memory as object)
  if (!cache) {
    cache = new Map()
    memoryListCache.set(memory as object, cache)
  }

  for (const [name, source] of Object.entries(profile.lists ?? {})) {
    if (Array.isArray(source)) {
      lists[name] = source
      continue
    }
    if (typeof source !== 'string') {
      unavailable.add(name)
      continue
    }
    const match = /^memory:(session|profile|user|project)\/(.+)$/.exec(source)
    if (!match) {
      unavailable.add(name)
      continue
    }
    const cached = cache.get(source)
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.values) lists[name] = cached.values
      else unavailable.add(name)
      continue
    }
    try {
      const record = await memory.read(match[1] as MemoryScope, match[2])
      const parsed = record ? JSON.parse(record.content) : null
      if (!Array.isArray(parsed)) throw new Error('memory list is not a JSON array')
      const values = [...parsed]
      lists[name] = values
      cache.set(source, { expiresAt: Date.now() + MEMORY_LIST_CACHE_TTL_MS, values })
    } catch {
      unavailable.add(name)
      cache.set(source, { expiresAt: Date.now() + MEMORY_LIST_CACHE_TTL_MS })
    }
  }

  const raw = rawAcl(toolName, profile, serverName)
  if (raw && typeof raw !== 'string') {
    const references = [...(raw.allow_if ?? []), ...(raw.deny_if ?? [])]
      .filter(rule => rule.in_list)
      .map(rule => rule.in_list!)
    if (references.some(name => unavailable.has(name))) {
      return { value: 'deny', decided_by: 'predicate', reason: 'memory list unavailable' }
    }
  }
  return modeDecision(toolName, configuredValue(raw, input, lists), mode, serverName)
}

/** Resolve the legacy mode-only ACL without relaxing a configured deny. */
export function resolveAcl(toolName: string, profile: Profile, mode: ApprovalMode = 'danger', serverName?: string): AclValue {
  const value = serverName ? getMcpAcl(serverName, toolName, profile) : getAcl(toolName, profile)
  return modeDecision(toolName, { value, decided_by: 'default', reason: 'profile ACL' }, mode, serverName).value
}
