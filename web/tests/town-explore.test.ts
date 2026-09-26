import { describe, expect, it } from 'vitest'
import { createExploreColliderGrid, createExploreSolidGrid, emptyExploreKeys, exploreBlocked, exploreGroundAt, exploreCameraClearance, exploreSolidFromBox, exploreColliderFromBox, exploreMoveDirection, exploreSeekDirection, exploreSpawnPoint, exploreTargetVerb, nearestExploreTarget, resolveExploreMove, type ExploreCollider } from '../app/town/town-explore'

const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => ({ min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } })

describe('explore colliders', () => {
  it('keeps walls at body height and drops floors, roofs, planes and huge slabs', () => {
    expect(exploreColliderFromBox(box(0, 0, 0, 10, 4.4, 1.4))).toEqual({ minX: 0, maxX: 10, minZ: 0, maxZ: 1.4, bottom: 0, top: 4.4 })
    expect(exploreColliderFromBox(box(0, 0, 0, 10, .12, 10))).toBeUndefined() // flagstone floor
    expect(exploreColliderFromBox(box(0, 6.2, 0, 10, 9, 10))).toBeUndefined() // gopuram tier over a passage
    expect(exploreColliderFromBox(box(0, 0, 0, 7.5, 7, 0))).toBeUndefined() // portal glow plane
    expect(exploreColliderFromBox(box(-50, 0, -50, 50, 1, 50))).toBeUndefined()
    expect(exploreColliderFromBox(box(0, 0, 0, NaN, 1, 1))).toBeUndefined()
  })

  it('buckets colliders so lookups near a point find only local boxes', () => {
    const colliders: ExploreCollider[] = [{ minX: 0, maxX: 2, minZ: 0, maxZ: 2, bottom: 0, top: 4 }, { minX: 100, maxX: 102, minZ: 100, maxZ: 102, bottom: 0, top: 4 }]
    const grid = createExploreColliderGrid(colliders)
    expect(grid.size).toBe(2)
    expect(grid.near(1, 1, 1)).toEqual([colliders[0]])
    expect(exploreBlocked({ x: 2.3, z: 1 }, .42, grid)).toBe(true)
    expect(exploreBlocked({ x: 2.5, z: 1 }, .42, grid)).toBe(false)
  })
})

describe('explore movement', () => {
  const wall = createExploreColliderGrid([{ minX: -10, maxX: 10, minZ: -.7, maxZ: .7, bottom: 0, top: 4 }])

  it('walks freely in open ground and clamps to the world bound', () => {
    expect(resolveExploreMove({ x: 0, z: 5 }, { x: 1, z: 0 }, wall, 100)).toEqual({ x: 1, z: 5, ground: 0 })
    expect(resolveExploreMove({ x: 99.5, z: 5 }, { x: 2, z: 0 }, wall, 100)).toEqual({ x: 100, z: 5, ground: 0 })
  })

  it('slides along a wall instead of stopping dead or passing through', () => {
    const next = resolveExploreMove({ x: 0, z: 1.5 }, { x: 1, z: -1 }, wall, 100)
    expect(next.x).toBeCloseTo(1)
    expect(next.z).toBeGreaterThanOrEqual(.7 + .42 - 1e-9)
    expect(exploreBlocked(next, .42, wall)).toBe(false)
  })

  it('never tunnels through a thin wall on a long frame', () => {
    const next = resolveExploreMove({ x: 0, z: 3 }, { x: 0, z: -6 }, wall, 100)
    expect(next.z).toBeGreaterThan(.7)
  })

  it('skirts a post standing straight ahead instead of sticking to it', () => {
    const post = createExploreColliderGrid([{ minX: -.15, maxX: .15, minZ: -.15, maxZ: .15, bottom: 0, top: 4 }])
    let at = { x: 0, z: 3 }
    for (let frame = 0; frame < 60; frame++) at = resolveExploreMove(at, { x: 0, z: -.1 }, post, 100)
    expect(at.z).toBeLessThan(-.5)
    expect(exploreBlocked(at, .42, post)).toBe(false)
  })

  it('still stops flat against a long wall hit square-on', () => {
    let next = { x: 0, z: 1.2 }
    for (let frame = 0; frame < 30; frame++) next = resolveExploreMove(next, { x: 0, z: -.5 }, wall, 100)
    expect(next.z).toBeGreaterThanOrEqual(1.12 - 1e-9)
    expect(Math.abs(next.x)).toBeLessThan(.2)
  })

  it('climbs a low plinth, stands on it, and still bumps the wall above it', () => {
    const plinth = { minX: -5, maxX: 5, minZ: -5, maxZ: 5, bottom: 0, top: .45 }
    const hall = createExploreColliderGrid([plinth, { minX: -5, maxX: 5, minZ: -5, maxZ: -4, bottom: .45, top: 4 }])
    let at = { x: 0, z: 8, ground: 0 }
    for (let frame = 0; frame < 60; frame++) at = resolveExploreMove(at, { x: 0, z: -.2 }, hall, 100, .42, at.ground)
    expect(at.ground).toBeCloseTo(.45)
    expect(at.z).toBeGreaterThan(-4)
    expect(at.z).toBeLessThan(0)
    // Walking back off the edge drops to the ground.
    for (let frame = 0; frame < 60; frame++) at = resolveExploreMove(at, { x: 0, z: .2 }, hall, 100, .42, at.ground)
    expect(at.ground).toBe(0)
  })

  it('refuses a ledge taller than a step and passes under a high beam', () => {
    const ledge = createExploreColliderGrid([{ minX: -5, maxX: 5, minZ: -5, maxZ: 5, bottom: 0, top: .9 }])
    expect(exploreBlocked({ x: 0, z: 5.2 }, .42, ledge)).toBe(true)
    const beam = createExploreColliderGrid([{ minX: -5, maxX: 5, minZ: -1, maxZ: 1, bottom: 2.1, top: 2.5 }])
    expect(exploreBlocked({ x: 0, z: 0 }, .42, beam)).toBe(false)
    expect(exploreGroundAt({ x: 0, z: 0 }, beam)).toBe(0)
  })

  it('lets a walker spawned inside geometry step out', () => {
    expect(resolveExploreMove({ x: 0, z: 0 }, { x: 0, z: 2 }, wall, 100).z).toBeCloseTo(2)
  })

  it('moves relative to the camera view', () => {
    const keys = { ...emptyExploreKeys(), forward: true }
    expect(exploreMoveDirection(keys, { x: 0, z: -3 })).toEqual({ x: 0, z: -1 })
    const right = exploreMoveDirection({ ...emptyExploreKeys(), right: true }, { x: 0, z: -1 })
    expect(right.x).toBeCloseTo(1); expect(right.z).toBeCloseTo(0)
    const diagonal = exploreMoveDirection({ ...keys, left: true }, { x: 0, z: -1 })
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1)
    expect(exploreMoveDirection({ ...keys, back: true }, { x: 0, z: -1 })).toEqual({ x: 0, z: 0 })
  })

  it('seeks a clicked destination and stops on arrival', () => {
    expect(exploreSeekDirection({ x: 0, z: 0 }, { x: 3, z: 4 })).toEqual({ x: .6, z: .8 })
    expect(exploreSeekDirection({ x: 0, z: 0 }, { x: .2, z: .2 })).toBeUndefined()
  })

  it('spawns on the nearest free ground', () => {
    const point = exploreSpawnPoint({ x: 0, z: 0 }, wall)
    expect(exploreBlocked(point, .42, wall)).toBe(false)
    expect(exploreSpawnPoint({ x: 0, z: 5 }, wall)).toEqual({ x: 0, z: 5 })
  })
})

describe('explore interaction', () => {
  const targets = [
    { id: 'p1', kind: 'project' as const, label: 'Base', x: 0, z: 0, reach: 6 },
    { id: 'a1', kind: 'artisan' as const, label: 'Panini', x: 3, z: 0, reach: 3 },
    { id: 'portal', kind: 'portal' as const, label: 'Observatory', x: 40, z: 0, reach: 6 },
  ]

  it('picks the target the walker stands deepest inside', () => {
    expect(nearestExploreTarget({ x: 3, z: 0 }, targets)?.id).toBe('a1')
    expect(nearestExploreTarget({ x: 0, z: 1 }, targets)?.id).toBe('p1')
    expect(nearestExploreTarget({ x: 20, z: 0 }, targets)).toBeUndefined()
  })

  it('names the action plainly', () => {
    expect(exploreTargetVerb(targets[0]!)).toBe('Open Base office')
    expect(exploreTargetVerb(targets[1]!)).toBe('Talk to Panini')
    expect(exploreTargetVerb(targets[2]!)).toBe('Step into the Cosmic Observatory')
  })
})

describe('explore follow camera', () => {
  const head = { x: 0, y: 1.6, z: 0 }
  const gate = { minX: -5, minY: 0, minZ: 4, maxX: 5, maxY: 20, maxZ: 6 }
  const grid = createExploreSolidGrid([gate])

  it('keeps small dressing out of camera occlusion', () => {
    expect(exploreSolidFromBox(box(0, 0, 0, .3, .3, .3))).toBeUndefined()
    expect(exploreSolidFromBox(box(-5, 0, 4, 5, 20, 6))).toEqual(gate)
  })

  it('pulls the camera in front of a wall between it and the traveller', () => {
    expect(exploreCameraClearance(head, { x: 0, y: 6, z: 12 }, grid, 0)).toBeCloseTo(4 / 12)
    expect(exploreCameraClearance(head, { x: 0, y: 6, z: 12 }, grid)).toBeCloseTo(3.6 / 12)
  })

  it('leaves an unobstructed view alone and ignores geometry around the head', () => {
    expect(exploreCameraClearance(head, { x: 0, y: 6, z: -12 }, grid)).toBe(1)
    // A camera parked a hand's width from a face is pulled in so the near plane cannot clip it.
    expect(exploreCameraClearance(head, { x: 0, y: 1.6, z: 3.9 }, grid)).toBeLessThan(1)
    const roof = createExploreSolidGrid([{ minX: -3, minY: 0, minZ: -3, maxX: 3, maxY: 4, maxZ: 3 }])
    expect(exploreCameraClearance(head, { x: 0, y: 6, z: 12 }, roof)).toBe(1)
  })
})
