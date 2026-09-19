import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { sanitizeUserId } from '../session/user-paths.js'
import { harnessStatePath } from '../config/state-paths.js'

export interface CursorRecord { value?: string; updated_at: string; consecutive_errors: number }

function safePart(value: string): string { return value.replace(/[^A-Za-z0-9._-]/g, '_') }

function pathFor(user: string, profile: string, name: string): string {
  return harnessStatePath('cursors', sanitizeUserId(user), `${safePart(profile)}__${safePart(name)}.json`)
}

export class CursorStore {
  read(user: string, profile: string, name: string): CursorRecord | null {
    const path = pathFor(user, profile, name)
    if (!existsSync(path)) return null
    try {
      const value = JSON.parse(readFileSync(path, 'utf-8'))
      return Number.isInteger(value.consecutive_errors) && value.consecutive_errors >= 0 && typeof value.updated_at === 'string' && (value.value === undefined || typeof value.value === 'string') ? value : null
    } catch { return null }
  }

  write(user: string, profile: string, name: string, record: CursorRecord): void {
    const path = pathFor(user, profile, name)
    mkdirSync(join(path, '..'), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(record, null, 2), 'utf-8')
    renameSync(temp, path)
  }
}
