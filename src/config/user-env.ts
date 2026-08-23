import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export type UserEnv = Record<string, string>
export type UserEnvWarning = (message: string) => void

export function userEnvPath(homeDir = homedir()): string {
  return join(homeDir, '.harness', 'env')
}

/** Load user-managed keys without overriding an explicit process environment. */
export function loadUserEnv(homeDir = homedir(), environment: NodeJS.ProcessEnv = process.env, warn: UserEnvWarning = console.warn): UserEnv {
  const path = userEnvPath(homeDir)
  if (!existsSync(path)) return {}

  const values: UserEnv = {}
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const parsed = parseLine(line)
    if (parsed === 'skip') continue
    if (!parsed) {
      warn(`[env] skipped malformed entry in ${path}`)
      continue
    }
    const [key, value] = parsed
    values[key] = value
    if (environment[key] === undefined) environment[key] = value
  }
  return values
}

/** Update one key while preserving the other user-managed entries. */
export function writeUserEnv(key: string, value: string, homeDir = homedir()): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid environment key: ${key}`)
  if (/[\r\n]/.test(value)) throw new Error('environment values cannot contain newlines')

  const path = userEnvPath(homeDir)
  mkdirSync(join(homeDir, '.harness'), { recursive: true })
  const lines = existsSync(path) ? readFileSync(path, 'utf-8').split(/\r?\n/) : []
  if (lines.at(-1) === '') lines.pop()
  let replaced = false
  const next = lines.map(line => {
    const parsed = parseLine(line)
    if (parsed && parsed !== 'skip' && parsed[0] === key) {
      replaced = true
      return `${key}=${value}`
    }
    return line
  })
  if (!replaced) next.push(`${key}=${value}`)
  const content = `${next.join('\n')}\n`
  writeFileSync(path, content, { encoding: 'utf-8', mode: 0o600 })
  chmodSync(path, 0o600)
}

function parseLine(line: string): [string, string] | 'skip' | undefined {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return 'skip'
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
  if (!match) return undefined
  return [match[1], stripQuotes(match[2].trim())]
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) return value.slice(1, -1)
  return value
}
