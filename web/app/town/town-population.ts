import { GUILD_HALL_SITE, HISTORICAL_DISCOVERY_SITES, STAGING_SITE, TEMPLE_CAMPUS, type TownLayout } from './town-model'

export interface TownSceneryPerson {
  /** Stable seed for the person's procedural appearance. */
  seed: string
  x: number
  z: number
  facing: number
  pose: 'idle' | 'greet'
  wander: boolean
}

const SIDE_OFFSET = 2.8
const CLUSTER_RADIUS = 8
const CLUSTER_SEPARATION = 30
const PERSON_SPACING = 1.5
const CAMPUS_CLEARANCE = TEMPLE_CAMPUS.clearance + 4
const APPROACH_CENTER = { x: 0, z: 85 }

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
  return hash >>> 0
}

function outsideRectangle(x: number, z: number, cx: number, cz: number, width: number, depth: number, margin: number): boolean {
  const dx = Math.max(0, Math.abs(x - cx) - width / 2)
  const dz = Math.max(0, Math.abs(z - cz) - depth / 2)
  return Math.hypot(dx, dz) > margin
}

function safeForScenery(layout: TownLayout, x: number, z: number): boolean {
  if (!outsideRectangle(x, z, 0, 0, TEMPLE_CAMPUS.width, TEMPLE_CAMPUS.depth, CAMPUS_CLEARANCE)) return false
  if (!outsideRectangle(x, z, GUILD_HALL_SITE.x, GUILD_HALL_SITE.z, GUILD_HALL_SITE.width, GUILD_HALL_SITE.depth, 3)) return false
  if (!outsideRectangle(x, z, STAGING_SITE.x, STAGING_SITE.z, STAGING_SITE.width, STAGING_SITE.depth, 3)) return false
  for (const building of layout.values()) {
    if (!outsideRectangle(x, z, building.x, building.z, building.footprintWidth, building.footprintDepth, 4)) return false
  }
  return HISTORICAL_DISCOVERY_SITES.every(site => Math.hypot(x - site.x, z - site.z) >= site.radius + 3)
}

/**
 * Pick a deterministic, bounded set of residents beside existing road segments.
 * They stay out of building footprints, the temple campus, civic buildings and
 * discovery tableaux, and are scenery only (never agent or interaction data).
 */
export function createTownPopulation(layout: TownLayout, requested = 48): TownSceneryPerson[] {
  const count = Math.max(12, Math.min(64, Math.floor(requested)))
  const candidates = new Map<string, TownSceneryPerson>()
  for (const road of layout.roads) {
    for (let index = 1; index < road.length; index++) {
      const a = road[index - 1]!, b = road[index]!
      const dx = b.x - a.x, dz = b.z - a.z
      const length = Math.hypot(dx, dz)
      if (length < 1) continue
      const nx = -dz / length, nz = dx / length
      for (const fraction of [.125, .25, .375, .5, .625, .75, .875]) for (const side of [-1, 1]) {
        const x = a.x + dx * fraction + nx * SIDE_OFFSET * side
        const z = a.z + dz * fraction + nz * SIDE_OFFSET * side
        if (!safeForScenery(layout, x, z)) continue
        const key = `${x.toFixed(2)},${z.toFixed(2)}`
        const seed = `town-resident:${key}`
        candidates.set(key, { seed, x, z, facing: Math.atan2(dx, dz), pose: stableHash(seed) % 4 === 0 ? 'greet' : 'idle', wander: stableHash(`${seed}:wander`) % 3 === 0 })
      }
    }
  }

  const bySeed = (a: TownSceneryPerson, b: TownSceneryPerson) => stableHash(a.seed) - stableHash(b.seed) || a.seed.localeCompare(b.seed)
  const ordered = [...candidates.values()].sort(bySeed)
  const buildings = [...layout.values()]
  const buildingDistance = (person: TownSceneryPerson) => buildings.length
    ? Math.min(...buildings.map(building => Math.hypot(person.x - building.x, person.z - building.z)))
    : 0
  // Prefer actual roads around populated project islands. A no-project snapshot
  // falls back to the existing civic/temple road network, never invented points.
  const nearProjects = buildings.length ? ordered.filter(person => buildingDistance(person) <= 88) : ordered
  const poolSource = nearProjects.length >= Math.min(count, 16) ? nearProjects : ordered
  const pool = poolSource.length <= 256 ? poolSource : Array.from({ length: 256 }, (_, index) => poolSource[Math.floor(index * poolSource.length / 256)]!)
  const groups: TownSceneryPerson[][] = []
  const unused = new Set(pool)
  const groupSize = Math.min(4, Math.max(2, Math.ceil(count / 4)))

  const selectedCount = () => groups.reduce((sum, group) => sum + group.length, 0)
  while (selectedCount() + 1 < count && unused.size) {
    const anchors = [...unused].filter(candidate => groups.every(group =>
      Math.hypot(candidate.x - group[0]!.x, candidate.z - group[0]!.z) >= CLUSTER_SEPARATION)
      && [...unused].some(other => other !== candidate
        && Math.hypot(candidate.x - other.x, candidate.z - other.z) <= CLUSTER_RADIUS
        && Math.hypot(candidate.x - other.x, candidate.z - other.z) >= PERSON_SPACING))
    if (!anchors.length) break
    // Farthest-point sampling spreads groups across project-road neighbourhoods;
    // the first group is biased toward the visible civic approach.
    const anchor = groups.length === 0
      ? anchors.sort((a, b) => Math.hypot(a.x - APPROACH_CENTER.x, a.z - APPROACH_CENTER.z) - Math.hypot(b.x - APPROACH_CENTER.x, b.z - APPROACH_CENTER.z) || bySeed(a, b))[0]!
      : anchors.sort((a, b) => {
        const spread = (person: TownSceneryPerson) => Math.min(...groups.map(group => Math.hypot(person.x - group[0]!.x, person.z - group[0]!.z)))
        return spread(b) - spread(a) || buildingDistance(a) - buildingDistance(b) || bySeed(a, b)
      })[0]!
    const cluster = [...unused]
      .filter(person => Math.hypot(person.x - anchor.x, person.z - anchor.z) <= CLUSTER_RADIUS)
      .filter(person => groups.flat().every(other => Math.hypot(person.x - other.x, person.z - other.z) >= PERSON_SPACING))
      .sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z) || bySeed(a, b))
      .filter((person, index, options) => options.slice(0, index).every(other => Math.hypot(person.x - other.x, person.z - other.z) >= PERSON_SPACING))
      .slice(0, Math.min(groupSize, count - groups.reduce((sum, group) => sum + group.length, 0)))
    if (cluster.length < 2) { unused.delete(anchor); continue }
    for (const person of cluster) unused.delete(person)
    groups.push(cluster)
  }

  return groups.flatMap(group => group.map(person => {
    const others = group.filter(other => other !== person)
    const centerX = others.reduce((sum, other) => sum + other.x, 0) / Math.max(1, others.length)
    const centerZ = others.reduce((sum, other) => sum + other.z, 0) / Math.max(1, others.length)
    return { ...person, facing: Math.atan2(centerX - person.x, centerZ - person.z) }
  })).slice(0, count)
}
