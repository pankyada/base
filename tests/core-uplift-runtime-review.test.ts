import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionRuntime, SessionRuntimeRegistry } from '../src/server/session-runtime.js'

describe('Core runtime recovery review', () => {
  it('retains current lifecycle and action state after its source events are evicted', () => {
    const runtime = new SessionRuntime('s', 'alice', 2)
    runtime.emit('turn_start', { run_id: 'run' })
    runtime.emit('session_ready', { budget: { max_cost_usd: 2 } })
    runtime.emit('tool_prompt', { id: 'approval', run_id: 'run' })
    runtime.emit('stats', { run_id: 'run', cost_usd: 0.5 })
    for (let i = 0; i < 10; i++) runtime.emit('token', { content: 'x', run_id: 'run' })
    expect(runtime.state.actionable_ids).toEqual(['approval'])
    expect(runtime.state.run_id).toBe('run')
    expect(runtime.state.latest_usage).toMatchObject({ cost_usd: 0.5 })
    expect(runtime.state).toMatchObject({ budget: { max_cost_usd: 2 } })
    runtime.emit('session_end', { status: 'cancelled', run_id: 'run' })
    expect(runtime.state.status).toBe('cancelled')
    expect(runtime.state.actionable_ids).toEqual([])
  })

  it('keeps child telemetry from replacing root recovery projection', () => {
    const runtime = new SessionRuntime('s', 'alice')
    runtime.emit('turn_start', { run_id: 'root-run' })
    runtime.emit('tool_prompt', { id: 'root-approval', run_id: 'root-run' })
    runtime.emit('stats', { run_id: 'root-run', cost_usd: 1 })
    runtime.emit('turn_start', { run_id: 'child-run', agent_id: 'child' })
    runtime.emit('stats', { run_id: 'child-run', agent_id: 'child', cost_usd: 99 })
    runtime.emit('session_end', { run_id: 'child-run', agent_id: 'child', status: 'failed' })
    expect(runtime.state.run_id).toBe('root-run')
    expect(runtime.state.latest_usage).toMatchObject({ cost_usd: 1 })
    expect(runtime.state.status).toBe('running')
    expect(runtime.state.actionable_ids).toEqual(['root-approval'])
    runtime.emit('session_end', { run_id: 'root-run', status: 'completed' })
    expect(runtime.state.status).toBe('completed')
  })

  it('detaches input, emit results and subscription events from authoritative state', () => {
    const runtime = new SessionRuntime('s', 'alice')
    const input = { nested: { value: 'original' } }
    const emitted = runtime.emit('test', input)
    input.nested.value = 'input changed'
    ;(emitted.payload as typeof input).nested.value = 'return changed'
    const sub = runtime.subscribe(0)
    ;(sub.events![0].payload as typeof input).nested.value = 'subscription changed'
    expect(runtime.state.events[0].payload).toEqual({ nested: { value: 'original' } })
  })

  it('does not journal snapshots or retain ephemeral actions after restart', () => {
    const runtime = new SessionRuntime('s', 'alice')
    runtime.emit('tool_prompt', { id: 'a' })
    const before = runtime.state.last_seq
    for (let i = 0; i < 10; i++) runtime.emit('runtime', { snapshot: runtime.state })
    expect(runtime.state.last_seq).toBe(before)
    const restored = new SessionRuntime('s', 'alice', 256, 1000, undefined, runtime.state)
    expect(restored.state.status).toBe('failed')
    expect(restored.state.actionable_ids).toEqual([])
    expect(restored.state.controller).toBeUndefined()
  })

  it('keeps async actions outstanding until settlement and caches rejection without re-execution', async () => {
    const runtime = new SessionRuntime('s', 'alice')
    const { lease } = runtime.claim('c')
    runtime.emit('tool_prompt', { id: 'a' })
    let reject!: (error: Error) => void
    let calls = 0
    const first = runtime.respond('a', 'c', lease, () => {
      calls++
      return new Promise((_resolve, fail) => { reject = fail })
    })
    expect(runtime.state.actionable_ids).toEqual(['a'])
    expect(runtime.state.events.some(event => event.type === 'response')).toBe(false)
    reject(new Error('ambiguous failure'))
    await expect(first).rejects.toThrow('ambiguous failure')
    const second = runtime.respond('a', 'c', lease, () => { calls++; return Promise.resolve('wrong') })
    await expect(second).rejects.toThrow('ambiguous failure')
    expect(calls).toBe(1)
    expect(runtime.state.actionable_ids).toEqual(['a'])
  })

  it('rejects invalid cursors without mutating the runtime', () => {
    const runtime = new SessionRuntime('s', 'alice')
    for (const cursor of [-1, 0.5, NaN, Infinity]) expect(() => runtime.subscribe(cursor)).toThrow('cursor')
    expect(runtime.subscribe(99).mode).toBe('snapshot')
    expect(runtime.state.last_seq).toBe(0)
  })

  it('bounds response retention without evicting IDs into duplicate execution', () => {
    const runtime = new SessionRuntime('s', 'alice', 2, 1000, undefined, undefined, 2)
    const { lease } = runtime.claim('c')
    let calls = 0
    runtime.respond('one', 'c', lease, () => ++calls)
    runtime.respond('two', 'c', lease, () => ++calls)
    expect(() => runtime.respond('three', 'c', lease, () => ++calls)).toThrow('retention')
    expect(runtime.respond('one', 'c', lease, () => ++calls)).toBe(1)
    expect(calls).toBe(2)
  })

  it('bounds retained payloads and explicitly marks incomplete recovery', () => {
    const runtime = new SessionRuntime('s', 'alice', 2)
    runtime.emit('tool_prompt', { id: 'large', input: 'x'.repeat(100_000) })
    expect(JSON.stringify(runtime.state).length).toBeLessThan(20_000)
    expect(runtime.state.recovery_incomplete).toBe(true)
    expect(runtime.state.actionable_ids).toEqual(['large'])
  })

  it('retains synchronous handler failures without retrying their side effects', () => {
    const runtime = new SessionRuntime('s', 'alice')
    const { lease } = runtime.claim('c')
    let calls = 0
    const fail = () => { calls++; throw new Error('failed after effect') }
    expect(() => runtime.respond('same', 'c', lease, fail)).toThrow('failed after effect')
    expect(() => runtime.respond('same', 'c', lease, fail)).toThrow('failed after effect')
    expect(calls).toBe(1)
  })

  it('reconstructs persisted runtime state through the registry', () => {
    const root = mkdtempSync(join(tmpdir(), 'core-uplift-runtime-registry-'))
    try {
      const first = new SessionRuntimeRegistry(8, 1000, root).getOrCreate('s', 'alice')
      first.emit('turn_start', { run_id: 'run-1' })
      first.emit('stats', { run_id: 'run-1', cost_usd: 0.25 })
      const restored = new SessionRuntimeRegistry(8, 1000, root).get('s', 'alice')
      expect(restored?.state).toMatchObject({ session_id: 's', user: 'alice', run_id: 'run-1', latest_usage: { cost_usd: 0.25 } })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
