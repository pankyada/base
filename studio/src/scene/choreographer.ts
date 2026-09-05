import type { SceneState } from './reducer.js'

export interface Beat { agent_id: string; kind: 'walk' | 'snap'; at: number }

/** Keep motion pleasant without ever holding back scene truth. */
export function choreograph(previous: SceneState, next: SceneState, now: number, queued: Beat[] = []): Beat[] {
  const changes = Object.values(next.workers).filter(worker => {
    const before = previous.workers[worker.frame.agent_id]
    return !before || before.room !== worker.room || before.activity !== worker.activity
  })
  if (queued.length + changes.length > 6) return changes.slice(0, 6).map(worker => ({ agent_id: worker.frame.agent_id, kind: 'snap', at: now }))
  return [...queued, ...changes.slice(0, 2).map(worker => ({ agent_id: worker.frame.agent_id, kind: 'walk' as const, at: now }))]
}
