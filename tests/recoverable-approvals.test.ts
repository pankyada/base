import { describe, expect, it, vi } from 'vitest'
import { RecoverableApprovalRegistry } from '../src/server/recoverable-approvals.js'

describe('recoverable in-process approvals', () => {
  it('returns a callback only for its session/user scope and expires it closed', () => {
    const registry = new RecoverableApprovalRegistry(10)
    const resolve = vi.fn()
    registry.register('session-a', 'alice', { id: 'approval-a', name: 'Bash', resolve })
    expect(registry.get('session-a', 'alice', 'approval-a')?.name).toBe('Bash')
    expect(registry.get('session-a', 'bob', 'approval-a')).toBeUndefined()
    expect(registry.cleanup(Date.now() + 11)).toBe(1)
    expect(resolve).toHaveBeenCalledWith(false)
    expect(registry.get('session-a', 'alice', 'approval-a')).toBeUndefined()
  })

  it('cancels every approval for an explicitly cancelled session', () => {
    const registry = new RecoverableApprovalRegistry()
    const one = vi.fn(); const two = vi.fn(); const abort = vi.fn()
    registry.register('session-a', 'alice', { id: 'one', name: 'Bash', resolve: one, cancel: abort })
    registry.register('session-a', 'alice', { id: 'two', name: 'Write', resolve: two, cancel: abort })
    registry.cancel('session-a', 'alice')
    expect(one).toHaveBeenCalledWith(false)
    expect(two).toHaveBeenCalledWith(false)
    expect(abort).toHaveBeenCalledTimes(2)
  })
})
