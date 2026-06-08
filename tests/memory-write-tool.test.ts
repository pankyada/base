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
})
