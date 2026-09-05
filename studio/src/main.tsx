import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentCatalogEntry, ClientMessage, ServerMessage } from './protocol.js'
import { StudioSocket } from './net/socket.js'
import { initialScene, reduce } from './scene/reducer.js'
import { Floor } from './ui/Floor.js'
import { FrontDesk } from './ui/FrontDesk.js'
import { Board } from './ui/Board.js'
import { Vault } from './ui/Vault.js'
import { Rail } from './ui/Rail.js'
import { Drawer } from './ui/Drawer.js'
import { HireCard } from './ui/HireCard.js'
import './styles.css'

function App() {
  const [scene, dispatch] = useReducer(reduce, undefined, initialScene)
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([])
  const [connection, setConnection] = useState<'connecting' | 'open' | 'closed'>('connecting')
  const [selected, setSelected] = useState<string>()
  const socket = useRef<StudioSocket>()

  useEffect(() => {
    socket.current = new StudioSocket((message: ServerMessage) => {
      dispatch(message)
      if (message.type === 'agent_catalog') setCatalog(message.agents)
    }, setConnection)
    socket.current.connect()
    return () => socket.current?.close()
  }, [])

  const send = (message: ClientMessage) => socket.current?.send(message)
  const selectedWorker = selected ? scene.workers[selected] : undefined
  const active = Object.values(scene.workers).filter(worker => !worker.ended).length
  const hire = (agent: AgentCatalogEntry) => send({ type: 'spawn', agent: agent.name, input: agent.example ?? {}, budget_usd: agent.budget_usd })
  const queueSend = (value: { type: 'tool_approve' | 'tool_deny' | 'input_response'; id: string; value?: string }) => {
    if (value.type === 'input_response') send({ type: 'input_response', id: value.id, value: value.value ?? '' })
    else if (value.type === 'tool_approve') send({ type: 'tool_approve', id: value.id })
    else send({ type: 'tool_deny', id: value.id })
  }
  const answerChallenge = (challengeId: string, unresolved: boolean) => send({ type: 'challenge_answer', challenge_id: challengeId, unresolved })
  const eyebrow = useMemo(() => connection === 'open' ? 'Live session' : connection === 'connecting' ? 'Connecting' : 'Reconnecting', [connection])

  return <main className="studio-shell">
    <header><div><p className="eyebrow">{eyebrow}</p><h1>Agent Studio</h1><p className="subhead">One room. One truth. Watch work become visible.</p></div><div className="header-stats"><b>{active}</b><span>working</span><i className={connection} /></div></header>
    <div className="top-grid"><FrontDesk queue={scene.queue} send={queueSend} /><Board posts={scene.board} challenges={scene.challenges} onChallengeAnswer={answerChallenge} /><Vault spend={scene.spend} /></div>
    {scene.runtime || scene.mission || scene.challenges.length ? <section className="panel" aria-live="polite"><div className="panel-kicker">Run truth</div><p>{scene.runtime ? `Session ${scene.runtime.status} · ${scene.runtime.last_seq} events` : 'Session state pending'}</p>{scene.mission ? <p>Mission {scene.mission.status} · {scene.mission.criteria.filter(item => item.state === 'verified').length}/{scene.mission.criteria.length} criteria verified</p> : null}{scene.challenges.length ? <p>Challenges: {scene.challenges.filter(item => item.state === 'open').length} open · {scene.challenges.filter(item => item.state === 'unresolved').length} unresolved</p> : null}</section> : null}
    <div className="work-grid"><Floor scene={scene} selected={selected} onSelect={setSelected} /><Drawer worker={selectedWorker} onStop={agent_id => send({ type: 'agent_cancel', agent_id })} /></div>
    <div className="bottom-grid"><HireCard agents={catalog} onHire={hire} /><Rail lines={scene.feed} /></div>
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
