import { describe, expect, it, vi } from 'vitest'
import { WatchTrigger } from '../src/triggers/watch.js'
import { recordHarnessWrite } from '../src/triggers/suppression.js'

describe('WatchTrigger', () => {
  it('debounces and caps a burst into one run', async () => {
    vi.useFakeTimers()
    const fire = vi.fn().mockResolvedValue(undefined)
    const trigger = new WatchTrigger({ name: 'vault', path: '/tmp', debounce_ms: 10, max_batch: 2 }, fire)
    trigger.record('add', '/tmp/a')
    trigger.record('change', '/tmp/b')
    trigger.record('unlink', '/tmp/c')
    await vi.advanceTimersByTimeAsync(10)
    expect(fire).toHaveBeenCalledWith(expect.objectContaining({ changed_count: 3, events: expect.any(Array), truncated: true }), expect.any(Object))
    expect(fire.mock.calls[0][0].events).toHaveLength(2)
    vi.useRealTimers()
  })

  it('suppresses a fresh harness write', () => {
    const fire = vi.fn()
    const trigger = new WatchTrigger({ name: 'vault', path: '/tmp', debounce_ms: 10 }, fire)
    recordHarnessWrite('/tmp/output.md')
    trigger.record('change', '/tmp/output.md')
    expect(fire).not.toHaveBeenCalled()
  })

  it('coalesces a 50-write storm into exactly one run', async () => {
    vi.useFakeTimers()
    const fire = vi.fn().mockResolvedValue(undefined)
    const trigger = new WatchTrigger({ name: 'vault', path: '/tmp', debounce_ms: 10, max_batch: 10 }, fire)
    for (let index = 0; index < 50; index++) trigger.record('change', `/tmp/storm-${index}.md`)
    await vi.advanceTimersByTimeAsync(10)
    expect(fire).toHaveBeenCalledOnce()
    expect(fire.mock.calls[0][0]).toMatchObject({ changed_count: 50, truncated: true, sample_paths: expect.any(Array) })
    vi.useRealTimers()
  })

  it('does not re-trigger on a harness write loop', async () => {
    const fire = vi.fn().mockResolvedValue(undefined)
    const trigger = new WatchTrigger({ name: 'vault', path: '/tmp', debounce_ms: 10 }, fire)
    for (let index = 0; index < 50; index++) {
      const path = `/tmp/output-${index}.md`
      recordHarnessWrite(path)
      trigger.record('change', path)
    }
    await trigger.flush()
    expect(fire).not.toHaveBeenCalled()
  })
})
