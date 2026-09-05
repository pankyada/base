import { describe, expect, it } from 'vitest'
import { undoNotice } from '../src/server/undo-handlers.js'

describe('undo force reason', () => {
  it('refuses a forced undo without a stated reason', async () => {
    const result = await undoNotice('user', 'session', 'missing', {} as any, true)
    expect(result.level).toBe('warn')
    expect(result.message).toContain('reason')
  })
})
