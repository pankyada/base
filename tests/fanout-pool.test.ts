import { describe, expect, it } from 'vitest'
import { runBoundedPool } from '../src/agents/pool.js'
import type { ToolContext } from '../src/tools/types.js'

const context = (controllers = new Map<string, AbortController>()) => ({
  signal: new AbortController().signal,
  agentControllers: controllers,
  events: { onToken: () => {}, onToolStart: () => {}, onToolEnd: () => {}, onToolPrompt: async () => true, onSessionEnd: () => {} },
} as unknown as ToolContext)

describe('agent pool', () => {
  it('enforces fleet and per-agent concurrency caps', async () => {
    let active = 0
    let peak = 0
    const tasks = Array.from({ length: 6 }, (_, i) => ({
      key: i < 4 ? 'researcher' : 'writer',
      maxConcurrent: i < 4 ? 1 : 2,
      run: async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 5))
        active--
        return i
      },
    }))
    const results = await runBoundedPool(tasks, context(), 3)
    expect(results.map(result => result.status)).toEqual(Array(6).fill('fulfilled'))
    expect(peak).toBe(3)
  })

  it('isolates rejection and chains parent cancellation', async () => {
    const parent = new AbortController()
    const controllers = new Map<string, AbortController>()
    const seen: AbortSignal[] = []
    const resultsPromise = runBoundedPool([
      { key: 'a', run: async () => { throw new Error('boom') } },
      { key: 'b', run: async child => { seen.push(child.signal!); parent.abort(); return 'ok' } },
    ], { ...context(controllers), signal: parent.signal } as ToolContext, 2)
    const results = await resultsPromise
    expect(results[0]).toMatchObject({ status: 'rejected' })
    expect(results[1]).toEqual({ status: 'fulfilled', value: 'ok' })
    expect(seen[0].aborted).toBe(true)
  })

  it('registers child controllers for one-agent cancellation', async () => {
    const controllers = new Map<string, AbortController>()
    let childController: AbortController | undefined
    const promise = runBoundedPool([{
      key: 'a',
      run: async child => {
        child.events.onAgentSpawn?.({ agent_id: 'ag_a', agent_name: 'a', parent_agent_id: 'root', depth: 1, origin: 'operator', profile: 'a', session_id: 's' }, {})
        childController = child.agentControllers!.get('ag_a')
        return 'done'
      },
    }], { ...context(controllers), events: { ...context(controllers).events, onAgentSpawn: () => {} } } as ToolContext)
    await promise
    expect(childController).toBeDefined()
    childController!.abort()
    expect(childController!.signal.aborted).toBe(true)
  })
})
