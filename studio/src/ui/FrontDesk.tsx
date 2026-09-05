import type { DeskCard } from '../scene/reducer.js'

export function FrontDesk({ queue, send }: { queue: DeskCard[]; send: (value: { type: 'tool_approve' | 'tool_deny' | 'input_response'; id: string; value?: string }) => void }) {
  return <section className="panel front-desk"><div className="panel-kicker">Front desk</div><h2>{queue.length ? `${queue.length} need you` : 'All clear'}</h2>{queue.slice(0, 2).map(card => <article className={`queue-card ${card.risk === 'danger' ? 'danger' : ''}`} key={card.id}><strong>{card.name ?? 'Question'}</strong><p>{card.prompt ?? JSON.stringify(card.input)}</p>{card.kind === 'tool_prompt' ? <div><button onClick={() => send({ type: 'tool_approve', id: card.id })}>Approve</button><button className="quiet" onClick={() => send({ type: 'tool_deny', id: card.id })}>Deny</button></div> : <button onClick={() => send({ type: 'input_response', id: card.id, value: '' })}>Answer</button>}</article>)}</section>
}
