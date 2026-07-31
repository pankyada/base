import { AclValue, ApprovalMode } from '../types.js'
import { Profile } from '../profiles/schema.js'

export function getAcl(toolName: string, profile: Profile): AclValue {
  const builtin = profile.tools?.builtin as Record<string, AclValue> | undefined
  if (builtin && toolName in builtin) {
    return builtin[toolName]
  }
  if (builtin && '*' in builtin) {
    return builtin['*']
  }

  // Fallback to custom tools ACL
  const custom = profile.tools?.custom as Record<string, AclValue> | undefined
  if (custom) {
    return custom[toolName] ?? custom['*'] ?? 'prompt'
  }

  return 'prompt'
}

export function getMcpAcl(serverName: string, toolName: string, profile: Profile): AclValue {
  const server = profile.tools?.mcp_servers?.find(s => s.name === serverName)
  if (!server) return 'deny'
  const acl = server.acl as Record<string, AclValue>
  return acl[toolName] ?? acl['*'] ?? 'prompt'
}

const MUTATING_TOOLS = new Set(['Write', 'Edit', 'Bash', 'ExecuteCode', 'Delegate', 'MemoryWrite', 'MemoryDelete'])

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
