import type { Worker as WorkerState } from '../scene/reducer.js'

export function Worker({ worker, x, y, selected, onSelect }: { worker: WorkerState; x: number; y: number; selected: boolean; onSelect(): void }) {
  const initial = worker.frame.agent_name.slice(0, 1).toUpperCase()
  return <g className={`worker ${worker.activity} ${selected ? 'selected' : ''}`} transform={`translate(${x} ${y})`} onClick={onSelect} tabIndex={0} role="button" aria-label={`${worker.frame.agent_name}: ${worker.label}`}>
    <circle className="worker-shadow" cx="0" cy="30" r="23" />
    <circle className="worker-head" cx="0" cy="-8" r="13" />
    <path className="worker-body" d="M-17 29c1-22 7-31 17-31s16 9 17 31Z" />
    <text className="worker-initial" y="-3" textAnchor="middle">{initial}</text>
    <text className="worker-name" y="52" textAnchor="middle">{worker.frame.agent_name}</text>
    <text className="worker-status" y="68" textAnchor="middle">{worker.label}</text>
  </g>
}
