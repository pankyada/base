import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Run } from './types.js'
import { sanitizeUserId } from '../session/user-paths.js'

function runsDir(user: string): string {
  return join(homedir(), '.harness', 'runs', sanitizeUserId(user))
}

function allRunsBase(): string {
  return join(homedir(), '.harness', 'runs')
}

export class RunStore {
  create(run: Run): void {
    const dir = runsDir(run.user)
    mkdirSync(dir, { recursive: true })
    const date = run.started_at.slice(0, 10)
    writeFileSync(join(dir, `${date}_${run.id}.json`), JSON.stringify(run, null, 2), 'utf-8')
  }

  update(id: string, patch: Partial<Run>): void {
    const run = this.get(id)
    if (!run) return
    const updated = { ...run, ...patch }
    const dir = runsDir(run.user)
    const date = run.started_at.slice(0, 10)
    writeFileSync(join(dir, `${date}_${id}.json`), JSON.stringify(updated, null, 2), 'utf-8')
  }

  get(id: string): Run | null {
    const base = allRunsBase()
    if (!existsSync(base)) return null
    for (const userDir of readdirSync(base, { withFileTypes: true })) {
      if (!userDir.isDirectory()) continue
      const dir = join(base, userDir.name)
      const files = readdirSync(dir)
      const match = files.find(f => f.includes(id) && f.endsWith('.json'))
      if (match) {
        try {
          return JSON.parse(readFileSync(join(dir, match), 'utf-8')) as Run
        } catch { return null }
      }
    }
    return null
  }

  list(opts: { user?: string; status?: Run['status']; profile?: string; limit?: number } = {}): Run[] {
    const { user, status, profile, limit = 50 } = opts
    const base = allRunsBase()
    if (!existsSync(base)) return []
    const userDirs = user
      ? [sanitizeUserId(user)]
      : readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    const runs: Run[] = []
    for (const u of userDirs) {
      const dir = join(base, u)
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue
        try {
          const run = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Run
          if (status && run.status !== status) continue
          if (profile && run.profile !== profile) continue
          runs.push(run)
        } catch { /* skip corrupt files */ }
      }
    }
    return runs.slice(0, limit)
  }

  scanRunning(): Run[] {
    return this.list({ status: 'running', limit: 1000 })
  }
}
