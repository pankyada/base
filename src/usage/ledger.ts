import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface UsageDelta {
  input: number
  output: number
  cost_usd: number
}

export interface MonthBucket extends UsageDelta {}

export interface UserUsage {
  user: string
  total: UsageDelta
  by_month: Record<string, MonthBucket>
  updated_at: string
}

function usageDir(overrideDir?: string): string {
  return overrideDir ?? join(homedir(), '.harness', 'usage')
}

function usageFilePath(user: string, overrideDir?: string): string {
  return join(usageDir(overrideDir), `${user}.json`)
}

function emptyLedger(user: string): UserUsage {
  return {
    user,
    total: { input: 0, output: 0, cost_usd: 0 },
    by_month: {},
    updated_at: new Date().toISOString(),
  }
}

export function recordUsage(user: string, delta: UsageDelta, overrideDir?: string): void {
  const dir = usageDir(overrideDir)
  mkdirSync(dir, { recursive: true })
  const path = usageFilePath(user, overrideDir)

  let ledger: UserUsage
  try {
    ledger = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf-8')) as UserUsage)
      : emptyLedger(user)
  } catch {
    ledger = emptyLedger(user)
  }

  ledger.total.input += delta.input
  ledger.total.output += delta.output
  ledger.total.cost_usd += delta.cost_usd

  const month = new Date().toISOString().slice(0, 7)
  if (!ledger.by_month[month]) {
    ledger.by_month[month] = { input: 0, output: 0, cost_usd: 0 }
  }
  ledger.by_month[month].input += delta.input
  ledger.by_month[month].output += delta.output
  ledger.by_month[month].cost_usd += delta.cost_usd

  ledger.updated_at = new Date().toISOString()
  writeFileSync(path, JSON.stringify(ledger, null, 2), 'utf-8')
}

export function readUsage(user: string, overrideDir?: string): UserUsage | null {
  const path = usageFilePath(user, overrideDir)
  try {
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf-8')) as UserUsage)
      : null
  } catch {
    return null
  }
}
