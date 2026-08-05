import { describe, it, expect } from 'vitest'
import { memoryWriteTool } from '../src/tools/builtin/memory-write.js'

describe('MemoryWrite tool project scope', () => {
  it('routes scope "project" to the memory provider', async () => {
    const calls: any[] = []
    const ctx: any = { memory: { write: async (...a: any[]) => { calls.push(a) } } }
    const msg = await memoryWriteTool.execute({ scope: 'project', key: 'k', content: 'c' }, ctx)
    expect(calls[0][0]).toBe('project')
    expect(msg).toContain('project/k')
  })

  it('passes optional temporal metadata unchanged', async () => {
    const calls: any[] = []
    const ctx: any = { memory: { write: async (...a: any[]) => { calls.push(a) } } }
    await memoryWriteTool.execute({
      key: 'standup', content: 'Daily standup',
      valid_from: '2026-08-14T09:00:00-04:00', recur: 'FREQ=DAILY', timezone: 'America/New_York',
    }, ctx)
    expect(calls[0][4]).toEqual({
      valid_from: '2026-08-14T09:00:00-04:00', recur: 'FREQ=DAILY', timezone: 'America/New_York',
      valid_until: undefined, entity: undefined, confidence: undefined, supersedes: undefined,
    })
  })
})
