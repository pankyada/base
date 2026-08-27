import type { ToolContext } from '../tools/types.js'

export interface PoolTask<T> {
  key: string
  maxConcurrent?: number
  run(context: ToolContext): Promise<T>
}

export function childAbortController(parent?: AbortSignal): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController()
  if (!parent) return { controller, cleanup: () => {} }
  const abort = () => controller.abort(parent.reason)
  if (parent.aborted) abort()
  else parent.addEventListener('abort', abort, { once: true })
  return { controller, cleanup: () => parent.removeEventListener('abort', abort) }
}

/** Run tasks with a fleet-wide cap and optional per-agent caps. */
export async function runBoundedPool<T>(tasks: PoolTask<T>[], context: ToolContext, defaultMax = 3): Promise<PromiseSettledResult<T>[]> {
  const limit = Number.isInteger(defaultMax) && defaultMax > 0 ? defaultMax : 3
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  const activeByKey = new Map<string, number>()
  const controllers = context.agentControllers ?? new Map<string, AbortController>()
  const started = new Set<number>()
  let active = 0
  let completed = 0

  return new Promise(resolve => {
    const pump = () => {
      while (active < limit && started.size < tasks.length) {
        let index = -1
        for (let i = 0; i < tasks.length; i++) {
          if (started.has(i)) continue
          const task = tasks[i]
          const cap = task.maxConcurrent ?? limit
          if ((activeByKey.get(task.key) ?? 0) < cap) { index = i; break }
        }
        if (index < 0) break
        const task = tasks[index]
        started.add(index)
        const { controller, cleanup } = childAbortController(context.signal)
        active++
        activeByKey.set(task.key, (activeByKey.get(task.key) ?? 0) + 1)
        const childContext: ToolContext = {
          ...context,
          signal: controller.signal,
          agentControllers: controllers,
        }
        childContext.events = {
          ...context.events,
          onAgentSpawn: (frame, input, budget) => {
            controllers.set(frame.agent_id, controller)
            context.events.onAgentSpawn?.(frame, input, budget)
          },
          onAgentEnd: (agentId, status, error, output, durationMs) => {
            controllers.delete(agentId)
            context.events.onAgentEnd?.(agentId, status, error, output, durationMs)
          },
        }
        Promise.resolve().then(() => task.run(childContext)).then(
          value => { results[index] = { status: 'fulfilled', value } },
          reason => { results[index] = { status: 'rejected', reason } },
        ).finally(() => {
          active--
          activeByKey.set(task.key, (activeByKey.get(task.key) ?? 1) - 1)
          if ((activeByKey.get(task.key) ?? 0) === 0) activeByKey.delete(task.key)
          cleanup()
          completed++
          if (completed === tasks.length) resolve(results)
          else pump()
        })
      }
    }
    if (tasks.length === 0) { resolve(results); return }
    pump()
  })
}
