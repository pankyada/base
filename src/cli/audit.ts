import { existsSync } from 'fs'
import { homedir, userInfo } from 'os'
import { resolve } from 'path'
import { findAuditEntry, listAudit } from '../audit/query.js'
import { undoAuditEntry } from '../audit/undo.js'

export interface AuditOutput {
  log(message: string): void
  error(message: string): void
}

const defaultOutput: AuditOutput = { log: console.log, error: console.error }

export async function runAuditCommand(args: string[], output: AuditOutput = defaultOutput): Promise<number> {
  const user = process.env.HARNESS_USER ?? userInfo().username
  const tool = valueAfter(args, '--tool')
  const sinceValue = valueAfter(args, '--since')
  const undoID = valueAfter(args, '--undo')

  if (args.includes('--since') && !sinceValue) {
    output.error('usage: harness audit [--undo <id>] [--since <ISO-date>] [--tool <name>]')
    return 1
  }
  const since = sinceValue ? new Date(sinceValue) : undefined
  if (since && Number.isNaN(since.getTime())) {
    output.error(`invalid --since date: ${sinceValue}`)
    return 1
  }

  if (!undoID) {
    for (const entry of listAudit(user, tool, since)) output.log(JSON.stringify(entry))
    return 0
  }

  const entry = findAuditEntry(user, undoID)
  if (!entry) {
    output.error(`audit entry not found: ${undoID}`)
    return 1
  }
  if (!entry.undo) {
    output.error(`audit entry ${undoID} is not undoable`)
    return 1
  }
  const profilePath = resolve(homedir(), '.harness', 'profiles', `${entry.profile}.yaml`)
  if (entry.undo.kind === 'memory_restore' && !existsSync(profilePath)) {
    output.error(`cannot undo memory entry: profile "${entry.profile}" is unavailable`)
    return 1
  }
  output.log(await undoAuditEntry(entry, existsSync(profilePath) ? profilePath : ''))
  return 0
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  const value = index >= 0 ? args[index + 1] : undefined
  return value && !value.startsWith('--') ? value : undefined
}
