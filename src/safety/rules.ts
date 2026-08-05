import { homedir } from 'os'
import { isAbsolute, relative, resolve } from 'path'
import type { RiskLevel } from '../types.js'

export interface StaticVerdict {
  risk: RiskLevel
  reason: string
}

const SAFE_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'Skill', 'Stats', 'MemoryRead', 'MemoryList', 'Recall', 'TodoRead', 'TodoWrite',
])

const DANGER_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-[^\s]*r[^\s]*f[^\s]*(?:\s|$)/i, reason: 'destructive filesystem removal' },
  { pattern: /\bmkfs(?:\.[\w-]+)?\b/i, reason: 'filesystem formatting' },
  { pattern: /\bdd\s+if=/i, reason: 'raw disk overwrite' },
  { pattern: /:\(\)\s*\{/, reason: 'fork bomb' },
  { pattern: /\bchmod\s+777\b/i, reason: 'world-writable permissions' },
  { pattern: /\bsudo\b/i, reason: 'privileged command' },
  { pattern: /\b(?:curl|wget)\b[\s\S]*\|\s*(?:sh|bash)\b/i, reason: 'remote script execution' },
  { pattern: /\bgit\s+push\b[\s\S]*--force(?:\s|$)/i, reason: 'forced remote history rewrite' },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: 'discarding local changes' },
  { pattern: /\bnpm\s+publish\b/i, reason: 'publishing a package' },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: 'raw disk overwrite' },
  { pattern: /\bkill\s+-9\s+1\b/i, reason: 'terminating the init process' },
  { pattern: /\bshutdown\b/i, reason: 'system shutdown' },
  { pattern: /\btruncate\s+-s\s+0\b/i, reason: 'erasing file contents' },
]

export function escapesWorkingDir(input: Record<string, unknown>, workingDir: string): boolean {
  const root = resolve(workingDir || process.cwd())
  const candidates: string[] = []
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string' && (key === 'path' || key === 'file_path' || key.endsWith('_path'))) candidates.push(value)
    else if (Array.isArray(value)) value.forEach(item => visit(item, key))
    else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => visit(child, childKey))
  }
  visit(input)
  return candidates.some(candidate => {
    const expanded = candidate === '~' || candidate.startsWith('~/') ? homedir() + candidate.slice(1) : candidate
    const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(root, expanded)
    const rel = relative(root, absolute)
    return rel === '..' || rel.startsWith(`..${requireSeparator()}`) || isAbsolute(rel)
  })
}

function requireSeparator(): string { return '/' }

export function classifyStatic(toolName: string, input: Record<string, unknown>, workingDir: string): StaticVerdict {
	if (escapesWorkingDir(input, workingDir)) return { risk: 'danger', reason: 'path leaves working directory' }
	if (SAFE_TOOLS.has(toolName)) return { risk: 'safe', reason: 'read-only tool' }
  const command = typeof input.command === 'string' ? input.command : ''
  for (const entry of DANGER_PATTERNS) {
    if (entry.pattern.test(command)) return { risk: 'danger', reason: entry.reason }
  }
  return { risk: 'caution', reason: 'tool needs a trust decision' }
}

export function dangerPatterns(): ReadonlyArray<{ pattern: RegExp; reason: string }> {
  return DANGER_PATTERNS
}
