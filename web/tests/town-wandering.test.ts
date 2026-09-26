import { describe, expect, it } from 'vitest'
import { createTownWanderNetwork, planTownWanderRoute } from '../app/town/town-wandering'
import { layoutProjects } from '../app/town/town-model'

const now = Date.parse('2026-09-26T00:00:00.000Z')
const project = (id: string) => ({ id, path: `/workspace/${id}`, git: { status: 'unknown' } })
const projects = ['chatur', 'base-harness', 'smart-home', 'ontology-graph', 'dev-agent', 'doc-agent', 'creative-studio', 'mobileapps', 'finance-tools', 'infra-server', 'security-tools', 'openator']

describe('town resident wandering', () => {
  it('plans connected road routes to a different populated island', () => {
    const layout = layoutProjects(projects.map(project), new Set(), new Set(), now)
    const network = createTownWanderNetwork(layout)
    const start = network.stops.find(stop => stop.island !== undefined)!
    const plan = planTownWanderRoute(network, start, 'resident-1', 0.41)
    expect(plan).toBeDefined()
    expect(plan!.destination.island).not.toBe(start.island)
    expect(plan!.route.length).toBeGreaterThan(2)
    expect(plan!.route[0]).toMatchObject({ x: start.x, z: start.z })
    expect(plan!.route.at(-1)).toMatchObject({ x: plan!.destination.x, z: plan!.destination.z })
    for (let index = 1; index < plan!.route.length - 1; index++) {
      const point = plan!.route[index]!
      expect(layout.roads.some(road => road.some(node => Math.hypot(node.x - point.x, node.z - point.z) < .01))).toBe(true)
    }
  })

  it('varies destinations deterministically and exposes different walk speeds and dwell times', () => {
    const layout = layoutProjects(projects.map(project), new Set(), new Set(), now)
    const network = createTownWanderNetwork(layout)
    const start = network.stops.find(stop => stop.island !== undefined)!
    const first = planTownWanderRoute(network, start, 'resident-1', .1)!
    const repeat = planTownWanderRoute(network, start, 'resident-1', .1)!
    const second = planTownWanderRoute(network, start, 'resident-1', .9)!
    expect(first).toEqual(repeat)
    expect(first.destination).not.toEqual(second.destination)
    expect(first.speed).toBeGreaterThanOrEqual(2.2)
    expect(first.speed).toBeLessThanOrEqual(3.8)
    expect(first.dwellSeconds).toBeGreaterThanOrEqual(2)
    expect(first.dwellSeconds).toBeLessThanOrEqual(8)
  })
})
