import { AclValue } from '../types.js'
import { Profile } from '../profiles/schema.js'

export function getAcl(toolName: string, profile: Profile): AclValue {
  const builtin = profile.tools?.builtin as Record<string, AclValue> | undefined
  if (builtin && toolName in builtin) {
    return builtin[toolName]
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
