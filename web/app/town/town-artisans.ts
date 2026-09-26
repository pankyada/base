import { GUILD_HALL_SITE, STAGING_SITE, type TownLayout, type TownPosition, type TownRoadPoint } from './town-model'
import { isTownOpenQuestion, type TownCommunicationMessage } from './town-world-model'

export type ArtisanCraft = 'planner' | 'designer' | 'builder' | 'reviewer' | 'tester' | 'debugger' | 'researcher' | 'scribe' | 'guardian'
export type ArtisanForm = 'human' | 'ganesha' | 'nandi'
export type ArtisanHeadgear = 'tuft' | 'crown' | 'topknot' | 'turban' | 'bun' | 'headcloth'
export type ArtisanProp = 'ledger' | 'plan-scroll' | 'mallet' | 'stylus' | 'gnomon' | 'pouch' | 'leaf' | 'tusk' | 'bell' | 'chisel'

export interface ArtisanLook {
  key: string
  name: string
  craft: ArtisanCraft
  epithet: string
  form: ArtisanForm
  robe: number
  sash: number
  skin: number
  headgear: ArtisanHeadgear
  prop: ArtisanProp
  beard?: boolean
  /** Hireable apprentice rather than a seeded master. */
  apprentice?: boolean
}

/** Visual mirror of Core `src/town/artisans.ts`; identity always comes from the agent record. */
export const ARTISAN_LOOKS: readonly ArtisanLook[] = Object.freeze([
  { key: 'chanakya', name: 'Chanakya', craft: 'planner', epithet: 'Strategist of the Arthashastra', form: 'human', robe: 0xe9e1cc, sash: 0xd9822b, skin: 0x8a5a3c, headgear: 'tuft', prop: 'ledger' },
  { key: 'maya-danava', name: 'Maya Danava', craft: 'designer', epithet: 'Architect of the Maya Sabha', form: 'human', robe: 0x3f3b6e, sash: 0xd2a640, skin: 0x6f4a35, headgear: 'crown', prop: 'plan-scroll', beard: true },
  { key: 'vishwakarma', name: 'Vishwakarma', craft: 'builder', epithet: 'Divine craftsman', form: 'human', robe: 0xc98b2e, sash: 0xa8322b, skin: 0x93613f, headgear: 'crown', prop: 'mallet', beard: true },
  { key: 'panini', name: 'Panini', craft: 'reviewer', epithet: 'Grammarian of rules', form: 'human', robe: 0xd8883a, sash: 0x7b3b22, skin: 0x8c5d3f, headgear: 'topknot', prop: 'stylus' },
  { key: 'aryabhata', name: 'Aryabhata', craft: 'tester', epithet: 'Measurer and prover', form: 'human', robe: 0x5b6f86, sash: 0xe0c070, skin: 0x7d5238, headgear: 'turban', prop: 'gnomon', beard: true },
  { key: 'sushruta', name: 'Sushruta', craft: 'debugger', epithet: 'Surgeon and diagnostician', form: 'human', robe: 0x4f7a55, sash: 0xe8dcc0, skin: 0x86583b, headgear: 'turban', prop: 'pouch' },
  { key: 'gargi', name: 'Gargi Vachaknavi', craft: 'researcher', epithet: 'Philosopher of sharp questions', form: 'human', robe: 0x8e2f45, sash: 0xd9a441, skin: 0x8f5f42, headgear: 'bun', prop: 'leaf' },
  { key: 'ganesha', name: 'Ganesha', craft: 'scribe', epithet: 'Scribe of the Mahabharata', form: 'ganesha', robe: 0xe0b43a, sash: 0xb3342c, skin: 0xc77b5f, headgear: 'crown', prop: 'tusk' },
  { key: 'nandi', name: 'Nandi', craft: 'guardian', epithet: 'Gatekeeper of Kailash', form: 'nandi', robe: 0xebe6dc, sash: 0xf0a030, skin: 0xebe6dc, headgear: 'crown', prop: 'bell' },
  { key: 'manu', name: 'Manu', craft: 'builder', epithet: 'Apprentice of Vishwakarma', form: 'human', robe: 0xb5773a, sash: 0x8f3a2c, skin: 0x8a5a3c, headgear: 'headcloth', prop: 'chisel', apprentice: true },
  { key: 'tvashta', name: 'Tvashta', craft: 'builder', epithet: 'Apprentice of Vishwakarma', form: 'human', robe: 0xa9673a, sash: 0x6f7950, skin: 0x7d5238, headgear: 'headcloth', prop: 'chisel', apprentice: true },
  { key: 'shilpi', name: 'Shilpi', craft: 'builder', epithet: 'Apprentice of Vishwakarma', form: 'human', robe: 0xbf8646, sash: 0x39626a, skin: 0x93613f, headgear: 'headcloth', prop: 'chisel', apprentice: true },
  { key: 'daivajna', name: 'Daivajna', craft: 'builder', epithet: 'Apprentice of Vishwakarma', form: 'human', robe: 0x9f6a3c, sash: 0x7a3d5c, skin: 0x86583b, headgear: 'headcloth', prop: 'chisel', apprentice: true },
] satisfies ArtisanLook[])

export const CRAFT_LABEL: Record<ArtisanCraft, string> = {
  planner: 'Planner', designer: 'Designer', builder: 'Builder', reviewer: 'Reviewer', tester: 'Tester',
  debugger: 'Debugger', researcher: 'Researcher', scribe: 'Scribe', guardian: 'Security guardian',
}
/** Crafts that only read the project by default (mirrors the Core catalog). */
export const READ_ONLY_CRAFTS: ReadonlySet<ArtisanCraft> = new Set(['planner', 'reviewer', 'researcher', 'guardian'])

export function artisanLook(persona?: string, craft?: string): ArtisanLook | undefined {
  const exact = persona ? ARTISAN_LOOKS.find(item => item.key === persona) : undefined
  if (exact) return exact
  const byCraft = craft ? ARTISAN_LOOKS.find(item => item.craft === craft && !item.apprentice) : undefined
  return byCraft && persona ? { ...byCraft, key: persona, name: persona } : byCraft
}

export type ArtisanRecord = {
  id: string
  display_name: string
  persona?: string
  craft?: string
  role?: string
  lifecycle?: string
  retired_at?: string
  state?: string
  task_id?: string
  session_id?: string
  run_id?: string
  last_activity_at?: string
  last_tool?: string
}
export type ArtisanTask = {
  id: string
  project_id: string
  title?: string
  state: string
  agent_id?: string
  session_id?: string
  run_id?: string
  block_reason?: string
  terminal_evidence?: string
  updated_at?: string
}

export const isArtisan = (agent: ArtisanRecord): boolean => agent.lifecycle === 'persistent' && Boolean(agent.persona) && !agent.retired_at

export type ArtisanPlace = 'guild' | 'staging' | 'house' | 'gate'
export type ArtisanPose = 'rest' | 'stand' | 'work' | 'raise' | 'still'
export type ArtisanLamp = 'idle' | 'queued' | 'working' | 'attention' | 'alert' | 'done' | 'unknown'

export interface ArtisanStatus {
  id: string
  name: string
  persona?: string
  craft?: ArtisanCraft
  place: ArtisanPlace
  pose: ArtisanPose
  lamp: ArtisanLamp
  /** Short status for badges and the roster ring. */
  label: string
  /** Longer, truthful explanation of where and why. */
  detail: string
  projectId?: string
  task?: ArtisanTask
  queuedCount: number
  needsYou: boolean
  /** Connection lost: the figure shows its last known place, translucent. */
  ghost: boolean
  /** A real tool call started within the recent activity window. */
  toolActive: boolean
  lastTool?: string
}

const QUEUED = new Set(['draft', 'ready', 'queued_quota', 'queued_dependency', 'queued_workspace', 'queued_concurrency', 'dispatching'])
const RECENT_DONE_MS = 30 * 60_000
const TOOL_ACTIVE_MS = 12_000

export function stagingReason(task: Pick<ArtisanTask, 'state' | 'block_reason'>): string {
  if (task.state === 'dispatching') return 'Setting out for the workshop'
  if (task.state === 'draft') return 'Order drafted, not sent'
  if (task.state === 'ready') return 'Ready at staging'
  const reason = task.block_reason ?? task.state.replace(/^queued_/, '')
  switch (reason) {
    case 'agent_busy': return 'Finishing earlier work first'
    case 'quota': return 'Waiting for provider capacity'
    case 'dependency': return 'Waiting for an earlier order'
    case 'workspace': return 'Workshop in use by another artisan'
    case 'concurrency': return 'Waiting for a free work slot'
    default: return `Waiting · ${reason.replaceAll('_', ' ')}`
  }
}

const byRecent = (left: ArtisanTask, right: ArtisanTask) => (right.updated_at ?? '').localeCompare(left.updated_at ?? '')

/** Truthful place/pose projection for one persistent artisan (spec PT-116 table). */
export function artisanStatus(
  agent: ArtisanRecord,
  tasks: ArtisanTask[],
  messages: TownCommunicationMessage[],
  userId: string,
  liveConnected: boolean,
  now = Date.now(),
): ArtisanStatus {
  const look = artisanLook(agent.persona, agent.craft)
  const own = tasks.filter(task => task.agent_id === agent.id).sort(byRecent)
  const queued = own.filter(task => QUEUED.has(task.state))
  const base = {
    id: agent.id, name: agent.display_name || look?.name || agent.id, persona: agent.persona,
    craft: (agent.craft ?? look?.craft) as ArtisanCraft | undefined,
    ghost: !liveConnected, lastTool: agent.last_tool,
  }
  const running = own.find(task => task.state === 'running')
  const waiting = own.find(task => task.state === 'waiting_user')
  const blocked = own.find(task => task.state === 'blocked')
  let status: Omit<ArtisanStatus, keyof typeof base | 'queuedCount' | 'toolActive'>
  if (running) {
    const linked = agent.task_id === running.id && Boolean(running.session_id && running.run_id)
      && agent.session_id === running.session_id && agent.run_id === running.run_id
    status = linked
      ? { place: 'house', pose: 'work', lamp: 'working', label: 'Working', detail: `Working on “${running.title ?? 'work order'}”`, projectId: running.project_id, task: running, needsYou: false }
      : { place: 'staging', pose: 'stand', lamp: 'unknown', label: 'Unknown', detail: 'Run linkage is not confirmed yet', projectId: running.project_id, task: running, needsYou: false }
  } else if (waiting) {
    const open = messages.some(message => message.task_id === waiting.id && isTownOpenQuestion(message, userId))
    status = open
      ? { place: 'gate', pose: 'raise', lamp: 'attention', label: 'Needs you', detail: `Asking you about “${waiting.title ?? 'work order'}”`, projectId: waiting.project_id, task: waiting, needsYou: true }
      : { place: 'gate', pose: 'still', lamp: 'unknown', label: 'Waiting', detail: 'Paused; the question is not available', projectId: waiting.project_id, task: waiting, needsYou: false }
  } else if (blocked) {
    status = { place: 'gate', pose: 'still', lamp: 'alert', label: 'Blocked', detail: `Blocked${blocked.block_reason ? ` · ${blocked.block_reason}` : ''}`, projectId: blocked.project_id, task: blocked, needsYou: false }
  } else if (queued.length) {
    const next = [...queued].sort((left, right) => (left.updated_at ?? '').localeCompare(right.updated_at ?? ''))[0]!
    status = { place: 'staging', pose: 'stand', lamp: 'queued', label: next.state === 'dispatching' ? 'Setting out' : 'Queued', detail: stagingReason(next), projectId: next.project_id, task: next, needsYou: false }
  } else {
    const latest = own[0]
    if (latest && (latest.state === 'failed' || latest.state === 'interrupted')) {
      status = { place: 'guild', pose: 'still', lamp: 'alert', label: latest.state === 'failed' ? 'Last order failed' : 'Interrupted', detail: latest.terminal_evidence?.slice(0, 200) ?? `Last order ${latest.state}`, projectId: latest.project_id, task: latest, needsYou: false }
    } else if (latest?.state === 'completed' && now - Date.parse(latest.updated_at ?? '') <= RECENT_DONE_MS) {
      status = { place: 'guild', pose: 'rest', lamp: 'done', label: 'Order complete', detail: `Completed “${latest.title ?? 'work order'}”`, projectId: latest.project_id, task: latest, needsYou: false }
    } else {
      status = { place: 'guild', pose: 'rest', lamp: 'idle', label: 'Idle', detail: 'Resting at the Guild Hall', needsYou: false }
    }
  }
  const toolActive = liveConnected && status.pose === 'work' && Boolean(agent.last_activity_at) && now - Date.parse(agent.last_activity_at!) <= TOOL_ACTIVE_MS
  const extra = queued.filter(task => task.id !== status.task?.id).length
  if (!liveConnected) return { ...base, ...status, pose: status.pose === 'work' ? 'still' : status.pose, lamp: 'unknown', label: 'Last known', detail: `Connection lost · last known: ${status.detail}`, queuedCount: extra, toolActive: false }
  return { ...base, ...status, queuedCount: extra, toolActive }
}

const RANK: Record<ArtisanLamp, number> = { attention: 0, alert: 1, working: 2, queued: 3, done: 4, idle: 5, unknown: 6 }
const catalogIndex = (persona?: string) => {
  const index = ARTISAN_LOOKS.findIndex(item => item.key === persona)
  return index < 0 ? ARTISAN_LOOKS.length : index
}
/** Roster order: needs-you first, then trouble, work, queue, rest; catalog order within each. */
export function rosterOrder(statuses: ArtisanStatus[]): ArtisanStatus[] {
  return [...statuses].sort((left, right) => (left.needsYou === right.needsYou ? 0 : left.needsYou ? -1 : 1)
    || RANK[left.lamp] - RANK[right.lamp]
    || catalogIndex(left.persona) - catalogIndex(right.persona)
    || left.name.localeCompare(right.name))
}

/** World point for an artisan's projected place. `slot` spreads artisans sharing a place. */
export function artisanWorldPoint(status: Pick<ArtisanStatus, 'place' | 'projectId'>, layout: ReadonlyMap<string, TownPosition>, slot: number): TownRoadPoint {
  if (status.place === 'guild') {
    // Verandah (thinnai) along the Guild Hall front, facing the road.
    const column = slot % 9 - 4, row = Math.floor(slot / 9) * 1.6
    return { x: GUILD_HALL_SITE.x + GUILD_HALL_SITE.facing * (GUILD_HALL_SITE.width / 2 + 1.2 + row), z: GUILD_HALL_SITE.z + column * 1.45 }
  }
  if (status.place === 'staging' || !status.projectId || !layout.get(status.projectId)) return stagingPoint(slot)
  const lot = layout.get(status.projectId)!
  const offset = (slot % 3 - 1) * 1.4
  const toward = { x: lot.x - lot.entrance.x, z: lot.z - lot.entrance.z }
  const length = Math.hypot(toward.x, toward.z) || 1
  const across = { x: -toward.z / length, z: toward.x / length }
  if (status.place === 'gate') return { x: lot.entrance.x + across.x * offset, z: lot.entrance.z + across.z * offset }
  // Workbench: part way from the gate toward the house, in front of its door.
  const reach = Math.max(1.5, length - Math.max(lot.footprintWidth, lot.footprintDepth) / 2 - 1.2)
  return { x: lot.entrance.x + toward.x / length * reach + across.x * offset, z: lot.entrance.z + toward.z / length * reach + across.z * offset }
}

function stagingPoint(slot: number): TownRoadPoint {
  const columns = 4
  const column = slot % columns - (columns - 1) / 2
  const row = Math.floor(slot / columns)
  return { x: STAGING_SITE.x - 2 + row * 1.8, z: STAGING_SITE.z + column * 2 }
}

/** Assign stable slots: artisans sharing the same place/project get consecutive slots in roster order. */
export function artisanSlots(statuses: ArtisanStatus[]): Map<string, number> {
  const counters = new Map<string, number>()
  const slots = new Map<string, number>()
  for (const status of [...statuses].sort((left, right) => catalogIndex(left.persona) - catalogIndex(right.persona) || left.id.localeCompare(right.id))) {
    const key = status.place === 'house' || status.place === 'gate' ? `${status.place}:${status.projectId}` : status.place
    const next = counters.get(key) ?? 0
    slots.set(status.id, next)
    counters.set(key, next + 1)
  }
  return slots
}

const key = (point: TownRoadPoint) => `${Math.round(point.x)},${Math.round(point.z)}`

/** Undirected road graph built from the layout's routed polylines. */
export function townRoadGraph(roads: TownRoadPoint[][]): Map<string, { point: TownRoadPoint; next: Set<string> }> {
  const graph = new Map<string, { point: TownRoadPoint; next: Set<string> }>()
  const node = (point: TownRoadPoint) => {
    const id = key(point)
    let entry = graph.get(id)
    if (!entry) { entry = { point: { x: Math.round(point.x), z: Math.round(point.z) }, next: new Set() }; graph.set(id, entry) }
    return id
  }
  for (const road of roads) {
    for (let index = 0; index < road.length; index++) {
      const current = node(road[index]!)
      if (index === 0) continue
      const previous = key(road[index - 1]!)
      if (previous === current) continue
      graph.get(current)!.next.add(previous)
      graph.get(previous)!.next.add(current)
    }
  }
  return graph
}

function nearestNode(graph: ReturnType<typeof townRoadGraph>, point: TownRoadPoint): string | undefined {
  let best: string | undefined, distance = Infinity
  for (const [id, entry] of graph) {
    const d = (entry.point.x - point.x) ** 2 + (entry.point.z - point.z) ** 2
    if (d < distance) { distance = d; best = id }
  }
  return best
}

/** Walking route along roads between two world points; straight line when no road connects them. */
export function townWalkRoute(layout: Pick<TownLayout, 'roads'>, from: TownRoadPoint, to: TownRoadPoint, graph = townRoadGraph(layout.roads)): TownRoadPoint[] {
  if (Math.hypot(from.x - to.x, from.z - to.z) < 6) return [from, to]
  const start = nearestNode(graph, from), goal = nearestNode(graph, to)
  if (!start || !goal) return [from, to]
  const previous = new Map<string, string | null>([[start, null]])
  const queue = [start]
  for (let cursor = 0; cursor < queue.length && !previous.has(goal); cursor++) {
    for (const next of graph.get(queue[cursor]!)!.next) {
      if (previous.has(next)) continue
      previous.set(next, queue[cursor]!)
      queue.push(next)
    }
  }
  if (!previous.has(goal)) return [from, to]
  const path: TownRoadPoint[] = []
  for (let id: string | null | undefined = goal; id; id = previous.get(id)) path.push(graph.get(id)!.point)
  path.reverse()
  return simplifyRoute([from, ...path, to])
}

/** Drop interior points that continue in the same direction. */
export function simplifyRoute(points: TownRoadPoint[]): TownRoadPoint[] {
  const output: TownRoadPoint[] = []
  for (const point of points) {
    const last = output.at(-1)
    if (last && Math.hypot(last.x - point.x, last.z - point.z) < 1e-6) continue
    if (output.length >= 2) {
      const a = output.at(-2)!, b = output.at(-1)!
      const cross = (b.x - a.x) * (point.z - b.z) - (b.z - a.z) * (point.x - b.x)
      const dot = (b.x - a.x) * (point.x - b.x) + (b.z - a.z) * (point.z - b.z)
      if (Math.abs(cross) < 1e-6 && dot > 0) { output[output.length - 1] = point; continue }
    }
    output.push(point)
  }
  return output
}

export const LAMP_COLOR: Record<ArtisanLamp, number> = {
  idle: 0xd9b36a, queued: 0xffb347, working: 0xfff1b8, attention: 0xffa21f, alert: 0xff4d3a, done: 0x7ddc84, unknown: 0x9aa0a6,
}
