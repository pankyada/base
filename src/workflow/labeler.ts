import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { Profile } from '../profiles/schema.js'
import type { Session } from '../session/types.js'
import { sanitizeProjectId, sanitizeUserId } from '../session/user-paths.js'
import { logEvent } from '../telemetry/logger.js'

const execFileAsync = promisify(execFile)

export interface TaskOutcome {
  task_id: string
  session: string
  profile: string
  stages_run: number
  rework_count: number
  escalations: number
  verify_first_try: boolean
  review_findings: { high: number; med: number; low: number }
  total_cost_usd: number
  verdict: 'accepted' | 'reworked' | 'abandoned'
  reason?: string
  project?: string
}

interface LabelRecord {
  task_id: string
  paths: string[]
  recorded_at: string
  working_dir: string
  base_commit?: string
  labeled_at?: string
}

export function emitTaskOutcome(session: Session, task: Omit<TaskOutcome, 'session' | 'profile' | 'total_cost_usd'> & Partial<Pick<TaskOutcome, 'total_cost_usd'>>): void {
  const outcome: TaskOutcome = {
    ...task,
    session: session.id,
    profile: session.profile,
    total_cost_usd: task.total_cost_usd ?? session.usage.cost_usd,
  }
  logEvent({ kind: 'outcome', ...outcome })
}

function currentCommit(workingDir: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workingDir, timeout: 3_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined
  } catch {
    return undefined
  }
}

function writeLabel(dir: string, task_id: string, paths: string[], working_dir: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${task_id}.json`)
  const data: LabelRecord = {
    task_id,
    paths: [...new Set((paths ?? []).filter(Boolean))],
    recorded_at: new Date().toISOString(),
    working_dir,
  }
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8')
  const base_commit = currentCommit(working_dir)
  if (base_commit) {
    try { writeFileSync(path, JSON.stringify({ ...data, base_commit }, null, 2), 'utf8') } catch { /* best effort */ }
  }
  return path
}

// Session-scoped: labels land under the same per-user/per-project tree as
// project memory (session/user-paths.ts), so two users on the same profile
// never share a churn bucket and sweepDeferredLabels can be scoped the same
// way at session start.
export function recordWrittenFiles(profile: Profile, session: Session, task_id: string, paths: string[]): string
// Legacy/direct form for callers with no session context (tests, one-shot
// scripts) — falls back to a single process-wide bucket, not per-user.
export function recordWrittenFiles(task_id: string, paths: string[]): string
export function recordWrittenFiles(a: Profile | string, b: Session | string[], c?: string, d?: string[]): string {
  if (typeof a === 'string') {
    const dir = join(process.env.HARNESS_ARTIFACT_DIR ?? join(homedir(), '.harness'), 'workflow', 'labels')
    return writeLabel(dir, a, b as string[], process.cwd())
  }
  const profile = a
  const session = b as Session
  const task_id = c!
  const paths = d!
  const { dir } = labelsDir(session.user, session.project)
  return writeLabel(dir, task_id, paths, profile.working_dir)
}

function labelsDir(profileOrUser: Profile | string, project?: string): { dir: string; profileName: string } {
  if (typeof profileOrUser !== 'string') return { dir: join(profileOrUser.artifact_dir, 'workflow', 'labels'), profileName: profileOrUser.name }
  return {
    dir: join(homedir(), '.harness', 'projects', sanitizeUserId(profileOrUser), sanitizeProjectId(project ?? 'inbox'), 'workflow', 'labels'),
    profileName: 'workflow',
  }
}

export async function sweepDeferredLabels(profile: Profile): Promise<void>
export async function sweepDeferredLabels(user: string, project: string): Promise<void>
export async function sweepDeferredLabels(profileOrUser: Profile | string, project?: string): Promise<void> {
  const { dir, profileName } = labelsDir(profileOrUser, project)
  if (!existsSync(dir)) return
  for (const file of readdirSync(dir).filter(name => name.endsWith('.json'))) {
    const path = join(dir, file)
    try {
      const entry = JSON.parse(readFileSync(path, 'utf8')) as LabelRecord
      if (entry.labeled_at) continue
      let churn: number | undefined
      let verdict: 'accepted' | 'reworked' = 'accepted'
      let reason = 'ground truth unavailable'
      try {
        const args = ['diff', '--numstat', ...(entry.base_commit ? [entry.base_commit] : []), '--', ...entry.paths]
        const { stdout } = await execFileAsync('git', args, { cwd: entry.working_dir, timeout: 3_000 })
        churn = stdout.split('\n').filter(Boolean).reduce((sum, line) => {
          const [added, deleted] = line.split(/\s+/)
          return sum + (Number(added) || 0) + (Number(deleted) || 0)
        }, 0)
        verdict = churn > 0 ? 'reworked' : 'accepted'
        reason = 'git diff ground truth'
      } catch {
        // Non-git projects remain valid; churn intentionally stays undefined.
      }
      logEvent({
        session: randomUUID(), profile: profileName, kind: 'outcome', task_id: entry.task_id,
        verdict, total_cost_usd: 0, human_edit_churn: churn, reason,
      })
      writeFileSync(path, JSON.stringify({ ...entry, labeled_at: new Date().toISOString() }, null, 2), 'utf8')
    } catch {
      // Corrupt labels and git failures never break session start.
    }
  }
}
