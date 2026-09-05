import type { Worker } from '../scene/reducer.js'
export function Drawer({ worker, onStop }: { worker?: Worker; onStop(agentId: string): void }) {
  return <aside className="drawer"><div className="panel-kicker">Worker drawer</div>{worker ? <><h2>{worker.frame.agent_name}</h2><p>{worker.frame.profile} · {worker.label}</p><dl><dt>Current tool</dt><dd>{worker.tool ?? 'No tool running'}</dd><dt>Spend</dt><dd>${worker.spend_usd.toFixed(4)}</dd></dl>{worker.ended ? <p className="complete">{worker.ended}</p> : <button className="stop" onClick={() => onStop(worker.frame.agent_id)}>Stop worker</button>}</> : <p>Select worker. Full transcript stays here; floor stays glanceable.</p>}</aside>
}
