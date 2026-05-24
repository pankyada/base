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
