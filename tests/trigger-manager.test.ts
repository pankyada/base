import { describe, expect, it, vi } from 'vitest'
import { TriggerManager } from '../src/triggers/manager.js'

const profile: any = {
  name: 'ambient', triggers: { max_concurrent_runs: 3 },
  model: {}, tools: {}, artifact_dir: '/tmp', system_prompt: '', working_dir: '/tmp',
}

function manager(run: any) {
  return new TriggerManager({
    profile, runStore: { create: vi.fn(), update: vi.fn(), get: vi.fn(() => ({ status: 'running' })) }, abortRegistry: new Map(), run,
  } as any)
}

describe('TriggerManager', () => {
  it('skips overlapping wakeups by default', async () => {
    let resolveRun!: (value: any) => void
    const run = vi.fn<(options: any) => Promise<any>>(() => new Promise(resolve => { resolveRun = resolve }))
    const instance = manager(run)
    const first = instance.fire('poll', { name: 'mail' }, { cursor: 'a' })
    await Promise.resolve()
    await instance.fire('poll', { name: 'mail' }, { cursor: 'b' })
    expect(run).toHaveBeenCalledOnce()
    resolveRun({ session: { id: 's' } })
    await first
  })

  it('keeps only newest queued wakeup', async () => {
    const resolvers: Array<(value: any) => void> = []
    const run = vi.fn<(options: any) => Promise<any>>(() => new Promise(resolve => resolvers.push(resolve)))
    const instance = manager(run)
    const first = instance.fire('watch', { name: 'vault', mode: 'queue' }, { changed: 1 })
    await Promise.resolve()
    await instance.fire('watch', { name: 'vault', mode: 'queue' }, { changed: 2 })
    await instance.fire('watch', { name: 'vault', mode: 'queue' }, { changed: 3 })
    expect(run).toHaveBeenCalledOnce()
    resolvers.shift()!({ session: { id: 'first' } })
    await first
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1][0].userMessage).toContain('3')
    resolvers.shift()!({ session: { id: 'second' } })
  })
})
