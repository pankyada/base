import type { ToolEffect } from './types.js'

export const EFFECTS: Record<string, ToolEffect> = {
  Read: 'read', Grep: 'read', Glob: 'read', MemoryRead: 'read', MemoryList: 'read', Recall: 'read', Stats: 'read', Skill: 'read', TodoRead: 'read',
  Write: 'write', Edit: 'write', MemoryWrite: 'write', TodoWrite: 'write',
  Notify: 'outbound',
  WebFetch: 'outbound', WebSearch: 'outbound',
  Bash: 'destructive', ExecuteCode: 'destructive', MemoryDelete: 'destructive', Delegate: 'destructive', DelegateFanout: 'destructive',
}

export function isMutatingEffect(effect: ToolEffect): boolean {
  return effect !== 'read'
}

export function effectFor(tool: string, isMcp = false, declared?: ToolEffect): ToolEffect {
  if (declared) return declared
  if (EFFECTS[tool]) return EFFECTS[tool]
  if (!isMcp) return 'outbound'
  return /^(get|list|read|search|fetch|find|query)/i.test(tool) ? 'read' : 'outbound'
}

export function isGatedEffect(effect: ToolEffect, gateWrites = false): boolean {
  return effect === 'outbound' || effect === 'destructive' || (gateWrites && effect === 'write')
}
