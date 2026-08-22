import { describe, expect, it } from 'vitest'
import { briefCards, briefValue } from '../components/assistant/Brief'
import { validityLabel, memoryBar, memoryEmptyLabel, memoryEditPrompt } from '../components/assistant/MemoryTimeline'
import { triggerHealth, triggerSummary, triggerScheduleLabel } from '../components/assistant/TriggerList'

describe('assistant surface', () => {
  it('keeps deliberate empty brief cards and open-ended memory intervals', () => {
    expect(briefCards({}).every(card => card.empty.length > 0)).toBe(true)
    expect(briefValue({ pending: [] }, 'pending')).toBe('Nothing is waiting on you')
    expect(briefValue({ usage: { total: { cost_usd: 0 } } }, 'usage')).toContain('cost_usd')
    expect(validityLabel({ valid_from: '2026-01-01' })).toContain('ongoing')
    expect(memoryEmptyLabel([])).toBe('No memory facts')
    expect(memoryEditPrompt({ key: 'timezone', content: 'UTC' })).toContain('MemoryWrite')
    expect(memoryBar({ valid_from: '2026-01-01', valid_to: '2026-01-11' }, '2026-01-01', '2026-01-21')).toEqual({ left: 0, width: 50 })
    expect(triggerHealth({ fires: 1, skips: 287 })).toContain('healthy')
    expect(triggerSummary({ fires: 1, skips: 287, skip_reasons: { cursor_unchanged: 287 } })).toContain('cursor_unchanged')
    expect(triggerScheduleLabel({ last_fire: '2026-01-01', next_fire: null })).toContain('next: unknown')
  })
})
