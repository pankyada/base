import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/telemetry/logger.js', () => ({ logEvent: vi.fn() }))

import { logEvent } from '../src/telemetry/logger.js'
import { recordWrittenFiles, sweepDeferredLabels } from '../src/workflow/labeler.js'
import { harnessStatePath } from '../src/config/state-paths.js'

describe('deferred workflow labels', () => {
  it('scopes writes per user/project so two users never share a churn bucket', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'workflow-labels-'))
    const file = join(repo, 'out.txt')
    writeFileSync(file, 'before\n')
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['add', 'out.txt'], { cwd: repo })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' })
    const profile: any = { name: 'coding', artifact_dir: join(repo, '.artifacts'), working_dir: repo }
    const user = `wf-label-user-${Date.now().toString(36)}`
    const project = 'demo'
    const session: any = { id: 'sess-1', user, project }
    const taskId = `task-label-${Date.now().toString(36)}`
    recordWrittenFiles(profile, session, taskId, ['out.txt'])
    writeFileSync(file, 'before\nafter\n')
    await sweepDeferredLabels(user, project)
    expect(vi.mocked(logEvent)).toHaveBeenCalledWith(expect.objectContaining({ kind: 'outcome', task_id: taskId, verdict: 'reworked', human_edit_churn: 1 }))
    const labelPath = harnessStatePath('projects', user, project, 'workflow', 'labels', `${taskId}.json`)
    const label = JSON.parse(readFileSync(labelPath, 'utf8'))
    expect(label.labeled_at).toBeTruthy()
    // The profile-scoped bucket a different user/project would fall back to
    // must stay untouched — that's the isolation this scoping exists for.
    expect(() => readFileSync(join(profile.artifact_dir, 'workflow', 'labels', `${taskId}.json`), 'utf8')).toThrow()
  })

  it('tolerates non-git directories and never breaks on a missing bucket', async () => {
    const nongit: any = { name: 'data', artifact_dir: mkdtempSync(join(tmpdir(), 'workflow-nongit-')), working_dir: mkdtempSync(join(tmpdir(), 'workflow-cwd-')) }
    const session: any = { id: 'sess-2', user: `wf-label-nongit-${Date.now().toString(36)}`, project: 'inbox' }
    recordWrittenFiles(nongit, session, 'task-nongit', ['missing.csv'])
    await expect(sweepDeferredLabels(session.user, session.project)).resolves.toBeUndefined()
    await expect(sweepDeferredLabels('no-such-user-at-all', 'inbox')).resolves.toBeUndefined()
  })

  it('legacy direct form (no session) still records to a process-wide bucket', () => {
    const path = recordWrittenFiles(`task-legacy-${Date.now().toString(36)}`, ['x.ts'])
    expect(path).toContain(join('workflow', 'labels'))
  })
})
