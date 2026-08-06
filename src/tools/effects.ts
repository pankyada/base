import type { ToolEffect } from './types.js'

const EFFECTS: Record<string, ToolEffect> = {
  Read: 'read', Grep: 'read', Glob: 'read', MemoryRead: 'read', MemoryList: 'read', Recall: 'read', Stats: 'read', Skill: 'read', TodoRead: 'read',
  Write: 'write', Edit: 'write', MemoryWrite: 'write', TodoWrite: 'write',
  Notify: 'outbound',
  Bash: 'destructive', ExecuteCode: 'destructive', MemoryDelete: 'destructive', Delegate: 'destructive', DelegateFanout: 'destructive',
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
