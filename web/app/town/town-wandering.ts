import { townRoadGraph, townWalkRoute } from './town-artisans'
import { GUILD_HALL_SITE, HISTORICAL_DISCOVERY_SITES, STAGING_SITE, TEMPLE_CAMPUS, type TownLayout, type TownPosition, type TownRoadPoint } from './town-model'

export interface TownWanderStop extends TownRoadPoint { island?: string }
export interface TownWanderNetwork { graph: ReturnType<typeof townRoadGraph>; stops: TownWanderStop[] }
export interface TownWanderPlan { route: TownRoadPoint[]; destination: TownWanderStop; speed: number; dwellSeconds: number }

const SIDE_OFFSET = 2.8
const CAMPUS_CLEARANCE = TEMPLE_CAMPUS.clearance + 4

function outsideRectangle(x: number, z: number, cx: number, cz: number, width: number, depth: number, margin: number): boolean {
  const dx = Math.max(0, Math.abs(x - cx) - width / 2)
  const dz = Math.max(0, Math.abs(z - cz) - depth / 2)
  return Math.hypot(dx, dz) > margin
}

function safeForStop(layout: TownLayout, x: number, z: number): boolean {
  if (!outsideRectangle(x, z, 0, 0, TEMPLE_CAMPUS.width, TEMPLE_CAMPUS.depth, CAMPUS_CLEARANCE)) return false
  if (!outsideRectangle(x, z, GUILD_HALL_SITE.x, GUILD_HALL_SITE.z, GUILD_HALL_SITE.width, GUILD_HALL_SITE.depth, 3)) return false
  if (!outsideRectangle(x, z, STAGING_SITE.x, STAGING_SITE.z, STAGING_SITE.width, STAGING_SITE.depth, 3)) return false
  for (const building of layout.values()) {
    if (!outsideRectangle(x, z, building.x, building.z, building.footprintWidth, building.footprintDepth, 4)) return false
  }
  return HISTORICAL_DISCOVERY_SITES.every(site => Math.hypot(x - site.x, z - site.z) >= site.radius + 3)
}

export function townIslandAt(layout: TownLayout, x: number, z: number): string | undefined {
  let nearestProject: TownPosition | undefined
  let projectDistance = Infinity
  for (const building of layout.values()) {
    const distance = Math.hypot(x - building.x, z - building.z)
    if (distance < projectDistance) { nearestProject = building; projectDistance = distance }
  }
  if (nearestProject && projectDistance <= 88) return nearestProject.cluster
  let closest: TownLayout['islands'][number] | undefined
  let distance = Infinity
  for (const island of layout.islands) {
    const next = Math.hypot(x - island.x, z - island.z)
    if (next < distance) { closest = island; distance = next }
  }
    return closest && distance <= closest.radius + 120 ? closest.cluster : undefined
}

/** Build safe meeting stops beside the actual rendered roads, once per scene. */
export function createTownWanderNetwork(layout: TownLayout): TownWanderNetwork {
  const stops = new Map<string, TownWanderStop>()
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
        if (!safeForStop(layout, x, z)) continue
        const island = townIslandAt(layout, x, z)
        if (layout.islands.length && !island) continue
        const key = `${x.toFixed(1)},${z.toFixed(1)}`
        stops.set(key, { x, z, island })
      }
    }
  }
  const ordered = [...stops.values()].sort((a, b) => (a.island ?? '').localeCompare(b.island ?? '') || a.x - b.x || a.z - b.z)
  const bounded = ordered.length <= 512 ? ordered : Array.from({ length: 512 }, (_, index) => ordered[Math.floor(index * ordered.length / 512)]!)
  return { graph: townRoadGraph(layout.roads), stops: bounded }
}

/** Pick a seeded-random stop on another island and route along the connected road graph. */
export function planTownWanderRoute(network: TownWanderNetwork, from: TownRoadPoint & { island?: string }, seed: string, random: number): TownWanderPlan | undefined {
  const islandStops = network.stops.some(stop => stop.island !== undefined)
  const available = network.stops.filter(stop => (islandStops ? stop.island !== from.island : true) && Math.hypot(stop.x - from.x, stop.z - from.z) >= 36)
  if (!available.length) return undefined
  // Give farther islands a fair chance while keeping a short same-neighbourhood stroll possible.
  const offset = Math.abs(random) % 1
  const destination = available[Math.floor(offset * available.length)]!
  const route = townWalkRoute({ roads: [] }, from, destination, network.graph)
  // townWalkRoute uses a direct fallback only for disconnected nodes; never use that for scenery.
  if (route.length <= 2 || route.length > 1024) return undefined
  const variation = Math.abs(Math.sin(seed.split('').reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7))) % 1
  return {
    route,
    destination,
    speed: 2.2 + variation * 1.6,
    dwellSeconds: 2 + offset * 6,
  }
}
