export interface ActivityProject {
  git: { last_commit_at?: string; status: string }
}

export interface TrackedFileSize {
  source: 'git_tracked_regular_files'
  status: 'complete' | 'partial' | 'unknown' | 'error'
  tracked_regular_files?: number
  measured_at: string
  max_entries: number
  error?: string
}

export type BuildingForm = 'veranda-house' | 'tamil-workshop' | 'courtyard-house' | 'courtyard-compound' | 'neutral-workshop'
export interface BuildingSpec { label: string; width: number; depth: number; lotWidth: number; lotDepth: number }
export interface TownBuildingAppearance { variant: number; wallColor: number; roofColor: number; heightScale: number }

/** One architectural site contract shared by layout, roads, focus, and the asset. */
export const TEMPLE_SITE = Object.freeze({
  width: 26,
  depth: 32,
  maxHeight: 25,
  entrance: Object.freeze({ x: 0, z: 16 }),
  clearance: 5,
  minX: -13,
  maxX: 13,
  minZ: -16,
  maxZ: 16,
})

const FORM_SPECS: Record<BuildingForm, BuildingSpec> = {
  'veranda-house': { label: 'Veranda house', width: 4, depth: 4, lotWidth: 10, lotDepth: 10 },
  'tamil-workshop': { label: 'Tamil workshop', width: 6, depth: 5, lotWidth: 13, lotDepth: 12 },
  'courtyard-house': { label: 'Courtyard house', width: 8, depth: 7, lotWidth: 16, lotDepth: 15 },
  'courtyard-compound': { label: 'Courtyard compound', width: 11, depth: 9, lotWidth: 20, lotDepth: 18 },
  'neutral-workshop': { label: 'Size unavailable', width: 6, depth: 5, lotWidth: 13, lotDepth: 12 },
}

export function buildingForm(size?: TrackedFileSize): BuildingForm {
  if (size?.status !== 'complete' || !Number.isSafeInteger(size.tracked_regular_files) || (size.tracked_regular_files ?? -1) < 0) return 'neutral-workshop'
  const count = size.tracked_regular_files!
  if (count < 100) return 'veranda-house'
  if (count < 500) return 'tamil-workshop'
  if (count < 2_000) return 'courtyard-house'
  return 'courtyard-compound'
}

export const buildingSpec = (form: BuildingForm): BuildingSpec => FORM_SPECS[form]

export interface LayoutProject extends ActivityProject { id: string; size?: TrackedFileSize }
export interface TownRoadPoint { x: number; z: number }
export interface TownPosition extends TownRoadPoint {
  id: string
  radius: number
  angle: number
  band: 'active' | 'pinned' | 'recent' | 'established' | 'quiet' | 'unknown'
  form: BuildingForm
  footprintWidth: number
  footprintDepth: number
  lotWidth: number
  lotDepth: number
  entrance: TownRoadPoint
  road: TownRoadPoint[]
}
export interface TownLayout extends Map<string, TownPosition> {
  roads: TownRoadPoint[][]
  trees: TownRoadPoint[]
  terrainRadius: number
}

const NOMINAL_RADIUS = { active: 14, pinned: 22, recent: 31, established: 74, quiet: 120, unknown: 172 } as const
const BAND_ORDER: TownPosition['band'][] = ['active', 'pinned', 'recent', 'established', 'quiet', 'unknown']
const INNER_DISTRICT_BANDS = new Set<TownPosition['band']>(['active', 'pinned', 'recent'])
const PROPERTY_CLEARANCE = 5
const INACTIVE_DISTRICT_GAP = 14
const GRID_STEP = 2

/** Project-independent curated discovery sites; property and road solvers reserve their clearings. */
export const HISTORICAL_DISCOVERY_SITES: ReadonlyArray<{ id: string; x: number; z: number; radius: number; title: string; caption: string; source: string; href: string }> = [
  { id: 'rajaraja', x: 42, z: 24, radius: 3.6, title: 'Rajaraja Chola I', caption: 'A stone relief evokes the Chola court and Rajaraja Chola I. This is an interpretive reference, not a surviving village inscription.', source: 'Tamil Nadu Department of Archaeology · Rajarajan Site Museum', href: 'https://www.tnarch.gov.in/node/293' },
  { id: 'aryabhata', x: -38, z: 42, radius: 3.6, title: 'Aryabhata (476–550)', caption: 'A palm-leaf and sky-chart tableau commemorates Aryabhata, an earlier scholar who was not alive in 1000 CE.', source: 'University of St Andrews · MacTutor History of Mathematics', href: 'https://mathshistory.st-andrews.ac.uk/Biographies/Aryabhata_I/' },
  { id: 'brahmagupta', x: 18, z: -54, radius: 3.6, title: 'Brahmagupta (598–670)', caption: 'A counting-board tableau commemorates Brahmagupta, an earlier scholar who was not alive in 1000 CE.', source: 'University of St Andrews · MacTutor History of Mathematics', href: 'https://mathshistory.st-andrews.ac.uk/Biographies/Brahmagupta/' },
]

const bandByAge = (project: ActivityProject, active: boolean, pinned: boolean, now: number): TownPosition['band'] => {
  if (active) return 'active'
  if (pinned) return 'pinned'
  const committed = project.git.last_commit_at ? Date.parse(project.git.last_commit_at) : NaN
  if (!Number.isFinite(committed)) return 'unknown'
  const age = now - committed
  if (age <= 7 * 86_400_000) return 'recent'
  if (age <= 90 * 86_400_000) return 'established'
  return 'quiet'
}

function hash(value: string): number {
  let result = 2_166_136_261
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16_777_619)
  return result >>> 0
}

const ACTIVE_WALL_PALETTE = [0xc77952, 0xd8a65c, 0x9d5945, 0xb9653e, 0xe0bd7e, 0x98644e, 0xc58a61, 0x805842, 0xd68c5e, 0xa47d50, 0xc8735b, 0x936a50] as const
const ACTIVE_ROOF_PALETTE = [0x66483b, 0x824738, 0x635444, 0x514b43, 0x96543b, 0x695747, 0x774e42, 0x4f554b, 0x81553d, 0x63503c, 0x8c4b3e, 0x555047] as const

/** Stable identity-only appearance. Activity controls whether the scene applies it. */
export function projectBuildingAppearance(id: string): TownBuildingAppearance {
  const identity = hash(id)
  const wall = hash(`${id}:wall`), roof = hash(`${id}:roof`), height = hash(`${id}:height`)
  return {
    variant: identity % 6,
    wallColor: ACTIVE_WALL_PALETTE[wall % ACTIVE_WALL_PALETTE.length],
    roofColor: ACTIVE_ROOF_PALETTE[roof % ACTIVE_ROOF_PALETTE.length],
    heightScale: .9 + (height / 0xffff_ffff) * .45,
  }
}

function randomFor(seed: number): () => number {
  let state = seed || 0x9e3779b9
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function edgeGap(left: TownPosition, right: TownPosition): number {
  const dx = Math.max(0, Math.abs(left.x - right.x) - (left.lotWidth + right.lotWidth) / 2)
  const dz = Math.max(0, Math.abs(left.z - right.z) - (left.lotDepth + right.lotDepth) / 2)
  return Math.hypot(dx, dz)
}

function clearsTemple(item: TownPosition): boolean {
  const dx = Math.max(0, Math.abs(item.x) - item.lotWidth / 2 - TEMPLE_SITE.width / 2)
  const dz = Math.max(0, Math.abs(item.z) - item.lotDepth / 2 - TEMPLE_SITE.depth / 2)
  return Math.hypot(dx, dz) >= TEMPLE_SITE.clearance
}

function templeEdgeDistance(point: TownRoadPoint): number {
  const dx = Math.max(0, Math.abs(point.x) - TEMPLE_SITE.width / 2)
  const dz = Math.max(0, Math.abs(point.z) - TEMPLE_SITE.depth / 2)
  return Math.hypot(dx, dz)
}

function isTempleApproach(point: TownRoadPoint): boolean {
  // The only road allowed through the reserved clearance is the straight paved
  // approach extending outwards from the temple's +Z front entrance.
  return point.z >= TEMPLE_SITE.entrance.z && Math.abs(point.x - TEMPLE_SITE.entrance.x) <= 2
}

function clearsDiscoveries(item: TownPosition): boolean {
  return HISTORICAL_DISCOVERY_SITES.every(site => {
    const dx = Math.max(0, Math.abs(item.x - site.x) - item.lotWidth / 2)
    const dz = Math.max(0, Math.abs(item.z - site.z) - item.lotDepth / 2)
    return Math.hypot(dx, dz) >= site.radius + 2
  })
}

function roundGrid(value: number): number { return Math.round(value / GRID_STEP) * GRID_STEP || 0 }
function cellKey(point: TownRoadPoint): string { return `${point.x / GRID_STEP},${point.z / GRID_STEP}` }

function entranceFor(item: TownPosition): TownRoadPoint {
  const awayFromHallX = item.x >= 0 ? 1 : -1
  const awayFromHallZ = item.z >= 0 ? 1 : -1
  const useX = Math.abs(item.x) >= Math.abs(item.z)
  if (useX) {
    const boundary = item.x + awayFromHallX * (item.lotWidth / 2 + 2)
    const x = (awayFromHallX < 0 ? Math.floor(boundary / GRID_STEP) * GRID_STEP : Math.ceil(boundary / GRID_STEP) * GRID_STEP) || 0
    return { x, z: roundGrid(item.z) }
  }
  const boundary = item.z + awayFromHallZ * (item.lotDepth / 2 + 2)
  const z = (awayFromHallZ < 0 ? Math.floor(boundary / GRID_STEP) * GRID_STEP : Math.ceil(boundary / GRID_STEP) * GRID_STEP) || 0
  return { x: roundGrid(item.x), z }
}

function circleDistance(point: TownRoadPoint, circle: { x: number; z: number; radius: number }): number {
  return Math.hypot(point.x - circle.x, point.z - circle.z)
}

function blockedRoadPoint(point: TownRoadPoint, placements: TownPosition[], trees: TownRoadPoint[]): boolean {
  for (const item of placements) {
    if (Math.abs(point.x - item.x) < item.lotWidth / 2 + 1 && Math.abs(point.z - item.z) < item.lotDepth / 2 + 1) return true
  }
  if (templeEdgeDistance(point) < TEMPLE_SITE.clearance && !isTempleApproach(point)) return true
  if (trees.some(tree => Math.hypot(point.x - tree.x, point.z - tree.z) < 8)) return true
  if (HISTORICAL_DISCOVERY_SITES.some(site => circleDistance(point, site) < site.radius + 4)) return true
  return false
}

function connectToRoadNetwork(
  start: TownRoadPoint,
  network: Set<string>,
  placements: TownPosition[],
  trees: TownRoadPoint[],
  gridLimit = 800,
): TownRoadPoint[] {
  const startKey = cellKey(start)
  if (network.has(startKey)) return [start]
  const queue: TownRoadPoint[] = [start]
  const previous = new Map<string, string | null>([[startKey, null]])
  let foundKey: string | undefined
  for (let cursor = 0; cursor < queue.length && !foundKey; cursor++) {
    const current = queue[cursor]
    const currentKey = cellKey(current)
    if (network.has(currentKey)) { foundKey = currentKey; break }
    const neighbors = [
      { x: current.x + GRID_STEP, z: current.z },
      { x: current.x, z: current.z + GRID_STEP },
      { x: current.x - GRID_STEP, z: current.z },
      { x: current.x, z: current.z - GRID_STEP },
    ]
    for (const next of neighbors) {
      if (Math.abs(next.x) > gridLimit || Math.abs(next.z) > gridLimit) continue
      const key = cellKey(next)
      if (previous.has(key) || blockedRoadPoint(next, placements, trees)) continue
      previous.set(key, currentKey)
      queue.push(next)
    }
  }
  if (!foundKey) return [start]
  const path: TownRoadPoint[] = []
  for (let key: string | null | undefined = foundKey; key; key = previous.get(key)) {
    const [x, z] = key.split(',').map(Number)
    path.push({ x: x * GRID_STEP, z: z * GRID_STEP })
  }
  return path
}

function addGridLine(network: Set<string>, from: TownRoadPoint, to: TownRoadPoint): TownRoadPoint[] {
  const dx = Math.sign(to.x - from.x) * GRID_STEP
  const dz = Math.sign(to.z - from.z) * GRID_STEP
  let current = { ...from }
  const line = [{ ...current }]
  network.add(cellKey(current))
  while (current.x !== to.x || current.z !== to.z) {
    if (current.x !== to.x) current.x += dx
    else current.z += dz
    network.add(cellKey(current))
    line.push({ ...current })
  }
  return line
}

function environmentTrees(placements: TownPosition[]): TownRoadPoint[] {
  const trees: TownRoadPoint[] = []
  const maxRadius = Math.max(40, ...placements.map(item => item.radius + Math.hypot(item.lotWidth, item.lotDepth) / 2))
  // Scatter a bounded grove through open farm and village clearings, rather than
  // making one evenly spaced ring at the map edge.
  for (let index = 0; index < 4_000 && trees.length < 44; index++) {
    const random = randomFor(hash(`kaveri-tree-${index}`))
    const angle = random() * Math.PI * 2
    const radius = 19 + Math.sqrt(random()) * (maxRadius + 30)
    const point = {
      x: roundGrid(Math.cos(angle) * radius + (random() - .5) * 5),
      z: roundGrid(Math.sin(angle) * radius + (random() - .5) * 5),
    }
    if (templeEdgeDistance(point) < TEMPLE_SITE.clearance + 4) continue
    if (placements.some(item => Math.abs(point.x - item.x) < item.lotWidth / 2 + 12 && Math.abs(point.z - item.z) < item.lotDepth / 2 + 12)) continue
    if (trees.some(tree => Math.hypot(point.x - tree.x, point.z - tree.z) < 14)) continue
    if (HISTORICAL_DISCOVERY_SITES.some(site => circleDistance(point, site) < site.radius + 8)) continue
    trees.push(point)
  }
  return trees
}

function routeLots(placements: TownPosition[]): { roads: TownRoadPoint[][]; trees: TownRoadPoint[]; terrainRadius: number } {
  const trees = environmentTrees(placements)
  const sceneExtent = Math.max(
    18,
    ...placements.map(item => item.radius + Math.hypot(item.lotWidth, item.lotDepth) / 2),
    ...trees.map(tree => Math.hypot(tree.x, tree.z)),
  )
  const outer = Math.ceil((sceneExtent + 16) / GRID_STEP) * GRID_STEP
  const network = new Set<string>()
  const roads = [
    addGridLine(network, { x: -outer, z: -outer }, { x: outer, z: -outer }),
    addGridLine(network, { x: outer, z: -outer }, { x: outer, z: outer }),
    addGridLine(network, { x: outer, z: outer }, { x: -outer, z: outer }),
    addGridLine(network, { x: -outer, z: outer }, { x: -outer, z: -outer }),
  ]
  const gridLimit = outer + 160
  const centralRoute = connectToRoadNetwork(TEMPLE_SITE.entrance, network, placements, trees, gridLimit)
  for (const point of centralRoute) network.add(cellKey(point))
  roads.push(centralRoute)
  for (const item of placements) {
    const entrance = entranceFor(item)
    item.entrance = entrance
    item.road = connectToRoadNetwork(entrance, network, placements, trees, gridLimit)
    for (const point of item.road) network.add(cellKey(point))
    roads.push(item.road)
  }
  return { roads, trees, terrainRadius: outer + 120 }
}

/**
 * Deterministic size-aware lots. Called only at the initial snapshot, successful
 * Survey or successful pin change; ordinary task/snapshot updates keep this map.
 */
export function layoutProjects(projects: LayoutProject[], activeIds: ReadonlySet<string>, pinnedIds: ReadonlySet<string>, now = Date.now()): TownLayout {
  const buckets: Record<TownPosition['band'], LayoutProject[]> = { active: [], pinned: [], recent: [], established: [], quiet: [], unknown: [] }
  for (const project of projects) buckets[bandByAge(project, activeIds.has(project.id), pinnedIds.has(project.id), now)].push(project)
  const placed: TownPosition[] = []
  for (const band of BAND_ORDER) {
    const pending = buckets[band].sort((a, b) => a.id.localeCompare(b.id))
    // Each inactive band begins beyond the whole property envelope of the
    // previous districts, so a dense active ring cannot swallow quiet repos.
    const previousDistrictEnvelope = INNER_DISTRICT_BANDS.has(band) ? 0
      : Math.max(0, ...placed.map(item => item.radius + Math.hypot(item.lotWidth, item.lotDepth) / 2))
    for (const project of pending) {
      const form = buildingForm(project.size)
      const spec = buildingSpec(form)
      const item: TownPosition = {
        id: project.id, x: 0, z: 0, radius: 0, angle: 0, band, form,
        footprintWidth: spec.width, footprintDepth: spec.depth,
        lotWidth: spec.lotWidth, lotDepth: spec.lotDepth, entrance: { x: 0, z: 0 }, road: [],
      }
      const pitch = Math.max(item.lotWidth, item.lotDepth) + PROPERTY_CLEARANCE
      const radialJitter = Math.max(4, pitch * .72)
      const lotRadius = Math.hypot(item.lotWidth, item.lotDepth) / 2
      const minimumRadius = INNER_DISTRICT_BANDS.has(band)
        ? NOMINAL_RADIUS[band]
        : Math.max(NOMINAL_RADIUS[band], previousDistrictEnvelope + INACTIVE_DISTRICT_GAP + lotRadius)
      let found = false
      for (let ring = 0; ring < 20_000 && !found; ring++) {
        const random = randomFor(hash(`${project.id}:ring:${ring}`))
        const radius = minimumRadius + random() * radialJitter + ring * Math.max(8, pitch * .72)
        const capacity = Math.max(16, Math.ceil((2 * Math.PI * Math.max(radius, pitch)) / pitch))
        const phase = random() * Math.PI * 2 + ring * 2.399963229728653
        for (let step = 0; step < capacity; step++) {
          const variedRadius = radius + (random() - .5) * Math.min(5, pitch * .24)
          const candidateRadius = INNER_DISTRICT_BANDS.has(band) ? variedRadius : Math.max(minimumRadius, variedRadius)
          const angle = phase + (step / capacity) * Math.PI * 2 + (random() - .5) * (Math.PI * 2 / capacity) * .52
          item.x = Math.cos(angle) * candidateRadius
          item.z = Math.sin(angle) * candidateRadius
          item.radius = candidateRadius
          item.angle = angle
          if (!clearsTemple(item) || !clearsDiscoveries(item)) continue
          if (placed.some(other => edgeGap(item, other) < PROPERTY_CLEARANCE - 1e-7)) continue
          found = true
          break
        }
      }
      if (!found) throw new Error(`could not place Town project ${project.id}`)
      placed.push(item)
    }
  }
  const layout = new Map(placed.map(item => [item.id, item])) as TownLayout
  const environment = routeLots(placed)
  layout.roads = environment.roads
  layout.trees = environment.trees
  layout.terrainRadius = environment.terrainRadius
  return layout
}

/** Bounds the default town view to active, pinned and recent districts only. */
export function townCentralDistrictRadius(positions: Iterable<TownPosition>): number {
  return Math.max(50, ...[...positions]
    .filter(item => INNER_DISTRICT_BANDS.has(item.band))
    .map(item => item.radius + Math.hypot(item.lotWidth, item.lotDepth) / 2))
}

/** Distance that fits the complete Town bounds in both dimensions and viewports. */
export function townOverviewDistance(maxRadius: number, width: number, height: number, verticalFovDegrees = 44): number {
  const aspect = Math.max(1, width) / Math.max(1, height)
  const verticalFov = verticalFovDegrees * Math.PI / 180
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
  const halfFov = Math.min(verticalFov, horizontalFov) / 2
  const boundsRadius = Math.hypot(maxRadius, 18)
  return boundsRadius / Math.sin(halfFov) * 1.08
}

export function projectRadius(project: ActivityProject, active: boolean, pinned: boolean, now = Date.now()): number {
  if (active) return NOMINAL_RADIUS.active
  if (pinned) return NOMINAL_RADIUS.pinned
  const committed = project.git.last_commit_at ? Date.parse(project.git.last_commit_at) : NaN
  if (!Number.isFinite(committed)) return NOMINAL_RADIUS.unknown
  const age = Math.max(0, now - committed)
  if (age <= 7 * 24 * 60 * 60 * 1000) return NOMINAL_RADIUS.recent
  if (age <= 90 * 24 * 60 * 60 * 1000) return NOMINAL_RADIUS.established
  return NOMINAL_RADIUS.quiet
}

export function townLoadState(snapshot: unknown, error: string): 'loading' | 'unavailable' | 'ready' {
  if (snapshot) return 'ready'
  return error ? 'unavailable' : 'loading'
}

export function capacityHelp(status: string, provider: string, profile: string): string | undefined {
  if (status !== 'unsupported') return undefined
  return `No authoritative quota reader is available for ${profile || 'the selected profile'} (${provider}). Use the existing profile setup and selection flow to configure or choose a provider with a supported capacity source. Automatic dispatch stays queued until live capacity is verified.`
}
