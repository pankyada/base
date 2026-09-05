import type { AgentFrame, BulletinPostWire, ChallengeWire, MissionWire, ServerMessage, SessionRuntimeWire } from '../protocol.js'
import { FLOOR_CAPACITY, type RoomId } from './floorplan.js'
import type { FloorLabel } from './language.js'

export type WorkerActivity = 'thinking' | 'reading' | 'building' | 'calling' | 'asking' | 'waiting' | 'blocked' | 'done'

export interface Worker {
  frame: AgentFrame
  activity: WorkerActivity
  label: FloorLabel
  room: RoomId
  tool?: string
  since: number
  spend_usd: number
  tools: number
  tainted: boolean
  ended?: Extract<ServerMessage, { type: 'agent_end' }>['status']
}

export interface DeskCard {
  id: string
  kind: 'tool_prompt' | 'input_request'
  agent_id?: string
  name?: string
  input?: Record<string, unknown>
  risk?: 'safe' | 'caution' | 'danger'
  prompt?: string
}

export interface SceneState {
  workers: Record<string, Worker>
  seats: Record<string, number>
  freeSeats: number[]
  bullpen: string[]
  queue: DeskCard[]
  board: BulletinPostWire[]
  feed: string[]
  spend: { usd: number; tokens_in: number; tokens_out: number }
  runtime?: SessionRuntimeWire
  mission?: MissionWire
  receipt?: unknown
  challenges: ChallengeWire[]
}

export function initialScene(): SceneState {
  return { workers: {}, seats: {}, freeSeats: [], bullpen: [], queue: [], board: [], feed: [], spend: { usd: 0, tokens_in: 0, tokens_out: 0 }, challenges: [] }
}

function addFeed(state: SceneState, text: string): SceneState {
  return { ...state, feed: [text, ...state.feed].slice(0, 200) }
}

function roomForTool(name: string): { room: RoomId; activity: WorkerActivity; label: FloorLabel } {
  if (/^(Read|Grep|Glob|Skill|Recall|Memory)/.test(name)) return { room: 'library', activity: 'reading', label: 'reading' }
  if (/^(Bash|Write|Edit|Execute)/.test(name)) return { room: 'workshop', activity: 'building', label: 'building' }
  if (/^(Delegate)/.test(name)) return { room: 'desk', activity: 'calling', label: 'thinking' }
  return { room: 'mailroom', activity: 'calling', label: 'looking things up' }
}

function withWorker(state: SceneState, agentId: string, update: (worker: Worker) => Worker): SceneState {
  const worker = state.workers[agentId]
  if (!worker) return state
  return { ...state, workers: { ...state.workers, [agentId]: update(worker) } }
}

function addWorker(state: SceneState, frame: AgentFrame): SceneState {
  if (state.workers[frame.agent_id]) return state
  const occupied = Object.keys(state.seats).length
  const seat = occupied < FLOOR_CAPACITY ? occupied : undefined
  const seats = seat === undefined ? state.seats : { ...state.seats, [frame.agent_id]: seat }
  const bullpen = seat === undefined ? [...state.bullpen, frame.agent_id] : state.bullpen
  return addFeed({ ...state, seats, bullpen, workers: { ...state.workers, [frame.agent_id]: { frame, activity: 'thinking', label: 'thinking', room: 'desk', since: 0, spend_usd: 0, tools: 0, tainted: false } } }, `${frame.agent_name} joined the team`)
}

export function reduce(state: SceneState, message: ServerMessage): SceneState {
  switch (message.type) {
    case 'agent_spawn': return addWorker(state, message.frame)
    case 'fleet_snapshot': {
      let next = initialScene()
      for (const frame of message.frames) next = addWorker(next, frame)
      for (const snapshot of message.states) {
        next = withWorker(next, snapshot.agent_id, worker => ({ ...worker, activity: snapshot.state === 'waiting_approval' ? 'blocked' : snapshot.state === 'waiting_input' ? 'asking' : 'calling', label: snapshot.state === 'waiting_approval' ? 'needs your OK' : snapshot.state === 'waiting_input' ? 'asking you' : worker.label, room: snapshot.tool ? roomForTool(snapshot.tool).room : worker.room, tool: snapshot.tool, since: snapshot.since, spend_usd: snapshot.spend_usd, tools: snapshot.tools }))
      }
      return { ...next, board: [...message.board].sort((a, b) => b.seq - a.seq), queue: message.queue.map(item => ({ ...item })), feed: message.feed ?? state.feed }
    }
    case 'tool_start': {
      if (!message.agent_id) return state
      const route = roomForTool(message.name)
      return addFeed(withWorker(state, message.agent_id, worker => ({ ...worker, ...route, tool: message.name, since: 0, tools: worker.tools + 1 })), `${state.workers[message.agent_id]?.frame.agent_name ?? 'Worker'} is ${route.label}`)
    }
    case 'tool_prompt': {
      const next = message.agent_id ? withWorker(state, message.agent_id, worker => ({ ...worker, activity: 'blocked', label: 'needs your OK', room: 'gate', tool: message.name, since: 0 })) : state
      return addFeed({ ...next, queue: [...next.queue, { id: message.id, kind: 'tool_prompt', agent_id: message.agent_id, name: message.name, input: message.input, risk: message.risk }] }, `${next.workers[message.agent_id ?? '']?.frame.agent_name ?? 'Worker'} needs your OK`)
    }
    case 'input_request': {
      const next = message.agent_id ? withWorker(state, message.agent_id, worker => ({ ...worker, activity: 'asking', label: 'asking you', room: 'gate', since: 0 })) : state
      return addFeed({ ...next, queue: [...next.queue, { id: message.id, kind: 'input_request', agent_id: message.agent_id, prompt: message.prompt }] }, `${next.workers[message.agent_id ?? '']?.frame.agent_name ?? 'Worker'} is asking you`)
    }
    case 'agent_stats': return withWorker(state, message.agent_id, worker => ({ ...worker, spend_usd: message.cost_usd, tools: message.tools }))
    case 'stats': return { ...state, spend: { usd: message.cost_usd, tokens_in: message.tokens_in, tokens_out: message.tokens_out } }
    case 'agent_message': return addFeed({ ...state, board: [message.post, ...state.board.filter(post => post.id !== message.post.id)].slice(0, 200) }, `${message.post.from_agent_name} shared: ${message.post.subject}`)
    case 'agent_end': {
      const next = withWorker(state, message.agent_id, worker => ({ ...worker, activity: 'done', label: 'finished', ended: message.status, since: 0 }))
      const seat = next.seats[message.agent_id]
      return addFeed({ ...next, freeSeats: seat === undefined || next.freeSeats.includes(seat) ? next.freeSeats : [...next.freeSeats, seat] }, `${next.workers[message.agent_id]?.frame.agent_name ?? 'Worker'} finished`)
    }
    case 'runtime': return addFeed({ ...state, runtime: message.snapshot }, `Session ${message.snapshot.status} · event ${message.snapshot.last_seq}`)
    case 'mission': return addFeed({ ...state, mission: message.mission }, `Mission ${message.mission.status} · ${message.mission.outcome}`)
    case 'receipt': return addFeed({ ...state, receipt: message.receipt }, 'Mission receipt received')
    case 'challenge': return addFeed({ ...state, challenges: [...state.challenges.filter(item => item.id !== message.challenge.id), message.challenge] }, `Challenge ${message.challenge.state}`)
    case 'error': return addFeed(state, message.message)
    default: return state
  }
}
