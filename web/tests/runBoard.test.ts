import { describe, expect, it } from 'vitest'
import { mergeRunEvent, runStatusLabel, runBoardEmptyLabel } from '../components/ops/RunBoard'

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
})
