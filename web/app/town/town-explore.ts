/**
 * Explore-on-foot: pure movement, collision and interaction math for the
 * traveller avatar. The scene feeds it world-space boxes taken from the real
 * meshes, so colliders always match what is drawn.
 */

export interface ExploreVec { x: number; z: number }
export interface ExploreBox { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
export interface ExploreCollider { minX: number; maxX: number; minZ: number; maxZ: number; bottom: number; top: number }
export interface ExploreKeys { forward: boolean; back: boolean; left: boolean; right: boolean; run: boolean }
export type ExploreTargetKind = 'project' | 'artisan' | 'temple' | 'portal' | 'discovery'
export interface ExploreTarget { id: string; kind: ExploreTargetKind; label: string; x: number; z: number; reach: number }

export const EXPLORE_RADIUS = .42
export const EXPLORE_WALK_SPEED = 6
export const EXPLORE_RUN_SPEED = 14
/** A walker climbs anything up to this far above its footing (plinths, steps) and passes under anything this far above it. */
export const EXPLORE_STEP_UP = .5
export const EXPLORE_HEADROOM = 1.9
/** Ground decals and floor slabs below this never matter; beams above this never reach a walker even on a plinth. */
const COLLIDER_BAND = Object.freeze({ low: .2, high: 2.6 })
/** Filled slabs this large at body height are terrain-like dressing, not walls. */
const MAX_SOLID_SPAN = 30
const GRID_CELL = 8

export const EXPLORE_KEY_MAP: Readonly<Record<string, keyof ExploreKeys>> = Object.freeze({
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
})

export function emptyExploreKeys(): ExploreKeys {
  return { forward: false, back: false, left: false, right: false, run: false }
}

/** A mesh's world box becomes a footprint collider if a walker could bump into it or stand on it. */
export function exploreColliderFromBox(box: ExploreBox): ExploreCollider | undefined {
  const values = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]
  if (!values.every(Number.isFinite)) return undefined
  if (box.max.y <= COLLIDER_BAND.low || box.min.y >= COLLIDER_BAND.high) return undefined
  const width = box.max.x - box.min.x, depth = box.max.z - box.min.z
  if (width < .02 || depth < .02) return undefined
  if (width > MAX_SOLID_SPAN && depth > MAX_SOLID_SPAN) return undefined
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, bottom: box.min.y, top: box.max.y }
}

/** Too tall to step onto from `footing`, and low enough to hit the body. */
function obstructs(collider: ExploreCollider, footing: number): boolean {
  return collider.top > footing + EXPLORE_STEP_UP && collider.bottom < footing + EXPLORE_HEADROOM
}

export interface ExploreColliderGrid {
  readonly size: number
  near(x: number, z: number, radius: number): ExploreCollider[]
}

export function createExploreColliderGrid(colliders: readonly ExploreCollider[], cell = GRID_CELL): ExploreColliderGrid {
  const buckets = new Map<string, ExploreCollider[]>()
  for (const collider of colliders) {
    for (let cx = Math.floor(collider.minX / cell); cx <= Math.floor(collider.maxX / cell); cx++) {
      for (let cz = Math.floor(collider.minZ / cell); cz <= Math.floor(collider.maxZ / cell); cz++) {
        const key = `${cx}:${cz}`
        const bucket = buckets.get(key)
        if (bucket) bucket.push(collider); else buckets.set(key, [collider])
      }
    }
  }
  return {
    size: colliders.length,
    near(x, z, radius) {
      const found = new Set<ExploreCollider>()
      for (let cx = Math.floor((x - radius) / cell); cx <= Math.floor((x + radius) / cell); cx++) {
        for (let cz = Math.floor((z - radius) / cell); cz <= Math.floor((z + radius) / cell); cz++) {
          for (const collider of buckets.get(`${cx}:${cz}`) ?? []) found.add(collider)
        }
      }
      return [...found]
    },
  }
}

export function exploreBlocked(point: ExploreVec, radius: number, grid: ExploreColliderGrid, footing = 0): boolean {
  for (const box of grid.near(point.x, point.z, radius)) {
    if (!obstructs(box, footing)) continue
    const nearestX = Math.max(box.minX, Math.min(point.x, box.maxX))
    const nearestZ = Math.max(box.minZ, Math.min(point.z, box.maxZ))
    if ((point.x - nearestX) ** 2 + (point.z - nearestZ) ** 2 < radius * radius) return true
  }
  return false
}

/** Height of the highest climbable surface under a walker's feet, never below `base`. */
export function exploreGroundAt(point: ExploreVec, grid: ExploreColliderGrid, footing = 0, base = 0, radius = EXPLORE_RADIUS * .5): number {
  let ground = base
  for (const box of grid.near(point.x, point.z, radius)) {
    if (box.top > footing + EXPLORE_STEP_UP || box.top <= ground) continue
    if (point.x + radius < box.minX || point.x - radius > box.maxX || point.z + radius < box.minZ || point.z - radius > box.maxZ) continue
    ground = box.top
  }
  return ground
}

/**
 * Move with wall sliding: full step, else the x or z component alone, else
 * veer up to a sidestep around a post or corner, else stay. Long steps are split so a fast frame never tunnels through a thin wall.
 * A walker already overlapping geometry (spawned inside) may move freely out.
 */
export interface ExploreStep extends ExploreVec { ground: number }

export function resolveExploreMove(from: ExploreVec, delta: ExploreVec, grid: ExploreColliderGrid, bound: number, radius = EXPLORE_RADIUS, footing = 0, base: (point: ExploreVec) => number = () => 0): ExploreStep {
  const length = Math.hypot(delta.x, delta.z)
  if (!(length > 0)) return { ...from, ground: footing }
  const steps = Math.max(1, Math.ceil(length / (radius * .5)))
  const clamp = (value: number) => Math.max(-bound, Math.min(bound, value))
  let current = { ...from }, ground = footing
  for (let index = 0; index < steps; index++) {
    const dx = delta.x / steps, dz = delta.z / steps
    const blocked = (point: ExploreVec) => exploreBlocked(point, radius, grid, ground)
    const full = { x: clamp(current.x + dx), z: clamp(current.z + dz) }
    let next: ExploreVec | undefined
    if (blocked(current) || !blocked(full)) next = full
    else {
      const alongX = { x: clamp(current.x + dx), z: current.z }
      const alongZ = { x: current.x, z: clamp(current.z + dz) }
      if (Math.abs(dx) > 1e-6 && !blocked(alongX)) next = alongX
      else if (Math.abs(dz) > 1e-6 && !blocked(alongZ)) next = alongZ
      // Head-on into a post or corner: veer progressively wider, keeping the forward share of the step.
      else next = veerAround(current, dx, dz, radius, grid, clamp, ground)
    }
    if (!next) break
    current = next
    ground = exploreGroundAt(current, grid, ground, base(current))
  }
  return { ...current, ground }
}

const VEER_ANGLES = [Math.PI / 6, Math.PI / 3, Math.PI / 2]

function veerAround(from: ExploreVec, dx: number, dz: number, radius: number, grid: ExploreColliderGrid, clamp: (value: number) => number, footing: number): ExploreVec | undefined {
  // Veer away from the nearest blocking box so a walker slips past a post on its shorter side.
  const ahead = { x: from.x + dx, z: from.z + dz }
  let obstacle: ExploreVec | undefined, span = 0, closest = Infinity
  for (const box of grid.near(ahead.x, ahead.z, radius)) {
    if (!obstructs(box, footing)) continue
    const centre = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 }
    const distance = Math.hypot(centre.x - ahead.x, centre.z - ahead.z)
    if (distance < closest) { closest = distance; obstacle = centre; span = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) }
  }
  const length = Math.hypot(dx, dz)
  for (const angle of VEER_ANGLES) {
    // Sidestepping is for posts and trunks; pressing square into a wall should not drift along it.
    if (angle >= Math.PI / 2 && span > 3) break
    // Keep the forward share of the step; a full sidestep still moves half a step.
    const scale = Math.max(Math.cos(angle), .5)
    let best: ExploreVec | undefined, bestClearance = -Infinity
    for (const sign of [1, -1]) {
      const cos = Math.cos(angle * sign), sin = Math.sin(angle * sign)
      const point = { x: clamp(from.x + (dx * cos - dz * sin) * scale), z: clamp(from.z + (dx * sin + dz * cos) * scale) }
      if (exploreBlocked(point, radius, grid, footing)) continue
      const clearance = obstacle ? Math.hypot(point.x - obstacle.x, point.z - obstacle.z) : length
      if (clearance > bestClearance) { best = point; bestClearance = clearance }
    }
    if (best) return best
  }
  return undefined
}

/** Unit ground direction for held keys, relative to where the camera looks. */
export function exploreMoveDirection(keys: ExploreKeys, cameraForward: ExploreVec): ExploreVec {
  const forwardLength = Math.hypot(cameraForward.x, cameraForward.z)
  if (!(forwardLength > 1e-6)) return { x: 0, z: 0 }
  const fx = cameraForward.x / forwardLength, fz = cameraForward.z / forwardLength
  // Right of a y-up view looking along (fx, fz) is (-fz, fx).
  const ahead = Number(keys.forward) - Number(keys.back), side = Number(keys.right) - Number(keys.left)
  const x = fx * ahead - fz * side, z = fz * ahead + fx * side
  const length = Math.hypot(x, z)
  return length > 1e-6 ? { x: x / length, z: z / length } : { x: 0, z: 0 }
}

/** Direction toward a click-to-walk destination; undefined once arrived. */
export function exploreSeekDirection(from: ExploreVec, destination: ExploreVec, arrive = .6): ExploreVec | undefined {
  const dx = destination.x - from.x, dz = destination.z - from.z
  const distance = Math.hypot(dx, dz)
  return distance <= arrive ? undefined : { x: dx / distance, z: dz / distance }
}

/** The thing within reach whose centre is relatively closest, so a person beside a large house still wins. */
export function nearestExploreTarget(point: ExploreVec, targets: readonly ExploreTarget[]): ExploreTarget | undefined {
  let best: ExploreTarget | undefined, bestSlack = Infinity
  for (const target of targets) {
    const distance = Math.hypot(target.x - point.x, target.z - point.z)
    if (distance > target.reach) continue
    const slack = distance / target.reach
    if (slack < bestSlack) { best = target; bestSlack = slack }
  }
  return best
}

export function exploreTargetVerb(target: ExploreTarget): string {
  if (target.kind === 'project') return `Open ${target.label} office`
  if (target.kind === 'artisan') return `Talk to ${target.label}`
  if (target.kind === 'temple') return 'Enter the Town Temple'
  if (target.kind === 'portal') return 'Step into the Cosmic Observatory'
  return `Read about ${target.label}`
}

/** First free point on a widening ring around the preferred spawn. */
export function exploreSpawnPoint(preferred: ExploreVec, grid: ExploreColliderGrid, radius = EXPLORE_RADIUS): ExploreVec {
  if (!exploreBlocked(preferred, radius, grid)) return { ...preferred }
  for (let ring = 1; ring <= 20; ring++) {
    for (let index = 0; index < 12; index++) {
      const angle = index / 12 * Math.PI * 2
      const point = { x: preferred.x + Math.cos(angle) * ring * 1.5, z: preferred.z + Math.sin(angle) * ring * 1.5 }
      if (!exploreBlocked(point, radius, grid)) return point
    }
  }
  return { ...preferred }
}

export interface ExploreSolid { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
export interface ExplorePoint { x: number; y: number; z: number }

/** Any mesh box large enough to hide the traveller from the follow camera. */
export function exploreSolidFromBox(box: ExploreBox): ExploreSolid | undefined {
  const { min, max } = box
  if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) return undefined
  if (Math.max(max.x - min.x, max.y - min.y, max.z - min.z) < .8) return undefined
  return { minX: min.x, minY: min.y, minZ: min.z, maxX: max.x, maxY: max.y, maxZ: max.z }
}

export interface ExploreSolidGrid { readonly size: number; along(from: ExplorePoint, to: ExplorePoint): ExploreSolid[] }

export function createExploreSolidGrid(solids: readonly ExploreSolid[], cell = GRID_CELL): ExploreSolidGrid {
  const buckets = new Map<string, ExploreSolid[]>()
  for (const solid of solids) {
    for (let cx = Math.floor(solid.minX / cell); cx <= Math.floor(solid.maxX / cell); cx++) {
      for (let cz = Math.floor(solid.minZ / cell); cz <= Math.floor(solid.maxZ / cell); cz++) {
        const key = `${cx}:${cz}`
        const bucket = buckets.get(key)
        if (bucket) bucket.push(solid); else buckets.set(key, [solid])
      }
    }
  }
  return {
    size: solids.length,
    along(from, to) {
      const found = new Set<ExploreSolid>(), pad = 1
      for (let cx = Math.floor((Math.min(from.x, to.x) - pad) / cell); cx <= Math.floor((Math.max(from.x, to.x) + pad) / cell); cx++) {
        for (let cz = Math.floor((Math.min(from.z, to.z) - pad) / cell); cz <= Math.floor((Math.max(from.z, to.z) + pad) / cell); cz++) {
          for (const solid of buckets.get(`${cx}:${cz}`) ?? []) found.add(solid)
        }
      }
      return [...found]
    },
  }
}

/**
 * Fraction (0–1) of the head→camera segment that is clear of geometry. Boxes
 * are inflated by `margin` so the near plane never grazes a face, and boxes
 * the head is already inside are ignored so an awning overhead never
 * collapses the view onto the traveller.
 */
export function exploreCameraClearance(head: ExplorePoint, camera: ExplorePoint, grid: ExploreSolidGrid, margin = .4): number {
  const direction = { x: camera.x - head.x, y: camera.y - head.y, z: camera.z - head.z }
  let clear = 1
  for (const solid of grid.along(head, camera)) {
    let enter = 0, exit = 1, inside = true
    for (const [origin, delta, low, high] of [[head.x, direction.x, solid.minX - margin, solid.maxX + margin], [head.y, direction.y, solid.minY - margin, solid.maxY + margin], [head.z, direction.z, solid.minZ - margin, solid.maxZ + margin]] as const) {
      if (origin < low || origin > high) inside = false
      if (Math.abs(delta) < 1e-9) { if (origin < low || origin > high) { enter = 2; break } continue }
      let t0 = (low - origin) / delta, t1 = (high - origin) / delta
      if (t0 > t1) [t0, t1] = [t1, t0]
      enter = Math.max(enter, t0); exit = Math.min(exit, t1)
      if (enter > exit) break
    }
    if (inside || enter > exit || enter > 1) continue
    clear = Math.min(clear, enter)
  }
  return clear
}
