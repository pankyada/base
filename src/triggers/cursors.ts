import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { sanitizeUserId } from '../session/user-paths.js'

export interface CursorRecord { value?: string; updated_at: string; consecutive_errors: number }

function pathFor(user: string, profile: string, name: string): string {
  return join(homedir(), '.harness', 'cursors', sanitizeUserId(user), `${profile}__${name}.json`)
}

export class CursorStore {
  read(user: string, profile: string, name: string): CursorRecord | null {
    const path = pathFor(user, profile, name)
    if (!existsSync(path)) return null
    try {
      const value = JSON.parse(readFileSync(path, 'utf-8'))
      return typeof value.consecutive_errors === 'number' && (value.value === undefined || typeof value.value === 'string') ? value : null
    } catch { return null }
  }

  write(user: string, profile: string, name: string, record: CursorRecord): void {
    const path = pathFor(user, profile, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(record, null, 2), 'utf-8')
  }
}
