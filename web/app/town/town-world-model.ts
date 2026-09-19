import type { TownPosition, TownRoadPoint, TownLayout } from './town-model'
import { HISTORICAL_DISCOVERY_SITES, TEMPLE_SITE } from './town-model'

export type TownAgentRecord = {
  id: string
  display_name: string
  home_project_id?: string
  state?: string
  task_id?: string
  session_id?: string
  run_id?: string
}

export type TownTaskRecord = {
  id: string
  project_id: string
  agent_id?: string
  state: string
  session_id?: string
  run_id?: string
  title?: string
}

export type AgentPose = 'working' | 'waiting' | 'attention' | 'stopped' | 'unknown'
export interface AgentPresence {
  id: string
  name: string
  label: string
  pose: AgentPose
  projectId?: string
  taskId?: string
  taskTitle?: string
  taskState?: string
  position: { x: number; z: number }
  sessionId?: string
  runId?: string
}

export type TownCommunicationMessage = {
  project_id: string
  task_id?: string
  thread_id?: string
  from: string
  to: string
  kind: 'status' | 'question' | 'answer' | 'handoff'
  body?: string
  options?: string[]
  state: string
  continuation_id?: string
  answer_outcome?: { resumed: boolean; state?: string; error?: string }
  created_at?: string
  acknowledged_at?: string
}

export type TownCommunicationMarker = {
  kind: 'question' | 'attention' | 'working' | 'leaf'
  glyph: '?' | '!' | '…' | '⌁'
  count: number
  label: string
}

type MarkerAnchor = { type: 'project'; id: string } | { type: 'agent'; id: string } | { type: 'hall'; id?: string }

const ATTENTION_TASKS = new Set(['failed', 'interrupted', 'blocked'])
export function isTownHumanEndpoint(value: string, userId: string): boolean {
  return value === userId || value === 'user'
}

/** Derive one compact, truthful canvas marker from durable Town records. */
export function townCommunicationMarker(input: {
  messages: TownCommunicationMessage[]
  tasks: TownTaskRecord[]
  agents: TownAgentRecord[]
  anchor: MarkerAnchor
  userId: string
}): TownCommunicationMarker | undefined {
  const { messages, tasks, agents, anchor, userId } = input
  const agent = anchor.type === 'agent' ? agents.find(item => item.id === anchor.id) : undefined
  const agentTaskIds = agent ? new Set(tasks.filter(task => task.agent_id === agent.id).map(task => task.id)) : undefined
  const relevant = anchor.type === 'hall'
    ? messages.filter(message => !isTownHumanEndpoint(message.from, userId) && !isTownHumanEndpoint(message.to, userId))
    : messages.filter(message => {
      if (anchor.type === 'project' && message.project_id !== anchor.id) return false
      if (anchor.type === 'agent' && !(message.from === anchor.id || message.to === anchor.id || (message.task_id && agentTaskIds?.has(message.task_id)))) return false
      return true
    })
  const openQuestions = relevant.filter(message => message.kind === 'question' && isTownHumanEndpoint(message.to, userId) && message.state === 'delivered' && Boolean(message.continuation_id))
  const attentionMessages = relevant.filter(message => Boolean(message.answer_outcome?.error) || (message.kind === 'answer' && message.answer_outcome?.resumed === false && !message.answer_outcome?.state?.startsWith('queued_')))
  const attentionTasks = anchor.type === 'agent' && agentTaskIds ? tasks.filter(task => agentTaskIds.has(task.id) && ATTENTION_TASKS.has(task.state)) : []
  const linkedWork = anchor.type === 'agent'
    ? tasks.filter(task => task.agent_id === anchor.id && task.state === 'running' && task.session_id && task.run_id && agent?.task_id === task.id && agent.session_id === task.session_id && agent.run_id === task.run_id)
    : anchor.type === 'project'
      ? tasks.filter(task => task.project_id === anchor.id && task.state === 'running' && task.session_id && task.run_id && agents.some(agentItem => agentItem.task_id === task.id && agentItem.session_id === task.session_id && agentItem.run_id === task.run_id))
      : []
  const unread = relevant.filter(message => message.state === 'delivered' && !isTownHumanEndpoint(message.from, userId))
  const choose = (kind: TownCommunicationMarker['kind'], glyph: TownCommunicationMarker['glyph'], count: number, label: string) => ({ kind, glyph, count: Math.min(99, count), label })
  if (openQuestions.length) return choose('question', '?', openQuestions.length, 'Open question from agent')
  if (attentionMessages.length || attentionTasks.length) return choose('attention', '!', attentionMessages.length + attentionTasks.length, 'Agent needs attention; open exact state')
  if (linkedWork.length) return choose('working', '…', linkedWork.length, 'Agent is working on task')
  if (unread.length) return choose('leaf', '⌁', unread.length, 'Open message from agent')
  return undefined
}

export function townConversationGroups(messages: TownCommunicationMessage[]): Array<{ key: string; projectId: string; taskId?: string; threadId?: string; messages: TownCommunicationMessage[]; earlierStatusCount: number }> {
  const groups = new Map<string, TownCommunicationMessage[]>()
  for (const message of messages) {
    const key = `${message.project_id}:${message.task_id ?? ''}:${message.thread_id ?? ''}`
    const current = groups.get(key) ?? []
    current.push(message)
    groups.set(key, current)
  }
  return [...groups.entries()].map(([key, group]) => {
    const ordered = [...group].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    const important = ordered.filter(message => message.kind === 'question' || message.kind === 'handoff')
    const statuses = ordered.filter(message => message.kind === 'status')
    return { key, projectId: ordered[0]!.project_id, ...(ordered[0]!.task_id ? { taskId: ordered[0]!.task_id } : {}), ...(ordered[0]!.thread_id ? { threadId: ordered[0]!.thread_id } : {}), messages: important.length ? ordered.filter(message => message.kind !== 'status') : ordered.slice(-1), earlierStatusCount: Math.max(0, statuses.length - (important.length ? 0 : Math.min(1, statuses.length))) }
  }).sort((a, b) => {
    // Put actionable correspondence in front of routine status history. Within
    // each lane, newest activity is the most useful first read.
    const aPriority = a.messages.some(message => message.kind === 'question' || message.kind === 'handoff') ? 1 : 0
    const bPriority = b.messages.some(message => message.kind === 'question' || message.kind === 'handoff') ? 1 : 0
    if (aPriority !== bPriority) return bPriority - aPriority
    const aLatest = a.messages.at(-1)?.created_at ?? ''
    const bLatest = b.messages.at(-1)?.created_at ?? ''
    return bLatest.localeCompare(aLatest)
  })
}

export function townAnswerReceiptLabel(answer: Pick<TownCommunicationMessage, 'answer_outcome'>): string | undefined {
  const outcome = answer.answer_outcome
  if (!outcome) return undefined
  if (outcome.resumed) return outcome.state === 'running' ? 'Reply received — resuming work' : `Reply received — ${outcome.state ?? 'continuation accepted'}`
  if (outcome.state?.startsWith('queued_')) return `Reply received — waiting for ${outcome.state.replace(/^queued_/, '').replaceAll('_', ' ')}`
  return `Reply saved — could not resume${outcome.error ? ` · ${outcome.error}` : ''}`
}

const TERMINAL = new Set(['failed', 'interrupted', 'cancelled', 'completed', 'blocked'])
const WAITING = new Set(['ready', 'queued_quota', 'queued_dependency', 'queued_workspace', 'queued_concurrency', 'dispatching'])

/** One projection per persisted Town agent. Only complete matching runtime linkage can authorize work pose. */
export function projectAgentPresence(
  agents: TownAgentRecord[],
  tasks: TownTaskRecord[],
  projects: ReadonlyMap<string, TownPosition>,
): AgentPresence[] {
  return [...agents].sort((a, b) => a.id.localeCompare(b.id)).map(agent => {
    const candidates = tasks.filter(task => task.agent_id === agent.id && (!agent.task_id || agent.task_id === task.id))
    const current = candidates.find(task => task.state === 'running')
    const linkedRunning = Boolean(
      current && agent.task_id === current.id &&
      current.session_id && current.run_id && agent.session_id && agent.run_id &&
      current.session_id === agent.session_id && current.run_id === agent.run_id,
    )
    const waitingTask = candidates.find(task => task.state === 'waiting_user')
    const queuedTask = candidates.find(task => WAITING.has(task.state))
    const safeHome = agent.home_project_id && projects.has(agent.home_project_id) ? agent.home_project_id : undefined
    const taskLocation = current && projects.has(current.project_id) ? current.project_id
      : waitingTask && projects.has(waitingTask.project_id) ? waitingTask.project_id
        : undefined
    let pose: AgentPose = 'unknown'
    let label = 'Unknown'
    let projectId: string | undefined
    let task: TownTaskRecord | undefined
    if (linkedRunning && current) {
      pose = 'working'; label = 'Working'; projectId = taskLocation; task = current
    } else if (waitingTask || agent.state === 'waiting_user') {
      pose = 'attention'; label = 'Waiting for you'; projectId = waitingTask && projects.has(waitingTask.project_id) ? waitingTask.project_id : safeHome; task = waitingTask
    } else if (queuedTask) {
      pose = 'waiting'; label = queuedTask.state.replaceAll('_', ' '); projectId = safeHome; task = queuedTask
    } else {
      const terminal = candidates.find(candidate => TERMINAL.has(candidate.state))
      if (terminal || agent.state === 'failed') {
        pose = 'stopped'; label = terminal?.state ?? 'Failed'; projectId = safeHome; task = terminal
      } else if (agent.state === 'idle') {
        pose = 'waiting'; label = 'Idle'; projectId = safeHome
      } else if (agent.state === 'working' || current) {
        pose = 'unknown'; label = 'Unknown activity'; projectId = safeHome
      } else {
        pose = 'unknown'; label = 'Unknown'; projectId = safeHome
      }
    }
    const location = projectId ? projects.get(projectId) : undefined
    return {
      id: agent.id,
      name: agent.display_name || agent.id,
      label,
      pose,
      ...(projectId ? { projectId } : {}),
      ...(task ? { taskId: task.id, taskTitle: task.title, taskState: task.state } : {}),
      position: location ? { x: location.x, z: location.z } : { x: 0, z: 0 },
      ...(linkedRunning && current?.session_id ? { sessionId: current.session_id, runId: current.run_id } : {}),
    }
  })
}

export function workerAnimation(presence: AgentPresence, reducedMotion: boolean): 'tool-loop' | 'prep-loop' | 'still' {
  if (reducedMotion) return 'still'
  if (presence.pose === 'working') return 'tool-loop'
  if (presence.taskState === 'dispatching') return 'prep-loop'
  return 'still'
}

export type TownMode = 'day' | 'night'
export const TOWN_MODE_KEY = 'harness-town-scene-mode'
/** Fixed celestial direction in world space; the sky shader, key light and orbit all share it. */
export const TOWN_MOON_DIRECTION = Object.freeze({ x: -0.681, y: .10, z: -.723 })
/** Camera position direction keeps a slice of the world-oriented sky visible at the default town view. */
export const TOWN_DEFAULT_CAMERA_POSITION_DIRECTION = Object.freeze({ x: .66, y: .20, z: .66 })

export function angularSeparationDegrees(left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number {
  const leftLength = Math.hypot(left.x, left.y, left.z)
  const rightLength = Math.hypot(right.x, right.y, right.z)
  if (!leftLength || !rightLength || !Number.isFinite(leftLength + rightLength)) return Infinity
  const dot = (left.x * right.x + left.y * right.y + left.z * right.z) / (leftLength * rightLength)
  return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI
}

/** Scene geometry identity excludes mode, task, quota and snapshot cursor state. */
export function townLayoutStamp(projectIds: string[], layoutRevision: number): string {
  return `${layoutRevision}:${[...projectIds].sort().join('|')}`
}

export function parseTownMode(value: string | null | undefined): TownMode {
  return value === 'night' ? 'night' : 'day'
}

export interface TownSceneLighting {
  sky: number
  hemisphere: number
  hemisphereColor: number
  groundFill: number
  directional: number
  directionalColor: number
  ground: number
  lamp: number
  lampDistance: number
  lampDecay: number
  shadows: boolean
}

export function townSceneLighting(mode: TownMode): TownSceneLighting {
  return mode === 'night'
    ? { sky: 0x24272a, hemisphere: 1.75, hemisphereColor: 0xd1d0c6, groundFill: 0x77796b, directional: 1.5, directionalColor: 0xe7e3d4, ground: 0x8c9279, lamp: 36, lampDistance: 48, lampDecay: 1, shadows: false }
    : { sky: 0xabcdd8, hemisphere: 2.2, hemisphereColor: 0xd9e5dc, groundFill: 0x596348, directional: 2.5, directionalColor: 0xffedc4, ground: 0x9aa477, lamp: 0, lampDistance: 48, lampDecay: 1.5, shadows: true }
}

export function nightLampSites(projects: ReadonlyMap<string, TownPosition>, limit = 24): Array<{ x: number; z: number }> {
  const cap = Math.max(0, Math.min(24, Math.floor(limit)))
  if (!cap) return []
  const layout = projects as TownLayout
  const roadPoints = Array.isArray(layout.roads) ? layout.roads.flat().filter(point => Math.hypot(point.x, point.z) <= 48) : []
  const uniqueRoadPoints = [...new Map(roadPoints.map(point => [`${point.x},${point.z}`, point])).values()]
  const points: TownRoadPoint[] = []
  const add = (point: TownRoadPoint) => {
    if (points.length < cap && !points.some(existing => existing.x === point.x && existing.z === point.z)) points.push({ ...point })
  }

  // Fixed inner capacity belongs to the temple approach and central junctions.
  // Prefer real road nodes; fallbacks support empty/legacy model fixtures.
  const targets = [TEMPLE_SITE.entrance, { x: 0, z: 30 }, { x: -20, z: 0 }, { x: 20, z: 0 }]
  for (const target of targets) {
    const onRoad = uniqueRoadPoints
      .filter(point => !points.some(existing => existing.x === point.x && existing.z === point.z))
      .sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z) || a.x - b.x || a.z - b.z)[0]
    add(onRoad ?? target)
  }
  if (!layout.roads) for (const fallback of [{ x: 0, z: 30 }, { x: -20, z: 0 }, { x: 20, z: 0 }]) add(fallback)

  const allCandidates = [...projects.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(position => ({ id: position.id, band: position.band, point: { x: position.entrance.x, z: position.entrance.z } }))
    .filter(candidate => !points.some(point => point.x === candidate.point.x && point.z === candidate.point.z))
  const targetCount = Math.min(cap, Math.max(points.length, 4 + allCandidates.length))
  const centralCandidates = allCandidates.filter(candidate => candidate.band === 'active' || candidate.band === 'pinned' || candidate.band === 'recent')
  const centralIds = new Set(centralCandidates.map(candidate => candidate.id))
  const centralBudget = Math.min(centralCandidates.length, Math.ceil(Math.max(0, targetCount - points.length) * .65))
  const addSpread = (candidates: typeof allCandidates, count: number) => {
    while (points.length < targetCount && count > 0 && candidates.length) {
      let bestIndex = 0
      let bestDistance = -1
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index]
        const nearest = Math.min(...points.map(point => Math.hypot(point.x - candidate.point.x, point.z - candidate.point.z)))
        if (nearest > bestDistance) { bestDistance = nearest; bestIndex = index }
      }
      add(candidates.splice(bestIndex, 1)[0].point)
      count--
    }
  }

  // Active, pinned and recent entrances get first claim on the real-light cap.
  addSpread(centralCandidates, centralBudget)
  addSpread(allCandidates.filter(candidate => !centralIds.has(candidate.id)), targetCount - points.length)
  addSpread(centralCandidates, targetCount - points.length)
  return points
}

export const CLOUD_FORM_LIMIT = 12
export const BIRD_FLOCK_LIMIT = 3
export const BIRDS_PER_FLOCK_LIMIT = 7
export const HISTORICAL_REFERENCES = HISTORICAL_DISCOVERY_SITES
