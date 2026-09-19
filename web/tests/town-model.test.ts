import { describe, expect, it } from 'vitest'
import { buildingForm, layoutProjects, projectBuildingAppearance, TEMPLE_SITE, townCentralDistrictRadius, townLoadState, townOverviewDistance, type TownPosition } from '../app/town/town-model'
import { angularSeparationDegrees, BIRDS_PER_FLOCK_LIMIT, BIRD_FLOCK_LIMIT, CLOUD_FORM_LIMIT, HISTORICAL_REFERENCES, TOWN_DEFAULT_CAMERA_POSITION_DIRECTION, TOWN_MODE_KEY, TOWN_MOON_DIRECTION, isTownHumanEndpoint, nightLampSites, parseTownMode, projectAgentPresence, townAnswerReceiptLabel, townCommunicationMarker, townConversationGroups, townLayoutStamp, townSceneLighting, workerAnimation } from '../app/town/town-world-model'

const now = Date.parse('2026-09-13T00:00:00.000Z')
function project(id: string, ageDays?: number) {
  return { id, git: { status: ageDays === undefined ? 'unknown' : 'known', ...(ageDays === undefined ? {} : { last_commit_at: new Date(now - ageDays * 86_400_000).toISOString() }) } }
}
function roadSamples(a: { x: number; z: number }, b: { x: number; z: number }) {
  return [0, .25, .5, .75, 1].map(t => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }))
}
function lotEdgeDistance(point: { x: number; z: number }, lot: { x: number; z: number; lotWidth: number; lotDepth: number }) {
  const dx = Math.max(0, Math.abs(point.x - lot.x) - lot.lotWidth / 2)
  const dz = Math.max(0, Math.abs(point.z - lot.z) - lot.lotDepth / 2)
  return Math.hypot(dx, dz)
}

describe('town model', () => {
  it('recognizes the Core literal user endpoint alongside the session identity', () => {
    expect(isTownHumanEndpoint('user', 'web-user')).toBe(true)
    expect(isTownHumanEndpoint('web-user', 'web-user')).toBe(true)
    expect(isTownHumanEndpoint('coding', 'web-user')).toBe(false)
  })
  it('collapses durable communication into one priority marker per anchor', () => {
    const tasks = [{ id: 'task-1', project_id: 'repo-a', agent_id: 'agent-1', state: 'running', session_id: 'session-1', run_id: 'run-1' }]
    const agents = [{ id: 'agent-1', display_name: 'Kaveri', task_id: 'task-1', session_id: 'session-1', run_id: 'run-1' }]
    const messages = [{ project_id: 'repo-a', task_id: 'task-1', from: 'Kaveri', to: 'user', kind: 'question' as const, state: 'delivered', continuation_id: 'pending-1' }]
    expect(townCommunicationMarker({ messages, tasks, agents, anchor: { type: 'project', id: 'repo-a' }, userId: 'user' })).toMatchObject({ kind: 'question', glyph: '?', count: 1 })
    expect(townCommunicationMarker({ messages: [], tasks, agents, anchor: { type: 'agent', id: 'agent-1' }, userId: 'user' })).toMatchObject({ kind: 'working', glyph: '…' })
  })

  it('keeps council records grouped by durable task and thread, with questions and handoffs visible', () => {
    const messages = [
      { project_id: 'repo-a', task_id: 'task-1', thread_id: 'run-1', from: 'a', to: 'b', kind: 'status' as const, state: 'delivered', created_at: '2026-01-01T00:00:00Z' },
      { project_id: 'repo-a', task_id: 'task-1', thread_id: 'run-1', from: 'a', to: 'b', kind: 'handoff' as const, state: 'delivered', created_at: '2026-01-01T00:01:00Z' },
      { project_id: 'repo-a', task_id: 'task-2', thread_id: 'run-2', from: 'c', to: 'd', kind: 'question' as const, state: 'delivered', created_at: '2026-01-01T00:02:00Z' },
    ]
    const groups = townConversationGroups(messages)
    expect(groups).toHaveLength(2)
    expect(groups[0]?.messages.map(message => message.kind)).toEqual(['question'])
    expect(groups[1]?.messages.map(message => message.kind)).toEqual(['handoff'])
    expect(groups[1]?.earlierStatusCount).toBe(1)
  })

  it('labels receipts from the persisted continuation outcome', () => {
    expect(townAnswerReceiptLabel({ answer_outcome: { resumed: true, state: 'running' } })).toBe('Reply received — resuming work')
    expect(townAnswerReceiptLabel({ answer_outcome: { resumed: false, state: 'queued_quota' } })).toBe('Reply received — waiting for quota')
    expect(townAnswerReceiptLabel({ answer_outcome: { resumed: false, error: 'question continuation no longer matches its durable run' } })).toContain('could not resume')
  })

  it('does not turn a truthful queued receipt into a failure marker', () => {
    const marker = townCommunicationMarker({
      messages: [{ project_id: 'repo-a', task_id: 'task-1', from: 'user', to: 'coding', kind: 'answer', state: 'delivered', answer_outcome: { resumed: false, state: 'queued_quota' } }],
      tasks: [], agents: [], anchor: { type: 'project', id: 'repo-a' }, userId: 'web-user',
    })
    expect(marker?.kind).toBeUndefined()
  })

  it('keeps dispatch preparation distinct from a running work loop', () => {
    expect(workerAnimation({ id: 'a', name: 'A', label: 'Preparing dispatch', pose: 'waiting', taskState: 'dispatching', position: { x: 0, z: 0 } }, false)).toBe('prep-loop')
    expect(workerAnimation({ id: 'a', name: 'A', label: 'Preparing dispatch', pose: 'waiting', taskState: 'dispatching', position: { x: 0, z: 0 } }, true)).toBe('still')
  })
  it('reserves one measured temple site and creates stable project identities independent of size tier', () => {
    expect(TEMPLE_SITE).toMatchObject({ width: 26, depth: 32, maxHeight: 25, entrance: { x: 0, z: 16 }, clearance: 5, minX: -13, maxX: 13, minZ: -16, maxZ: 16 })
    const first = projectBuildingAppearance('repo-alpha')
    expect(first).toEqual(projectBuildingAppearance('repo-alpha'))
    expect(first.heightScale).toBeGreaterThanOrEqual(.9)
    expect(first.heightScale).toBeLessThanOrEqual(1.35)
    const appearances = Array.from({ length: 48 }, (_, index) => projectBuildingAppearance(`repo-${index}`))
    expect(new Set(appearances.map(item => item.variant)).size).toBeGreaterThanOrEqual(6)
    expect(new Set(appearances.map(item => item.wallColor)).size).toBeGreaterThanOrEqual(8)
    expect(new Set(appearances.map(item => item.roofColor)).size).toBeGreaterThanOrEqual(8)
    expect(new Set(appearances.map(item => item.heightScale.toFixed(3))).size).toBeGreaterThan(30)
  })

  it('keeps the temple entrance connected while reserving the courtyard and clearance from every lot', () => {
    const projects = Array.from({ length: 42 }, (_, index) => ({
      ...project(`temple-repo-${index}`, index % 7),
      size: { source: 'git_tracked_regular_files' as const, status: 'complete' as const, tracked_regular_files: [50, 200, 750, 2500][index % 4], measured_at: '2026-09-13T00:00:00.000Z', max_entries: 10_000 },
    }))
    const layout = layoutProjects(projects, new Set(projects.slice(0, 9).map(item => item.id)), new Set(), now)
    for (const item of layout.values()) {
      const dx = Math.max(0, Math.abs(item.x) - item.lotWidth / 2 - TEMPLE_SITE.width / 2)
      const dz = Math.max(0, Math.abs(item.z) - item.lotDepth / 2 - TEMPLE_SITE.depth / 2)
      expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(TEMPLE_SITE.clearance)
      expect(item.road.length).toBeGreaterThan(1)
    }
    const approach = layout.roads.find(route => route.some(point => point.x === TEMPLE_SITE.entrance.x && point.z === TEMPLE_SITE.entrance.z))
    expect(approach?.at(-1)).toEqual(TEMPLE_SITE.entrance)
    expect(approach?.some(point => point.x === 0 && point.z > TEMPLE_SITE.entrance.z)).toBe(true)
    expect(approach?.every(point => point.z >= TEMPLE_SITE.entrance.z || point.x < TEMPLE_SITE.minX || point.x > TEMPLE_SITE.maxX || point.z < TEMPLE_SITE.minZ || point.z > TEMPLE_SITE.maxZ)).toBe(true)
  })

  it('places active, pinned, recent, established, quiet, and unknown projects in ordered bands', () => {
    const projects = [project('unknown'), project('quiet', 120), project('established', 30), project('recent', 2), project('pinned', 120), project('active', 200)]
    const positions = layoutProjects(projects, new Set(['active']), new Set(['pinned']), now)
    expect(positions.get('active')?.band).toBe('active')
    expect(positions.get('pinned')?.band).toBe('pinned')
    expect(positions.get('recent')?.band).toBe('recent')
    expect(positions.get('established')?.band).toBe('established')
    expect(positions.get('quiet')?.band).toBe('quiet')
    expect(positions.get('unknown')?.band).toBe('unknown')
    expect([...positions.values()].map(item => item.band)).toEqual(['active', 'pinned', 'recent', 'established', 'quiet', 'unknown'])
  })

  it('allocates deterministic separated slots, including overflow subrings', () => {
    const projects = Array.from({ length: 120 }, (_, index) => project(`repo-${String(index).padStart(3, '0')}`, 2))
    const first = layoutProjects(projects, new Set(), new Set(), now)
    const second = layoutProjects([...projects].reverse(), new Set(), new Set(), now)
    expect([...first.entries()]).toEqual([...second.entries()])
    const placed = [...first.values()]
    expect(Math.max(...placed.map(item => item.radius))).toBeGreaterThan(23)
    for (let left = 0; left < placed.length; left++) for (let right = left + 1; right < placed.length; right++) {
      expect(Math.hypot(placed[left].x - placed[right].x, placed[left].z - placed[right].z)).toBeGreaterThan(6.49)
    }
  })

  it('scatters same-district homes with stable per-id radial variation and bounded countryside trees', () => {
    const projects = Array.from({ length: 36 }, (_, index) => project(`hamlet-${String(index).padStart(2, '0')}`, 2))
    const first = layoutProjects(projects, new Set(), new Set(), now)
    const second = layoutProjects([...projects].reverse(), new Set(), new Set(), now)
    expect([...first.entries()]).toEqual([...second.entries()])
    expect(new Set([...first.values()].map(item => item.radius.toFixed(2))).size).toBeGreaterThan(24)
    expect(first.trees.length).toBeGreaterThanOrEqual(40)
    expect(first.trees.length).toBeLessThanOrEqual(52)
  })

  it('moves inactive age districts beyond the live inner-town property envelope, deterministically and with connected roads', () => {
    const projects = [
      ...Array.from({ length: 5 }, (_, index) => project(`active-${String(index).padStart(2, '0')}`, 2)),
      ...Array.from({ length: 3 }, (_, index) => project(`pinned-${String(index).padStart(2, '0')}`, 120)),
      ...Array.from({ length: 5 }, (_, index) => project(`recent-${String(index).padStart(2, '0')}`, 2)),
      ...Array.from({ length: 4 }, (_, index) => project(`established-${String(index).padStart(2, '0')}`, 30)),
      ...Array.from({ length: 4 }, (_, index) => project(`quiet-${String(index).padStart(2, '0')}`, 120)),
      ...Array.from({ length: 4 }, (_, index) => project(`unknown-${String(index).padStart(2, '0')}`)),
    ].map((item, index) => ({
      ...item,
      size: { source: 'git_tracked_regular_files' as const, status: 'complete' as const, tracked_regular_files: [50, 200, 750, 2500][index % 4], measured_at: '2026-09-13T00:00:00.000Z', max_entries: 10_000 },
    }))
    const activeIds = new Set(projects.filter(item => item.id.startsWith('active-')).map(item => item.id))
    const pinnedIds = new Set(projects.filter(item => item.id.startsWith('pinned-')).map(item => item.id))
    const layout = layoutProjects(projects, activeIds, pinnedIds, now)
    const reversed = layoutProjects([...projects].reverse(), activeIds, pinnedIds, now)
    expect([...layout.entries()]).toEqual([...reversed.entries()])

    const boundary = (item: TownPosition) => item.radius + Math.hypot(item.lotWidth, item.lotDepth) / 2
    const inner = [...layout.values()].filter(item => ['active', 'pinned', 'recent'].includes(item.band))
    const established = [...layout.values()].filter(item => item.band === 'established')
    const quiet = [...layout.values()].filter(item => item.band === 'quiet')
    const unknown = [...layout.values()].filter(item => item.band === 'unknown')
    const innerEnvelope = Math.max(...inner.map(boundary))
    const establishedEnvelope = Math.max(...established.map(boundary))
    const quietEnvelope = Math.max(...quiet.map(boundary))
    const minimumInnerEdge = (items: TownPosition[]) => Math.min(...items.map(item => item.radius - Math.hypot(item.lotWidth, item.lotDepth) / 2))
    expect(minimumInnerEdge(established)).toBeGreaterThanOrEqual(innerEnvelope + 5)
    expect(minimumInnerEdge(quiet)).toBeGreaterThanOrEqual(establishedEnvelope + 5)
    expect(minimumInnerEdge(unknown)).toBeGreaterThanOrEqual(quietEnvelope + 5)
    expect(townCentralDistrictRadius(layout.values())).toBe(townCentralDistrictRadius(inner))
    for (const item of layout.values()) expect(item.road.length).toBeGreaterThan(1)
    for (const item of layout.values()) expect(item.road.length).toBeGreaterThan(1)
  })

  it('adapts inactive district starts when a dense active district overflows its nominal rings', () => {
    const projects = [
      ...Array.from({ length: 48 }, (_, index) => project(`busy-${String(index).padStart(2, '0')}`, 1)),
      ...Array.from({ length: 5 }, (_, index) => project(`old-${String(index).padStart(2, '0')}`, 120)),
    ]
    const activeIds = new Set(projects.filter(item => item.id.startsWith('busy-')).map(item => item.id))
    const layout = layoutProjects(projects, activeIds, new Set(), now)
    const activeEnvelope = Math.max(...[...layout.values()].filter(item => item.band === 'active').map(item => item.radius + Math.hypot(item.lotWidth, item.lotDepth) / 2))
    const inactiveInnerEdge = Math.min(...[...layout.values()].filter(item => item.band === 'quiet').map(item => item.radius - Math.hypot(item.lotWidth, item.lotDepth) / 2))
    expect(activeEnvelope).toBeGreaterThan(60)
    expect(inactiveInnerEdge).toBeGreaterThanOrEqual(activeEnvelope + 5)
    for (const item of layout.values()) expect(item.road.length).toBeGreaterThan(1)
  })

  it('frames the default overview around the inner district when outer repositories are present', () => {
    const projects = [project('active', 1), project('recent', 2), project('inactive', 120)]
    const all = layoutProjects(projects, new Set(['active']), new Set(), now)
    const inner = layoutProjects(projects.filter(item => item.id !== 'inactive'), new Set(['active']), new Set(), now)
    expect(townCentralDistrictRadius(all.values())).toBe(townCentralDistrictRadius(inner.values()))
    expect(Math.max(...[...all.values()].map(item => item.radius))).toBeGreaterThan(townCentralDistrictRadius(all.values()))
  })

  it('distinguishes loading, unavailable, and populated registry states', () => {
    expect(townLoadState(null, '')).toBe('loading')
    expect(townLoadState(null, 'offline')).toBe('unavailable')
    expect(townLoadState({ projects: [] }, '')).toBe('ready')
  })

  it('fits the complete overview to the narrower camera field of view', () => {
    const narrow = townOverviewDistance(48, 390, 600)
    const wide = townOverviewDistance(48, 1200, 800)
    expect(narrow).toBeGreaterThan(wide)
    const aspect = 390 / 600
    const verticalFov = 44 * Math.PI / 180
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
    const halfFov = Math.min(verticalFov, horizontalFov) / 2
    expect(narrow * Math.sin(halfFov)).toBeGreaterThanOrEqual(Math.hypot(48, 12) * 1.079)
  })

  it('maps complete size metrics to stable Tamil forms and gives unavailable size a neutral form', () => {
    const tiers = [[0,'veranda-house'],[99,'veranda-house'],[100,'tamil-workshop'],[499,'tamil-workshop'],[500,'courtyard-house'],[1999,'courtyard-house'],[2000,'courtyard-compound']] as const
    for (const [count, form] of tiers) expect(buildingForm({ source: 'git_tracked_regular_files', status: 'complete', tracked_regular_files: count, measured_at: '2026-09-13T00:00:00.000Z', max_entries: 10_000 })).toBe(form)
    for (const status of ['partial','unknown','error'] as const) expect(buildingForm({ source: 'git_tracked_regular_files', status, measured_at: '2026-09-13T00:00:00.000Z', max_entries: 10_000 })).toBe('neutral-workshop')
    expect(buildingForm(undefined)).toBe('neutral-workshop')
  })

  it('places mixed-size lots deterministically with five-unit pair clearance and reserved temple frontage', () => {
    const projects = Array.from({ length: 120 }, (_, index) => ({
      ...project(`repo-${String(index).padStart(3, '0')}`, index % 5),
      size: { source: 'git_tracked_regular_files' as const, status: 'complete' as const, tracked_regular_files: [50, 200, 750, 2500][index % 4], measured_at: '2026-09-13T00:00:00.000Z', max_entries: 10_000 },
    }))
    const first = layoutProjects(projects, new Set(['repo-000']), new Set(['repo-001']), now)
    const second = layoutProjects([...projects].reverse(), new Set(['repo-000']), new Set(['repo-001']), now)
    expect([...first.entries()]).toEqual([...second.entries()])
    const placed = [...first.values()]
    for (let left = 0; left < placed.length; left++) {
      const item = placed[left]
      expect(item.form).toBe(buildingForm(projects.find(candidate => candidate.id === item.id)?.size))
      const templeGapX = Math.max(0, Math.abs(item.x) - item.lotWidth / 2 - TEMPLE_SITE.width / 2)
      const templeGapZ = Math.max(0, Math.abs(item.z) - item.lotDepth / 2 - TEMPLE_SITE.depth / 2)
      expect(Math.hypot(templeGapX, templeGapZ)).toBeGreaterThanOrEqual(TEMPLE_SITE.clearance)
      for (let right = left + 1; right < placed.length; right++) {
        const other = placed[right]
        const dx = Math.max(0, Math.abs(item.x - other.x) - (item.lotWidth + other.lotWidth) / 2)
        const dz = Math.max(0, Math.abs(item.z - other.z) - (item.lotDepth + other.lotDepth) / 2)
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(5)
      }
    }
    expect(Math.max(...placed.map(item => item.radius))).toBeGreaterThan(70)
  }, 10_000)

  it('connects all 62 office entrances and keeps every road segment clear of lots, temple courtyard, trees, and references', () => {
    const projects = Array.from({ length: 62 }, (_, index) => ({ ...project(`office-${index}`, index % 8), size: { source: 'git_tracked_regular_files' as const, status: 'complete' as const, tracked_regular_files: [50, 200, 750, 2500][index % 4], measured_at: '2026-09-13T00:00:00.000Z', max_entries: 10_000 } }))
    const positions = layoutProjects(projects, new Set(), new Set(), now)
    expect(positions.size).toBe(projects.length)
    for (const item of positions.values()) expect(item.road.length).toBeGreaterThan(0)

    const graph = new Map<string, Set<string>>()
    const key = (point: { x: number; z: number }) => `${point.x},${point.z}`
    for (const route of positions.roads) if (route.length === 1) graph.set(key(route[0]), graph.get(key(route[0])) ?? new Set())
    for (const route of positions.roads) for (let index = 1; index < route.length; index++) {
      const a = key(route[index - 1]), b = key(route[index])
      graph.set(a, (graph.get(a) ?? new Set()).add(b))
      graph.set(b, (graph.get(b) ?? new Set()).add(a))
      for (const point of roadSamples(route[index - 1], route[index])) {
        const templeGapX = Math.max(0, Math.abs(point.x) - TEMPLE_SITE.width / 2)
        const templeGapZ = Math.max(0, Math.abs(point.z) - TEMPLE_SITE.depth / 2)
        const templeApproach = point.z >= TEMPLE_SITE.entrance.z && Math.abs(point.x) <= 2
        expect(Math.hypot(templeGapX, templeGapZ) >= TEMPLE_SITE.clearance || templeApproach).toBe(true)
        for (const lot of positions.values()) expect(lotEdgeDistance(point, lot)).toBeGreaterThanOrEqual(.65)
        for (const tree of positions.trees) expect(Math.hypot(point.x - tree.x, point.z - tree.z)).toBeGreaterThanOrEqual(6)
        for (const reference of HISTORICAL_REFERENCES) expect(Math.hypot(point.x - reference.x, point.z - reference.z)).toBeGreaterThanOrEqual(reference.radius + 2)
      }
    }

    const reachable = new Set<string>([key({ x: 0, z: 16 })]), queue = [...reachable]
    for (let cursor = 0; cursor < queue.length; cursor++) for (const next of graph.get(queue[cursor]) ?? []) if (!reachable.has(next)) { reachable.add(next); queue.push(next) }
    for (const item of positions.values()) expect(reachable.has(key(item.entrance))).toBe(true)
  }, 20_000)

  it('projects exactly one truthful person per actual agent and animates only fully linked running work', () => {
    const offices = layoutProjects([project('home'), project('task')], new Set(), new Set(), now)
    const agents = [
      { id: 'idle', display_name: 'Idle', state: 'idle', home_project_id: 'home' },
      { id: 'worker', display_name: 'Worker', state: 'working', home_project_id: 'home', task_id: 'valid', session_id: 's1', run_id: 'r1' },
      { id: 'stale', display_name: 'Stale', state: 'working', home_project_id: 'home', task_id: 'invalid', session_id: 'old', run_id: 'old' },
      { id: 'queued', display_name: 'Queued', state: 'idle', home_project_id: 'home', task_id: 'queue' },
      { id: 'attention', display_name: 'Attention', state: 'waiting_user', home_project_id: 'home', task_id: 'question' },
      { id: 'failed', display_name: 'Failed', state: 'failed', home_project_id: 'home' },
      { id: 'unknown', display_name: 'No project', state: 'unknown' },
    ]
    const tasks = [
      { id: 'valid', project_id: 'task', agent_id: 'worker', state: 'running', session_id: 's1', run_id: 'r1', title: 'Build' },
      { id: 'invalid', project_id: 'task', agent_id: 'stale', state: 'running', session_id: 'new', run_id: 'new' },
      { id: 'queue', project_id: 'task', agent_id: 'queued', state: 'queued_quota', session_id: 's2', run_id: 'r2' },
      { id: 'question', project_id: 'task', agent_id: 'attention', state: 'waiting_user', session_id: 's3', run_id: 'r3' },
    ]
    const projected = projectAgentPresence(agents, tasks, offices)
    expect(projected).toHaveLength(agents.length)
    expect(new Set(projected.map(person => person.id)).size).toBe(agents.length)
    expect(projected.find(person => person.id === 'worker')).toMatchObject({ pose: 'working', projectId: 'task', sessionId: 's1', runId: 'r1' })
    expect(workerAnimation(projected.find(person => person.id === 'worker')!, false)).toBe('tool-loop')
    expect(workerAnimation(projected.find(person => person.id === 'worker')!, true)).toBe('still')
    expect(projected.find(person => person.id === 'stale')).toMatchObject({ pose: 'unknown', label: 'Unknown activity', projectId: 'home' })
    expect(projected.find(person => person.id === 'queued')).toMatchObject({ pose: 'waiting', projectId: 'home' })
    expect(projected.find(person => person.id === 'attention')).toMatchObject({ pose: 'attention', projectId: 'task' })
    expect(projected.find(person => person.id === 'failed')).toMatchObject({ pose: 'stopped', projectId: 'home' })
    expect(projected.find(person => person.id === 'unknown')).toMatchObject({ pose: 'unknown', position: { x: 0, z: 0 } })
    expect(projected.filter(person => person.pose === 'working')).toHaveLength(1)
  })

  it('keeps Day as a route-local default and leaves geometry identity independent of mode or runtime updates', () => {
    expect(TOWN_MODE_KEY).toBe('harness-town-scene-mode')
    expect(parseTownMode(null)).toBe('day')
    expect(parseTownMode('night')).toBe('night')
    expect(parseTownMode('dark')).toBe('day')
    expect(townLayoutStamp(['a', 'b'], 3)).toBe(townLayoutStamp(['b', 'a'], 3))
    expect(townLayoutStamp(['a', 'b'], 3)).not.toBe(townLayoutStamp(['a', 'b'], 4))
  })

  it('bounds night lights, clouds, flocks and sourced inanimate historical references', () => {
    const offices = layoutProjects(Array.from({ length: 120 }, (_, index) => project(`office-${index}`)), new Set(), new Set(), now)
    expect(nightLampSites(offices)).toHaveLength(24)
    expect(nightLampSites(new Map(), 100).length).toBeLessThanOrEqual(24)
    expect(CLOUD_FORM_LIMIT).toBe(12)
    expect(BIRD_FLOCK_LIMIT).toBe(3)
    expect(BIRDS_PER_FLOCK_LIMIT).toBe(7)
    expect(HISTORICAL_REFERENCES).toHaveLength(3)
    expect(new Set(HISTORICAL_REFERENCES.map(item => item.id)).size).toBe(3)
    for (const item of HISTORICAL_REFERENCES) {
      expect(item.caption).toMatch(/interpretive|commemorates/)
      expect(item.href).toMatch(/^https:\/\//)
      expect(item).not.toHaveProperty('agent_id')
      expect(item).not.toHaveProperty('task_id')
    }
    expect(HISTORICAL_REFERENCES.find(item => item.id === 'aryabhata')?.caption).toMatch(/not alive in 1000/)
    expect(HISTORICAL_REFERENCES.find(item => item.id === 'brahmagupta')?.caption).toMatch(/not alive in 1000/)
  })

  it('lights every small-town entrance before spreading the capped lamp network across larger towns', () => {
    const small = layoutProjects(Array.from({ length: 8 }, (_, index) => project(`small-${index}`)), new Set(), new Set(), now)
    const smallLights = nightLampSites(small)
    expect(smallLights).toHaveLength(12)
    for (const project of small.values()) expect(smallLights).toContainEqual(project.entrance)

    const large = layoutProjects(Array.from({ length: 62 }, (_, index) => project(`large-${index}`)), new Set(), new Set(), now)
    const distributed = nightLampSites(large)
    expect(distributed).toHaveLength(24)
    const entrances = [...large.values()].map(project => project.entrance)
    const homeLights = distributed.filter(site => entrances.some(entrance => entrance.x === site.x && entrance.z === site.z))
    expect(homeLights).toHaveLength(20)
    expect(Math.max(...homeLights.map(site => Math.hypot(site.x, site.z)))).toBeGreaterThan(Math.max(...entrances.map(site => Math.hypot(site.x, site.z))) * .8)
    for (const quadrant of [[1,1], [1,-1], [-1,1], [-1,-1]]) {
      expect(homeLights.filter(site => site.x * quadrant[0] >= 0 && site.z * quadrant[1] >= 0).length).toBeGreaterThanOrEqual(3)
    }
  })

  it('reserves central night lamps before sampling distant inactive districts', () => {
    const projects = [
      ...Array.from({ length: 8 }, (_, index) => project(`active-${index}`, 120)),
      ...Array.from({ length: 48 }, (_, index) => project(`quiet-${index}`, 120)),
    ]
    const active = new Set(projects.slice(0, 8).map(item => item.id))
    const layout = layoutProjects(projects, active, new Set(), now)
    const lights = nightLampSites(layout)
    const activeEntrances = [...layout.values()].filter(item => item.band === 'active').map(item => item.entrance)
    expect(lights.length).toBeLessThanOrEqual(24)
    expect(activeEntrances.filter(entrance => lights.some(light => light.x === entrance.x && light.z === entrance.z)).length).toBeGreaterThanOrEqual(6)
  })

  it('uses neutral moonlight and a fixed elevated celestial direction', () => {
    const night = townSceneLighting('night')
    expect(night.sky).toBe(0x24272a)
    expect(night.hemisphereColor).toBe(0xd1d0c6)
    expect(night.directionalColor).toBe(0xe7e3d4)
    expect(night.ground).toBe(0x8c9279)
    expect(night.lamp).toBeGreaterThan(townSceneLighting('day').lamp)
    expect(night.shadows).toBe(false)
    expect(TOWN_MOON_DIRECTION.y).toBeGreaterThan(0)
    expect(Math.hypot(TOWN_MOON_DIRECTION.x, TOWN_MOON_DIRECTION.y, TOWN_MOON_DIRECTION.z)).toBeGreaterThan(.99)
    expect(angularSeparationDegrees(TOWN_MOON_DIRECTION, { x: -TOWN_DEFAULT_CAMERA_POSITION_DIRECTION.x, y: -TOWN_DEFAULT_CAMERA_POSITION_DIRECTION.y, z: -TOWN_DEFAULT_CAMERA_POSITION_DIRECTION.z })).toBeLessThan(22)
  })

})
