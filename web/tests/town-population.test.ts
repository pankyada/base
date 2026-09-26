import { describe, expect, it } from 'vitest'
import { createTownPopulation } from '../app/town/town-population'
import { layoutProjects, TEMPLE_CAMPUS, type TownPosition } from '../app/town/town-model'

const now = Date.parse('2026-09-26T00:00:00.000Z')
const project = (id: string) => ({ id, git: { status: 'unknown' } })
const projectIds = ['chatur', 'base-harness', 'smart-home', 'ontology-graph', 'dev-agent', 'doc-agent', 'creative-studio', 'mobileapps', 'finance-tools', 'infra-server', 'security-tools', 'openator']

function rectangleGap(x: number, z: number, item: { x: number; z: number; width: number; depth: number }): number {
  const dx = Math.max(0, Math.abs(x - item.x) - item.width / 2)
  const dz = Math.max(0, Math.abs(z - item.z) - item.depth / 2)
  return Math.hypot(dx, dz)
}

function segmentDistance(point: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x, dz = b.z - a.z
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz))
}

describe('town scenery population', () => {
  it('is deterministic and bounded even when the snapshot has no projects', () => {
    const emptyTown = layoutProjects([], new Set(), new Set(), now)
    const residents = createTownPopulation(emptyTown)
    expect(residents).toEqual(createTownPopulation(emptyTown))
    expect(residents).toHaveLength(48)
    expect(new Set(residents.map(person => person.seed)).size).toBe(residents.length)
    expect(residents.every(person => Number.isFinite(person.x) && Number.isFinite(person.z) && Number.isFinite(person.facing))).toBe(true)
    for (let index = 0; index < residents.length; index++) {
      for (let other = index + 1; other < residents.length; other++) {
        expect(Math.hypot(residents[index]!.x - residents[other]!.x, residents[index]!.z - residents[other]!.z)).toBeGreaterThanOrEqual(1.5)
      }
    }
    const nearSouthApproach = residents.filter(person => Math.hypot(person.x, person.z - 85) <= 30)
    expect(nearSouthApproach.length).toBeGreaterThanOrEqual(2)
    expect(nearSouthApproach.length).toBeLessThanOrEqual(8)
    expect(residents.filter(person => person.wander).length).toBeGreaterThanOrEqual(12)
    expect(residents.filter(person => person.wander).length).toBeLessThanOrEqual(24)
  })

  it('keeps residents beside roads and clear of buildings and the temple campus', () => {
    const layout = layoutProjects(projectIds.map(project), new Set(), new Set(), now)
    const residents = createTownPopulation(layout)
    expect(residents.length).toBeGreaterThanOrEqual(44)
    expect(residents.length).toBeLessThanOrEqual(48)
    const buildings = [...layout.values()]
    for (const person of residents) {
      expect(buildings.every((building: TownPosition) => rectangleGap(person.x, person.z, { x: building.x, z: building.z, width: building.footprintWidth, depth: building.footprintDepth }) > 4)).toBe(true)
      expect(rectangleGap(person.x, person.z, { x: 0, z: 0, width: TEMPLE_CAMPUS.width, depth: TEMPLE_CAMPUS.depth })).toBeGreaterThan(TEMPLE_CAMPUS.clearance + 4)
      expect(layout.roads.some(road => road.slice(1).some((next, index) => segmentDistance(person, road[index]!, next) < 3.5))).toBe(true)
    }
  })

  it('forms compact groups and spreads them beside several project neighbourhoods', () => {
    const layout = layoutProjects(projectIds.map(project), new Set(), new Set(), now)
    const residents = createTownPopulation(layout)
    const groups: typeof residents[] = []
    for (const person of residents) {
      const group = groups.find(items => Math.hypot(items[0]!.x - person.x, items[0]!.z - person.z) <= 10)
      if (group) group.push(person)
      else groups.push([person])
    }
    expect(groups.length).toBeGreaterThanOrEqual(4)
    expect(groups.every(group => group.length >= 2 && group.length <= 4)).toBe(true)
    expect(groups.some(a => groups.some(b => a !== b && Math.hypot(a[0]!.x - b[0]!.x, a[0]!.z - b[0]!.z) >= 36))).toBe(true)
    expect(residents.every(person => Math.min(...[...layout.values()].map(building => Math.hypot(person.x - building.x, person.z - building.z))) <= 88)).toBe(true)
  })
})
