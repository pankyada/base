import { describe, expect, it } from 'vitest'
import { pendingLabel } from '../components/ops/Inbox'
import { undoLabel, undoEmptyLabel } from '../components/ops/UndoDrawer'

describe('inbox and undo', () => {
  it('badges expired pending questions and stale undo entries', () => {
    expect(pendingLabel('2020-01-01')).toContain('expired')
    expect(pendingLabel(new Date(10_000).toISOString(), 0)).toContain('10s')
    expect(undoLabel({ available: false, applied: false })).toContain('stale')
    expect(undoEmptyLabel([])).toBe('No undo entries')
  })
})
