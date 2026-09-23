import { describe, expect, it } from 'vitest'
import { mergeRunEvent, runStatusLabel, runBoardEmptyLabel, runStatusGroup, runInputTitle, runsUrl, workflowMapScopeForRun } from '../components/ops/RunBoard'

describe('run board', () => {
  it('keeps concurrent lanes and distinguishes waiting input', () => {
    const rows = mergeRunEvent([], { type: 'turn_start', run_id: 'r1' })
    const next = mergeRunEvent(rows, { type: 'turn_start', run_id: 'r2' })
    expect(next).toHaveLength(2)
    expect(runStatusLabel('waiting_input')).toContain('waiting')
  })

  it('builds scoped cancel endpoint', async () => {
    const { cancelRunUrl } = await import('../components/ops/RunBoard')
    expect(cancelRunUrl('http://localhost:7337', 'r 1')).toBe('http://localhost:7337/runs/r%201')
  })

  it('has a deliberate empty state', () => {
    expect(runBoardEmptyLabel([])).toBe('No active runs')
  })

  it('scopes /runs to the active identity and profile, distinct per identity', () => {
    const a = runsUrl('http://localhost:7337', { userId: 'user-a', profile: 'coding' })
    const b = runsUrl('http://localhost:7337', { userId: 'user-b', profile: 'coding' })
    expect(a).toContain('user=user-a')
    expect(a).toContain('profile=coding')
    expect(a).not.toBe(b)
  })

  it('keeps budget exhaustion visible in the live lane', () => {
    const rows = mergeRunEvent([], { type: 'session_end', run_id: 'budget-run', status: 'budget_exceeded', reason: 'cost' })
    expect(rows[0].status).toBe('budget_exceeded')
    expect(runStatusLabel(rows[0].status)).toContain('budget')
    expect(runStatusGroup(rows[0].status)).toBe('finished')
  })

  it('separates waiting, active, and terminal run states into dispatch lanes', () => {
    expect(runStatusGroup('waiting_input')).toBe('waiting')
    expect(runStatusGroup('running')).toBe('running')
    expect(runStatusGroup('pending')).toBe('running')
    expect(runStatusGroup('completed')).toBe('finished')
    expect(runStatusGroup('failed')).toBe('finished')
    expect(runStatusGroup('cancelled')).toBe('finished')
  })

  it('uses the run input as a bounded title only when the API supplied it', () => {
    expect(runInputTitle('  investigate the broken deploy  ')).toBe('investigate the broken deploy')
    expect(runInputTitle(undefined)).toBeUndefined()
    expect(runInputTitle({ task: 'ship patch' })).toBe('{"task":"ship patch"}')
    expect(runInputTitle('x'.repeat(220))).toHaveLength(180)
  })

  it('requires the run row session and profile before constructing an exact map scope', () => {
    expect(workflowMapScopeForRun({ id: 'run-a', status: 'completed', session_id: 'session-a', profile: 'coding' })).toEqual({ run_id: 'run-a', session_id: 'session-a', profile: 'coding' })
    expect(workflowMapScopeForRun({ id: 'run-b', status: 'completed', profile: 'coding' })).toBeUndefined()
    expect(workflowMapScopeForRun({ id: 'run-c', status: 'completed', session_id: 'session-c' })).toBeUndefined()
  })
})
